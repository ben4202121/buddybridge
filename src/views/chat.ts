import { ItemView, Notice, MarkdownRenderer, Component, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { ConversationManager } from '../chat/manager';
import { BuddyBridgeAPI, isStartupBanner } from '../api';
import { getErrorMessage, type Conversation, ChatMessage, MessagePart, BuddyBridgeSettings } from '../types';
import { buildPromptContext, buildDedupedPrompt, type PromptContextState } from '../context';

export const VIEW_TYPE_CHAT = "buddybridge-panel";

const COMMANDS: Record<string, string> = {
    '/clear': '清空对话，重新开始',
    '/help': '显示 CodeBuddy 帮助信息',
    '/status': '显示当前仓库和会话状态',
    '/doctor': '检查 CodeBuddy 环境状态',
    '/compact': '压缩上下文以节省空间',
    '/summarize': '总结并压缩对话上下文',
    '/context': '计算当前会话 token 分布',
    '/cost': '显示会话成本和 token 用量',
    '/model': '查看或切换 AI 模型',
    '/permissions': '管理工具和目录访问权限',
    '/config': '查看或修改本地配置',
    '/export': '导出当前对话',
    '/resume': '恢复之前的会话',
    '/rewind': '回退到之前的消息点',
    '/init': '初始化 CodeBuddy 仓库',
    '/plan': '预览计划模式下的计划文件',
    '/fork': '在当前对话位置创建分支',
    '/memory': '管理长期记忆',
    '/mcp': '管理 MCP 连接',
    '/todos': '显示待办事项列表',
    '/stats': '显示使用统计信息',
    '/cr': '审查代码质量',
    '/fix': '自动修复代码问题',
    '/tests': '生成单元测试',
    '/explain': '解释代码工作原理',
    '/rules': '生成代码规范规则',
};

export class BuddyBridgeChatView extends ItemView {
    private manager: ConversationManager;
    private api: BuddyBridgeAPI;
    private messageContainer!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;
    private sendBtn!: HTMLButtonElement;
    private tabBar!: HTMLElement;
    private currentFileBar!: HTMLElement;
    private commandDropdown!: HTMLElement | null;
    private streamingConversations: Set<string> = new Set();
    private streamingMsgId: string | null = null;
    private stopRequested: boolean = false;
    private markdownComponent: Component;
    private fileIndex: { paths: Map<string, string>; basenames: Map<string, string[]> } | null = null;
    private fileIndexBuiltAt = 0;
    private loadDataCallback: () => Promise<Conversation[]>;
    /** 会话内已注入的上下文签名（去重用，内存态；面板重开时重置为重新注入一次） */
    private contextStates = new Map<string, PromptContextState>();

    private get vaultPath(): string | undefined {
        const adapter = this.app.vault.adapter as { basePath?: string };
        return adapter.basePath;
    }

    /** 读取插件设置（用于上下文注入开关等）；加载失败时返回 undefined。 */
    private get pluginSettings(): Partial<BuddyBridgeSettings> | undefined {
        try {
            return (this.app as any).plugins?.plugins?.['buddybridge']?.settings as Partial<BuddyBridgeSettings> | undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 构建发送给 CLI 的上下文文本：会话内去重。
     * 笔记 / Vault 上下文「没变化」就不再重复注入，只在变化时注入，
     * 避免 CLI 历史里堆叠 N 行 `[系统注入·当前笔记: ...]` 导致 agent 误判。
     */
    private buildContextText(convId: string, text: string): string {
        const settings = this.pluginSettings;
        const noteLink = settings?.noteLinkInjection !== false;
        const vaultCtx = !!settings?.vaultContextInjection;
        const current: PromptContextState = {
            notePath: noteLink ? (this.app.workspace.getActiveFile()?.path ?? null) : null,
            vaultPath: vaultCtx ? (this.vaultPath ?? null) : null,
        };
        const prev = this.contextStates.get(convId) ?? null;
        const { text: out, state } = buildDedupedPrompt(prev, current, text, {
            noteLinkInjection: noteLink,
            vaultContextInjection: vaultCtx,
        });
        this.contextStates.set(convId, state);
        return out;
    }

    constructor(leaf: WorkspaceLeaf, api: BuddyBridgeAPI, loadDataCallback: () => Promise<Conversation[]>) {
        super(leaf);
        this.api = api;
        this.loadDataCallback = loadDataCallback;
        this.manager = new ConversationManager();
        this.markdownComponent = new Component();
        this.markdownComponent.load();
    }

    getViewType(): string { return VIEW_TYPE_CHAT; }
    getDisplayText(): string { return "BuddyBridge 聊天"; }
    getIcon(): string { return "bot"; }

    getManager(): ConversationManager { return this.manager; }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        container.addClass('buddybridge-chat-container');

        // 应用自定义主色调（安全访问，失败不影响面板）
        try {
            const plugin = (this.app as any).plugins?.plugins?.['buddybridge'];
            if (plugin?.applyPrimaryColor) {
                plugin.applyPrimaryColor();
            }
        } catch (e) {
            console.error('[BB] 应用主色调失败:', e);
        }

        // 顶部标签栏
        this.tabBar = container.createDiv({ cls: 'buddybridge-tab-bar' });
        const newBtn = this.tabBar.createEl('button', {
            text: '',
            cls: 'buddybridge-new-chat-btn',
            attr: { title: '新建对话', 'aria-label': '新建对话' }
        });
        setIcon(newBtn, 'plus');
        newBtn.onclick = () => this.createNewChat();

        // 当前文件指示器
        this.currentFileBar = container.createDiv({ cls: 'buddybridge-current-file' });
        this.updateCurrentFileBar();
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.updateCurrentFileBar();
            })
        );

        // 消息区域
        this.messageContainer = container.createDiv({ cls: 'buddybridge-messages' });

        // 底部输入区
        const inputArea = container.createDiv({ cls: 'buddybridge-input-area' });
        this.inputEl = inputArea.createEl('textarea', {
            cls: 'buddybridge-input',
            attr: { placeholder: '输入消息... (Shift+Enter 换行，Enter 发送)', rows: '2' }
        });
        this.inputEl.onkeydown = (e) => this.handleKeydown(e);
        this.inputEl.oninput = () => {
            this.adjustTextareaHeight();
            this.updateCommandDropdown();
        };

        this.sendBtn = inputArea.createEl('button', {
            text: '发送',
            cls: 'buddybridge-send-btn',
            attr: { 'aria-label': '发送' }
        });
        this.sendBtn.onclick = () => {
            const conv = this.manager.getActive();
            if (conv && this.streamingConversations.has(conv.id)) {
                this.stopStreaming();
            } else {
                this.sendMessage();
            }
        };

        // 从插件设置同步最大对话数（P0.4 会话裁剪）
        try {
            const plugin = (this.app as any).plugins?.plugins?.['buddybridge'];
            if (plugin?.settings?.maxConversations) {
                this.manager.setMaxConversations(plugin.settings.maxConversations);
            }
        } catch (e) {
            console.error('[BB] 同步最大对话数失败:', e);
        }

        // DOM 构建完成后加载历史对话
        try {
            const conversations = await this.loadDataCallback();
            await this.loadConversations(conversations);
        } catch (e) {
            console.error('[BB] 加载历史对话失败:', e);
        }
    }

    async onClose() {
        this.markdownComponent.unload();
    }

    async loadConversations(conversations: Conversation[]) {
        this.manager.load(conversations);
        this.renderTabs();
        await this.renderMessages();
    }

    /** 会话上限守卫：达到上限时提示并返回 true（调用方应中止新建）。 */
    private atConversationLimit(): boolean {
        const max = this.manager.getMaxConversations();
        if (this.manager.atMaxConversations()) {
            new Notice(`对话已满（最多 ${max} 个），请先删除旧对话再新建`);
            return true;
        }
        return false;
    }

    private async createNewChat() {
        if (this.atConversationLimit()) return;
        this.manager.createConversation();
        this.renderTabs();
        await this.renderMessages();
        this.setInputEnabled(true);
    }

    private async switchToChat(id: string) {
        this.manager.switchTo(id);
        this.renderTabs();
        await this.renderMessages();
        // 切换到该对话时，根据其发送状态更新输入框
        const isSending = this.streamingConversations.has(id);
        this.setInputEnabled(!isSending);
    }

    private async deleteChat(id: string, e: UIEvent) {
        e.stopPropagation();
        this.manager.deleteConversation(id);
        this.renderTabs();
        await this.renderMessages();
    }

    /** 渲染标签栏 */
    renderTabs() {
        // 保留新建按钮
        const newBtn = this.tabBar.querySelector('.buddybridge-new-chat-btn');
        // 清除旧标签
        const oldTabs = this.tabBar.querySelectorAll('.buddybridge-tab');
        oldTabs.forEach(t => t.remove());

        const conversations = this.manager.getAll();
        const activeId = this.manager.getActive()?.id;

        for (const conv of conversations) {
            const tab = this.tabBar.createDiv({ cls: 'buddybridge-tab' });
            if (conv.id === activeId) {
                tab.addClass('buddybridge-tab-active');
            }
            tab.createSpan({ text: conv.title, cls: 'buddybridge-tab-title' });
            const closeBtn = tab.createSpan({
                cls: 'buddybridge-tab-close',
                attr: { title: '关闭对话', 'aria-label': '关闭对话', role: 'button', tabindex: '0' }
            });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = (e: MouseEvent) => this.deleteChat(conv.id, e);
            closeBtn.onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void this.deleteChat(conv.id, e);
                }
            };
            tab.onclick = () => this.switchToChat(conv.id);

            // 把新建按钮放在最后
            if (newBtn) {
                tab.after(newBtn);
            }
        }
    }

    async renderMessages() {
        this.messageContainer.empty();
        const conv = this.manager.getActive();
        if (!conv) {
            const empty = this.messageContainer.createDiv({ cls: 'buddybridge-empty-chat' });
            const icon = empty.createDiv({ cls: 'buddybridge-empty-chat-icon' });
            setIcon(icon, 'message-square');
            empty.createDiv({ cls: 'buddybridge-empty-chat-title', text: '开始新对话' });
            empty.createDiv({ cls: 'buddybridge-empty-chat-subtitle', text: '输入消息开始聊天，或点击 + 新建对话' });

            // 快捷提示
            const tips = empty.createDiv({ cls: 'buddybridge-empty-chat-tips' });
            tips.createDiv({ text: '💡 提示' });
            const tipList = tips.createEl('ul');
            const tipItems = [
                'Shift+Enter 换行，Enter 发送',
                '输入 / 查看可用命令',
                '多轮对话自动保持上下文',
            ];
            for (const tip of tipItems) {
                tipList.createEl('li', { text: tip });
            }
            return;
        }

        for (const msg of conv.messages) {
            await this.renderMessage(msg, () => this.retryLastExchange());
        }

        this.scrollToBottom();
    }

    private async renderMessage(msg: ChatMessage, onRetry?: () => void) {
        const row = this.messageContainer.createDiv({
            cls: `buddybridge-message-row buddybridge-message-${msg.role}`
        });
        const bubble = row.createDiv({ cls: 'buddybridge-bubble' });

        // 仅当前正在等待回复的消息显示思考指示器
        const isWaiting = msg.role === 'assistant' && msg.content === '' && msg.id === this.streamingMsgId;
        if (isWaiting) {
            this.renderThinkingIndicator(bubble);
        } else if (msg.role === 'assistant') {
            // 检测是否为错误消息
            if (msg.content.startsWith('错误:') || msg.content.startsWith('Error:')) {
                this.renderErrorCard(bubble, msg.content, onRetry);
            } else {
                // 先重建持久化的结构化 parts（可折叠思考块 / 工具卡）
                if (msg.parts && msg.parts.length > 0) {
                    this.renderMessageParts(bubble, msg.parts);
                }
                await this.renderMarkdownContent(bubble, msg.content);
            }
        } else {
            bubble.createSpan({ text: msg.content });
        }
        return row;
    }

    /** 从持久化的 parts 重建思考块与工具卡（流式结束后、切标签、重启后仍保留）。 */
    private renderMessageParts(bubble: HTMLElement, parts: MessagePart[]): void {
        let toolsBlock: HTMLElement | null = null;
        for (const part of parts) {
            if (part.kind === 'thinking') {
                this.renderThinkingBlock(bubble, part.content || '', '已思考');
            } else if (part.kind === 'tool') {
                if (!toolsBlock) {
                    toolsBlock = this.renderToolsBlock(bubble);
                }
                this.appendToolRow(toolsBlock, part.name || '', part.detail || '');
            }
        }
    }

    /** 创建/复用可折叠思考块，并更新标题与正文。 */
    private renderThinkingBlock(bubble: HTMLElement, content: string, label: string): HTMLElement {
        let block = bubble.querySelector('.buddybridge-thinking-block') as HTMLElement | null;
        if (!block) {
            block = bubble.createDiv({ cls: 'buddybridge-thinking-block' });
            const header = block.createDiv({ cls: 'buddybridge-thinking-header' });
            const icon = header.createSpan({ cls: 'buddybridge-thinking-header-icon' });
            setIcon(icon, 'sparkles');
            header.createSpan({ cls: 'buddybridge-thinking-header-text', text: label });
            const chevron = header.createSpan({ cls: 'buddybridge-thinking-header-chevron', text: '▾' });
            const bodyDiv = block.createDiv({ cls: 'buddybridge-thinking-body buddybridge-hidden' });
            header.addEventListener('click', () => {
                const hidden = bodyDiv.hasClass('buddybridge-hidden');
                bodyDiv.toggleClass('buddybridge-hidden', !hidden);
                chevron.textContent = hidden ? '▾' : '▸';
            });
        }
        const headerText = block.querySelector('.buddybridge-thinking-header-text');
        if (headerText instanceof HTMLElement) {
            headerText.setText(label);
        }
        const body = block.querySelector('.buddybridge-thinking-body');
        if (body instanceof HTMLElement) {
            body.setText(content);
        }
        return block;
    }

    /** 创建/复用工具卡容器。 */
    private renderToolsBlock(bubble: HTMLElement): HTMLElement {
        let toolsBlock = bubble.querySelector('.buddybridge-tools-block') as HTMLElement | null;
        if (!toolsBlock) {
            toolsBlock = bubble.createDiv({ cls: 'buddybridge-tools-block' });
            const hdr = toolsBlock.createDiv({ cls: 'buddybridge-tools-header' });
            const icon = hdr.createSpan({ cls: 'buddybridge-tools-header-icon' });
            setIcon(icon, 'wrench');
            hdr.createSpan({ cls: 'buddybridge-tools-header-text', text: '工具调用' });
            const chevron = hdr.createSpan({ cls: 'buddybridge-tools-header-chevron', text: '▾' });
            hdr.addEventListener('click', () => {
                const list = toolsBlock.querySelector('.buddybridge-tools-list');
                if (list instanceof HTMLElement) {
                    const hidden = list.hasClass('buddybridge-hidden');
                    list.toggleClass('buddybridge-hidden', !hidden);
                    chevron.textContent = hidden ? '▾' : '▸';
                }
            });
            toolsBlock.createDiv({ cls: 'buddybridge-tools-list buddybridge-hidden' });
        }
        return toolsBlock;
    }

    /** 向工具卡容器追加一行工具调用。 */
    private appendToolRow(toolsBlock: HTMLElement, toolName: string, toolDetail: string): void {
        const list = toolsBlock.querySelector('.buddybridge-tools-list');
        if (!(list instanceof HTMLElement)) return;
        let iconName = 'wrench';
        if (toolName.includes('read') || toolName.includes('查看') || toolName.includes('读取')) {
            iconName = 'file-text';
        } else if (toolName.includes('write') || toolName.includes('编辑') || toolName.includes('写入')) {
            iconName = 'pencil';
        } else if (toolName.includes('search') || toolName.includes('搜索') || toolName.includes('查找')) {
            iconName = 'search';
        }
        const row = list.createDiv({ cls: 'buddybridge-tool-call' });
        const icon = row.createSpan({ cls: 'buddybridge-tool-call-icon' });
        setIcon(icon, iconName);
        row.createSpan({
            cls: 'buddybridge-tool-call-text',
            text: `${toolName} ${toolDetail}`.trim()
        });
    }

    /**
     * 错误卡「重试」（P0.3）：删除最近一对 user+assistant 消息（失败的那对），
     * 将 user 消息放回输入框并自动重发。超时/致命错误均可触发。
     */
    private retryLastExchange(): void {
        const conv = this.manager.getActive();
        if (!conv || conv.messages.length === 0) return;

        let lastUserIdx = -1;
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            if (conv.messages[i].role === 'user') {
                lastUserIdx = i;
                break;
            }
        }
        if (lastUserIdx < 0) return;

        const userMsg = conv.messages[lastUserIdx];
        // 移除该用户消息及其之后的所有 assistant 消息（通常为紧邻的错误回复）
        const idsToRemove = conv.messages.slice(lastUserIdx).map(m => m.id);
        this.manager.removeMessages(conv.id, idsToRemove);

        this.inputEl.value = userMsg.content;
        this.adjustTextareaHeight();
        void this.renderMessages();
        void this.sendMessage();
    }

    private renderErrorCard(bubble: HTMLElement, content: string, onRetry?: () => void) {
        const card = bubble.createDiv({ cls: 'buddybridge-error-card' });
        const icon = card.createDiv({ cls: 'buddybridge-error-card-icon' });
        setIcon(icon, 'alert-triangle');

        const errorMsg = content.replace(/^错误:\s*/, '').replace(/^Error:\s*/, '');
        card.createDiv({ cls: 'buddybridge-error-card-title', text: '请求失败' });
        card.createDiv({ cls: 'buddybridge-error-card-body', text: errorMsg });

        const hint = this.getErrorHint(errorMsg);
        if (hint) {
            card.createDiv({ cls: 'buddybridge-error-card-hint', text: hint });
        }

        // P0.3：错误卡提供「重试」操作，超时/致命错误不再是无头提示
        if (onRetry) {
            const actions = card.createDiv({ cls: 'buddybridge-error-card-actions' });
            const retryBtn = actions.createEl('button', {
                text: '重试',
                cls: 'mod-cta buddybridge-error-retry-btn',
                attr: { 'aria-label': '重试上次发送' }
            });
            retryBtn.onclick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                onRetry();
            };
        }
    }

    private getErrorHint(errorMsg: string): string | null {
        if (errorMsg.includes('找不到 codebuddy') || errorMsg.includes('ENOENT') || errorMsg.includes('codebuddy')) {
            return '请在设置中指定正确的 CodeBuddy 路径，或确认已安装 WorkBuddy 桌面版。';
        }
        if (errorMsg.includes('Node.js') || errorMsg.includes('node')) {
            return '请确认 Node.js 已正确安装，或运行环境初始化提示词。';
        }
        if (errorMsg.includes('timeout') || errorMsg.includes('超时') || errorMsg.includes('TIMEOUT')) {
            return '请求超时，请重试。';
        }
        return null;
    }

    private renderThinkingIndicator(bubble: HTMLElement) {
        const thinking = bubble.createDiv({ cls: 'buddybridge-thinking' });
        thinking.createSpan({ cls: 'buddybridge-thinking-text', text: '思考中' });
        const dots = thinking.createDiv({ cls: 'buddybridge-thinking-dots' });
        for (let i = 0; i < 3; i++) {
            dots.createSpan({ cls: 'buddybridge-dot' });
        }
    }

    private async renderMarkdownContent(bubble: HTMLElement, content: string): Promise<void> {
        if (!content) return;

        // 保留已有的思考块和工具块
        const thinkingBlock = bubble.querySelector('.buddybridge-thinking-block');
        const toolsBlock = bubble.querySelector('.buddybridge-tools-block');

        // 查找或创建 Markdown 容器（复用已有容器避免频繁 DOM 创建）
        let markdownContainer = bubble.querySelector('.buddybridge-markdown-content');
        if (!(markdownContainer instanceof HTMLElement)) {
            markdownContainer = bubble.createDiv({ cls: 'buddybridge-markdown-content' });

            // 如果有思考块/工具块，将 Markdown 内容插入到它们之前
            if (thinkingBlock instanceof HTMLElement) {
                bubble.insertBefore(markdownContainer, thinkingBlock);
            } else if (toolsBlock instanceof HTMLElement) {
                bubble.insertBefore(markdownContainer, toolsBlock);
            }
        }

        if (!(markdownContainer instanceof HTMLElement)) return;

        // 清空之前渲染的内容
        markdownContainer.empty();

        await MarkdownRenderer.render(
            this.app,
            content,
            markdownContainer,
            '',
            this.markdownComponent
        );

        // 把回复中提到的、vault 里真实存在的文件名转为可点击链接
        this.linkFileReferences(markdownContainer);
    }

    /** 构建/复用 vault 文件索引（带过期时间，避免每次渲染都重建） */
    private getFileIndex(): { paths: Map<string, string>; basenames: Map<string, string[]> } {
        const now = Date.now();
        if (this.fileIndex && now - this.fileIndexBuiltAt < 10000) {
            return this.fileIndex;
        }
        const paths = new Map<string, string>();
        const basenames = new Map<string, string[]>();
        for (const file of this.app.vault.getFiles()) {
            const normalized = file.path.toLowerCase().replace(/\\/g, '/');
            paths.set(normalized, file.path);
            const key = (file.basename + '.' + file.extension).toLowerCase();
            const list = basenames.get(key);
            if (list) {
                list.push(file.path);
            } else {
                basenames.set(key, [file.path]);
            }
        }
        this.fileIndex = { paths, basenames };
        this.fileIndexBuiltAt = now;
        return this.fileIndex;
    }

    /** 遍历 markdown 容器，把文件名文本节点替换为可点击链接 */
    private linkFileReferences(container: HTMLElement): void {
        const index = this.getFileIndex();
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node: Node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    // 跳过已有链接和代码块，避免破坏
                    if (parent.closest('a')) return NodeFilter.FILTER_REJECT;
                    if (parent.closest('pre')) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                },
            }
        );
        const textNodes: Text[] = [];
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode as Text);
        }
        for (const node of textNodes) {
            this.linkTextNode(node, index);
        }
    }

    /** 解析候选词：优先全路径匹配，其次唯一文件名匹配 */
    private resolveFilePath(token: string, index: { paths: Map<string, string>; basenames: Map<string, string[]> }): string | null {
        const normalized = token.toLowerCase().replace(/\\/g, '/');
        const full = index.paths.get(normalized);
        if (full) return full;
        const sep = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
        const base = sep >= 0 ? normalized.slice(sep + 1) : normalized;
        const list = index.basenames.get(base);
        if (list && list.length === 1) return list[0];
        return null;
    }

    /** 把单个文本节点中匹配到的文件名替换为可点击链接 */
    private linkTextNode(node: Text, index: { paths: Map<string, string>; basenames: Map<string, string[]> }): void {
        const raw = node.nodeValue || '';
        if (!raw) return;

        // 候选词：ASCII 单词/数字 + 中文 + 路径分隔符 + 扩展名
        const re = /[\u4e00-\u9fff\u3400-\u4dbf\w./\\-]+/g;
        const matches: { start: number; end: number; path: string }[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw)) !== null) {
            const token = m[0].replace(/[.,;:!?)\]}>'"。，；：！？）】》’"」》]+$/, '');
            if (!token) continue;
            const resolved = this.resolveFilePath(token, index);
            if (resolved) {
                matches.push({ start: m.index, end: m.index + token.length, path: resolved });
            }
        }
        if (matches.length === 0) return;

        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
            if (match.start > cursor) {
                frag.append(document.createTextNode(raw.slice(cursor, match.start)));
            }
            const link = document.createElement('a');
            link.addClass('internal-link');
            link.setAttribute('data-href', match.path);
            link.setAttribute('href', match.path);
            link.textContent = raw.slice(match.start, match.end);
            link.addEventListener('click', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                void this.app.workspace.openLinkText(match.path, '');
            });
            frag.append(link);
            cursor = match.end;
        }
        if (cursor < raw.length) {
            frag.append(document.createTextNode(raw.slice(cursor)));
        }
        node.parentNode?.replaceChild(frag, node);
    }

    private adjustTextareaHeight() {
        this.inputEl.style.setProperty('--buddybridge-input-height', `${this.inputEl.scrollHeight}px`);
    }

    private setInputEnabled(enabled: boolean) {
        this.inputEl.disabled = !enabled;
        this.sendBtn.disabled = false;
        this.sendBtn.setText(enabled ? '发送' : '停止');
        this.sendBtn.toggleClass('buddybridge-send-btn-stop', !enabled);
    }

    private stopStreaming() {
        this.stopRequested = true;
        this.api.cancel();
    }

    private updateCommandDropdown() {
        const val = this.inputEl.value;
        if (val === '/') {
            if (!this.commandDropdown) {
                const parent = this.inputEl.parentElement;
                if (!parent) return;
                this.commandDropdown = parent.createDiv({ cls: 'buddybridge-command-dropdown' });
                for (const [cmd, desc] of Object.entries(COMMANDS)) {
                    const item = this.commandDropdown.createDiv({ cls: 'buddybridge-command-item' });
                    item.createSpan({ cls: 'buddybridge-command-name', text: cmd });
                    item.createSpan({ cls: 'buddybridge-command-desc', text: desc });
                    item.onclick = () => {
                        this.inputEl.value = cmd + ' ';
                        this.inputEl.focus();
                        this.removeCommandDropdown();
                    };
                }
            }
        } else {
            this.removeCommandDropdown();
        }
    }

    private removeCommandDropdown() {
        if (this.commandDropdown) {
            this.commandDropdown.remove();
            this.commandDropdown = null;
        }
    }

    private async handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await this.sendMessage();
        }
        if (e.key === 'Escape') {
            this.removeCommandDropdown();
        }
    }

    private async sendMessage() {
        // 该对话正在流式响应时阻止重复发送
        const activeConv = this.manager.getActive();
        if (activeConv && this.streamingConversations.has(activeConv.id)) return;

        const text = this.inputEl.value.trim();
        if (!text) return;

        // 处理斜杠命令
        if (text.startsWith('/')) {
            const cmd = text.split(' ')[0].toLowerCase();
            if (cmd === '/clear') {
                this.createNewChat();
                return;
            }
            // 其他命令透传给 CLI
        }

        // 确保有活跃对话（无活跃会话时新建；达到上限则提示中止）
        let conv = this.manager.getActive();
        if (!conv) {
            if (this.atConversationLimit()) return;
            conv = this.manager.createConversation();
            this.renderTabs();
        }

        // 首次对话自动生成 sessionId，后续多轮对话保持上下文连贯
        if (!conv.sessionId) {
            conv.sessionId = this.api.generateId();
        }

        // 添加用户消息
        const convId = conv.id;
        this.manager.addMessage(convId, 'user', text);
        this.inputEl.value = '';
        this.adjustTextareaHeight();
        await this.renderMessages();

        // 创建 AI 消息占位，标记为等待回复中
        const aiMsg = this.manager.addMessage(convId, 'assistant', '');
        if (!aiMsg) return;

        this.streamingMsgId = aiMsg.id;
        this.streamingConversations.add(convId);
        this.setInputEnabled(false);
        await this.renderMessages();

        // 流式发送
        let firstChunk = true;
        let thinkingContent = '';
        let textContent = '';
        let parts: MessagePart[] = [];
        let streamingError: string | null = null;
        try {
            // 当前文档感知（ROADMAP 1.1）+ 注入开关（P2.6）+ 会话内去重：普通消息只在上下文变化时注入；
            // 斜杠命令原样透传，不注入上下文。注入文本不进对话历史，聊天仍显示原文。
            const contextText = text.startsWith('/')
                ? text
                : this.buildContextText(convId, text);

            const streamingBubble = this.messageContainer.querySelector(
                `.buddybridge-message-assistant:last-child .buddybridge-bubble`
            );
            if (!(streamingBubble instanceof HTMLElement)) {
                throw new Error('找不到 Assistant 消息气泡');
            }

            for await (const chunk of this.api.sendMessage(conv.sessionId, contextText, this.vaultPath)) {
                const bubble = streamingBubble;

                // 仅在尚未产出任何真实内容时，过滤 CLI 启动横幅；
                // 整行开头匹配 + 已产出正文后不再过滤，避免误吞回复正文中的关键词
                const hasRealContent = textContent.length > 0 || thinkingContent.length > 0 || parts.length > 0;
                if (chunk.type === 'text' && !hasRealContent && isStartupBanner(chunk.content)) {
                    continue;
                }

                if (firstChunk) {
                    firstChunk = false;
                    // 移除思考指示器
                    const thinking = bubble.querySelector('.buddybridge-thinking');
                    if (thinking instanceof HTMLElement) {
                        thinking.addClass('buddybridge-thinking-fadeout');
                        await new Promise(r => window.setTimeout(r, 200));
                        thinking.remove();
                    }
                }

                if (chunk.type === 'thinking') {
                    thinkingContent += chunk.content;
                    // 更新持久化 parts（思考合并为单个部分，内容流式追加）
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && lastPart.kind === 'thinking') {
                        lastPart.content = thinkingContent;
                    } else {
                        parts.push({ kind: 'thinking', content: thinkingContent });
                    }
                    this.manager.updateMessageParts(convId, aiMsg.id, parts, true);
                    this.renderThinkingBlock(bubble, thinkingContent, '思考中...');
                } else if (chunk.type === 'tool') {
                    parts.push({ kind: 'tool', name: chunk.toolName || '', detail: chunk.toolDetail || '' });
                    this.manager.updateMessageParts(convId, aiMsg.id, parts, true);
                    const toolsBlock = this.renderToolsBlock(bubble);
                    this.appendToolRow(toolsBlock, chunk.toolName || '', chunk.toolDetail || '');
                } else if (chunk.type === 'text') {
                    textContent += chunk.content;
                    this.manager.updateMessage(convId, aiMsg.id, textContent, true);
                    await this.renderMarkdownContent(bubble, textContent);
                } else if (chunk.type === 'error') {
                    streamingError = chunk.content;
                    this.manager.updateMessage(convId, aiMsg.id, `错误: ${chunk.content}`, true);
                    new Notice(`请求失败: ${chunk.content}`);
                }
            }

            if (streamingError) {
                // P0.3/P0.5：错误卡直接写入内容，并清空可能残留的 parts
                this.manager.updateMessage(convId, aiMsg.id, `错误: ${streamingError}`);
                this.manager.updateMessageParts(convId, aiMsg.id, undefined, true);
            } else {
                // 正文只存文本；思考/工具调用已通过 parts 持久化（流式结束后由 parts 重建可折叠块）
                this.manager.updateMessage(convId, aiMsg.id, textContent);
                const hasContent = Boolean(textContent || thinkingContent || parts.length > 0);
                if (!hasContent) {
                    this.manager.updateMessage(convId, aiMsg.id, this.stopRequested ? '（已停止）' : '（无响应，请重试）');
                } else if (this.stopRequested && textContent) {
                    this.manager.updateMessage(convId, aiMsg.id, textContent + '\n\n（已停止）');
                }
            }

            // 流式结束后从 parts 重建（思考块标签变「已思考」、工具卡保留可折叠）
            await this.renderMessages();
            await this.manager.flush();
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${message}`);
            new Notice(`请求失败: ${message}`);
            await this.renderMessages();
        } finally {
            this.streamingConversations.delete(convId);
            this.streamingMsgId = null;
            this.stopRequested = false;
            this.setInputEnabled(true);
        }
    }

    private updateCurrentFileBar() {
        const file = this.app.workspace.getActiveFile();
        if (file) {
            this.currentFileBar.setText(`📄 ${file.path}`);
        } else {
            this.currentFileBar.setText('');
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}
