import { ItemView, Notice, MarkdownRenderer, Component, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { ConversationManager } from '../chat/manager';
import { BuddyBridgeAPI, isStartupBanner } from '../api';
import { getErrorMessage, type Conversation, ChatMessage, MessagePart, BuddyBridgeSettings } from '../types';
import { buildPromptContext, buildDedupedPrompt, encodeLineSeparators, type PromptContextState } from '../context';
import { SendQueue, type QueueItem } from '../chat/queue';
import { isGatewayEmptyStream } from '../chat/failure';

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
    /** 各会话当前流式中的 assistant 消息 id（convId → msgId）；多会话各自一条流，互不串窗。 */
    private streamingMsgIds = new Map<string, string>();
    /** 各会话的停止请求（convId）：只影响该会话当前这条流，队列保留继续。 */
    private stopRequests = new Set<string>();
    /** 发送队列：流式期间可继续输入，FIFO 串行发送（纯视图层，不持久化）。 */
    private sendQueue: SendQueue = new SendQueue();
    /** 正在被队列泵 drain 的会话集合（convId）；各会话可并发 drain（独立进程流）。 */
    private draining = new Set<string>();
    private queueBar!: HTMLElement;
    /** 分支注入转写：fork 会话 id → 截至分叉点的对话转写，首条发送时一次性注入新 session（内存态）。 */
    private forkTranscripts = new Map<string, string>();
    private markdownComponent: Component;
    private fileIndex: { paths: Map<string, string>; basenames: Map<string, string[]> } | null = null;
    private fileIndexBuiltAt = 0;
    private loadDataCallback: () => Promise<Conversation[]>;
    /** 会话内已注入的上下文签名（去重用，内存态；面板重开时重置为重新注入一次） */
    private contextStates = new Map<string, PromptContextState>();
    /**
     * 当前活动笔记路径（last active file）。由 active-leaf-change 事件维护；
     * 不直接调 getActiveFile()——焦点在聊天面板（ItemView 无文件）时它返回不可靠。
     */
    private currentFilePath: string | null = null;

    /**
     * 解析「当前文章」路径，三级兜底：
     * 1. 实时活跃文件（getActiveFile）；
     * 2. 粘性值 currentFilePath（焦点在聊天面板时保留最后查看的笔记）；
     * 3. 最近打开的文件（getLastOpenFiles 首项）——面板刚打开、用户尚未点击任何文件时，
     *    也能拿到打开面板前在看的那篇笔记（否则分支/新增会话首条消息丢失「当前文章」）。
     */
    private getCurrentFilePath(): string | null {
        const active = this.app.workspace.getActiveFile();
        if (active) return active.path;
        if (this.currentFilePath) return this.currentFilePath;
        const last = this.app.workspace.getLastOpenFiles();
        return last.length > 0 ? last[0] : null;
    }

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
     * @param notePath 入队时的笔记快照（可选）；未提供时回退当前文件。
     */
    private buildContextText(convId: string, text: string, notePath?: string | null): string {
        const settings = this.pluginSettings;
        const noteLink = settings?.noteLinkInjection !== false;
        const vaultCtx = !!settings?.vaultContextInjection;
        const current: PromptContextState = {
            // 快照优先：非空快照在排队期间切笔记 / 焦点变化时保持不变；
            // 空快照（入队时无当前文章）回退到解析时的实时当前文章，尽力注入而非直接丢弃
            notePath: noteLink ? (notePath ?? this.getCurrentFilePath()) : null,
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
        // 单实例守卫：BuddyBridge 传输层是单流（所有视图共享同一个 api 单例），
        // 同时打开多个聊天窗口会互相踩掉流式状态（pendingResolve / currentProc / chunkQueue）
        // 导致输出串窗、队列永久卡死（"消息出现在所有窗口 / AI 无法响应"）。
        // 新窗口打开时：取消在途流 + 关闭其他聊天 leaf，只保留当前这一个。
        this.api.cancel();
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
        for (const leaf of leaves) {
            if (leaf !== this.leaf) {
                await leaf.detach();
            }
        }

        const container = this.contentEl;
        container.empty();
        container.addClass('buddybridge-chat-container');

        // 应用自定义主色调 / 字体大小（安全访问，失败不影响面板）
        try {
            const plugin = (this.app as any).plugins?.plugins?.['buddybridge'];
            if (plugin?.applyPrimaryColor) {
                plugin.applyPrimaryColor();
            }
            if (plugin?.applyFontSize) {
                plugin.applyFontSize();
            }
        } catch (e) {
            console.error('[BB] 应用外观设置失败:', e);
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
        // 用三级兜底解析：面板打开时活跃视图已是聊天 leaf（getActiveFile() 为 null），
        // 直接赋值会把它清空导致「当前文章」丢失——改用 getCurrentFilePath() 保留最近笔记
        this.currentFilePath = this.getCurrentFilePath();
        this.updateCurrentFileBar();
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const file = this.app.workspace.getActiveFile();
                // 焦点移到非文件视图（聊天面板等）时保留最后查看的笔记，不置空——
                // 否则点一下聊天面板，当前文章感知就丢了（buildContextText 也读这里）
                if (file) {
                    this.currentFilePath = file.path;
                }
                this.updateCurrentFileBar();
            })
        );

        // 消息区域
        this.messageContainer = container.createDiv({ cls: 'buddybridge-messages' });

        // 发送队列条（排队中消息，可删除/内联编辑）
        this.queueBar = container.createDiv({ cls: 'buddybridge-queue-bar buddybridge-hidden' });

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
            // 当前活动会话正在流式 → 停止该会话的流（队列保留继续）；否则发送
            const activeId = this.manager.getActive()?.id ?? null;
            if (activeId !== null && this.draining.has(activeId)) {
                this.stopStreaming();
            } else {
                void this.sendMessage();
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
        this.updateSendButton();
    }

    private async switchToChat(id: string) {
        this.manager.switchTo(id);
        this.renderTabs();
        await this.renderMessages();
        // 输入框始终可用（队列模型：流式期间也可继续输入），仅更新按钮状态
        this.updateSendButton();
        // 立即按新会话重渲染队列条（各会话队列独立，只显示当前会话的等待项）
        this.renderQueueBar();
        // 切回有排队项的会话时立即恢复处理
        void this.pumpQueue();
    }

    private async deleteChat(id: string, e: UIEvent) {
        e.stopPropagation();
        this.manager.deleteConversation(id);
        // 清理该会话残留的排队项（孤儿项不会发送，留在内存里浪费）
        this.clearQueuedFor(id);
        this.renderTabs();
        await this.renderMessages();
    }

    /** 清空指定会话的全部排队项（删除会话时调用）。 */
    private clearQueuedFor(convId: string): void {
        for (const item of this.sendQueue.listFor(convId)) {
            this.sendQueue.remove(item.id);
        }
        this.renderQueueBar();
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
            await this.renderMessage(conv.id, msg, () => this.retryLastExchange());
        }

        this.scrollToBottom();
    }

    private async renderMessage(convId: string, msg: ChatMessage, onRetry?: () => void) {
        const row = this.messageContainer.createDiv({
            cls: `buddybridge-message-row buddybridge-message-${msg.role}`
        });
        // 分支入口（Phase 1）：悬浮按钮 → 从这里继续新对话
        const forkBtn = row.createDiv({
            cls: 'buddybridge-fork-btn',
            attr: { title: '从这里继续新对话', 'aria-label': '从这里继续新对话', role: 'button', tabindex: '0' }
        });
        setIcon(forkBtn, 'git-branch');
        forkBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            this.forkFrom(msg);
        };
        forkBtn.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.forkFrom(msg);
            }
        };
        const bubble = row.createDiv({ cls: 'buddybridge-bubble' });

        // 仅当前会话正在等待回复的消息显示思考指示器（按会话判定，多会话并发不串窗）
        const isWaiting = msg.role === 'assistant' && msg.content === '' && msg.id === this.streamingMsgIds.get(convId);
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

    /** 更新发送按钮状态：当前活动会话流式中显示「停止」（只中断该会话的流，队列保留），否则「发送」。 */
    private updateSendButton() {
        this.inputEl.disabled = false; // 流式期间输入框保持可用（排队核心）
        const activeId = this.manager.getActive()?.id ?? null;
        const busy = activeId !== null && this.draining.has(activeId);
        this.sendBtn.setText(busy ? '停止' : '发送');
        this.sendBtn.toggleClass('buddybridge-send-btn-stop', busy);
    }

    private stopStreaming() {
        const conv = this.manager.getActive();
        if (!conv) return;
        // 只停止当前活动会话的流（按 sessionId 定向取消），其他会话的并发流不受影响
        this.stopRequests.add(conv.id);
        this.api.cancel(conv.sessionId);
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

    /**
     * 发送：统一入队（回复流式期间也可继续输入），由队列泵 FIFO 串行发出。
     * 会话上限守卫不变 —— 无活动会话且达上限时提示中止，队列原有项不受影响（不丢消息）。
     */
    private async sendMessage() {
        const text = this.inputEl.value.trim();
        if (!text) return;

        // 处理斜杠命令
        if (text.startsWith('/')) {
            const cmd = text.split(' ')[0].toLowerCase();
            if (cmd === '/clear') {
                // /clear 语义：清除当前对话（保留对话本身，不新建标签）；
                // 无活动对话时才按新建处理（带会话上限守卫）
                const active = this.manager.getActive();
                if (active) {
                    this.manager.clearConversation(active.id);
                    // 去重 state 也清掉：新 session 首条消息强制重新注入当前上下文
                    this.contextStates.delete(active.id);
                    this.renderTabs();
                    await this.renderMessages();
                } else {
                    await this.createNewChat();
                }
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

        // 入队并清空输入；记录入队时的笔记快照（三级兜底解析「当前文章」）——排队期间切换笔记 /
        // 焦点变化不影响本条消息实际携带的「当前文章」上下文
        this.sendQueue.enqueue(conv.id, text, this.getCurrentFilePath());
        this.inputEl.value = '';
        this.adjustTextareaHeight();
        this.renderQueueBar();
        void this.pumpQueue();
    }

    /**
     * 队列泵：并发 drain 所有有排队项的会话（各会话一条独立流，互不阻塞——
     * 会话 A 流式期间，在会话 B 发送的问题立即并行回答）。
     */
    private async pumpQueue(): Promise<void> {
        for (const conv of this.manager.getAll()) {
            if (this.sendQueue.peekFor(conv.id)) {
                void this.drainConversation(conv.id);
            }
        }
    }

    /**
     * 单会话 drain：FIFO 串行处理该会话的排队项（先出队再处理，正在发送的不显示在队列条）。
     * draining 集合防重入；停止请求只影响当前条（processItem 内部检查并清除），队列保留继续。
     */
    private async drainConversation(convId: string): Promise<void> {
        if (this.draining.has(convId)) return;
        this.draining.add(convId);
        this.updateSendButton();
        try {
            while (true) {
                const item = this.sendQueue.peekFor(convId);
                if (!item) break;
                this.sendQueue.dequeue(convId);
                this.renderQueueBar();
                await this.processItem(item);
            }
        } finally {
            this.draining.delete(convId);
            this.updateSendButton();
            this.renderQueueBar();
        }
    }

    /**
     * 处理一条队列项：真正发送时写入历史并流式。
     * 会话已被删除 → 丢弃该项（不产生消息）。
     * 仅当该项属于当前活动会话时内联渲染流式；否则静默累积（切回该会话时可见完整回复）。
     */
    private async processItem(item: QueueItem): Promise<void> {
        const convId = item.convId;
        const conv = this.manager.getConversation(convId);
        if (!conv) return;

        // 首次对话自动生成 sessionId，后续多轮对话保持上下文连贯
        if (!conv.sessionId) {
            conv.sessionId = this.api.generateId();
        }

        // 真正发送时添加用户消息（进入历史 / 自动生成标题）
        this.manager.addMessage(convId, 'user', item.text);

        // 创建 AI 消息占位，标记为等待回复中
        const aiMsg = this.manager.addMessage(convId, 'assistant', '');
        if (!aiMsg) return;

        this.streamingMsgIds.set(convId, aiMsg.id);

        const isActive = this.manager.getActive()?.id === convId;
        let bubble: HTMLElement | null = null;

        // 流式发送
        let firstChunk = true;
        let thinkingContent = '';
        let textContent = '';
        let parts: MessagePart[] = [];
        let streamingError: string | null = null;
        try {
            // 仅当该项属于当前活动会话时内联渲染（气泡查找在 try 内：失败按错误消息处理，队列继续）
            if (isActive) {
                await this.renderMessages();
                const streamingBubble = this.messageContainer.querySelector(
                    `.buddybridge-message-assistant:last-child .buddybridge-bubble`
                );
                if (!(streamingBubble instanceof HTMLElement)) {
                    throw new Error('找不到 Assistant 消息气泡');
                }
                bubble = streamingBubble;
            }

            // 上下文在入队时已随项快照（当时的笔记 + 会话内去重）；斜杠命令原样透传，
            // 不注入上下文。注入文本不进对话历史，聊天仍显示原文。
            const base = item.text.startsWith('/')
                ? item.text
                : this.buildContextText(convId, item.text, item.notePath);
            // 分支会话：首条发送时前置注入截至分叉点的对话转写（一次性），让新 session 了解此前对话
            const transcript = this.forkTranscripts.get(convId);
            if (transcript) {
                this.forkTranscripts.delete(convId);
            }
            // Windows cmd 传输层在第一个换行处截断命令行参数：多行注入文本（分支转写 /
            // 当前笔记 / 问题正文）发送前须把换行编码为 U+2028 行分隔符（见
            // context.ts encodeLineSeparators），否则 CLI 只收到第一行，内容确实传不过去。
            const contextText = encodeLineSeparators(transcript ? `${transcript}\n\n${base}` : base);

            for await (const chunk of this.api.sendMessage(conv.sessionId, contextText, this.vaultPath)) {
                // 停止即时生效：点停止后不再渲染后续缓冲 chunk（仅当前会话，队列保留，下一条继续）
                if (this.stopRequests.has(convId)) break;

                // 仅在尚未产出任何真实内容时，过滤 CLI 启动横幅；
                // 整行开头匹配 + 已产出正文后不再过滤，避免误吞回复正文中的关键词
                const hasRealContent = textContent.length > 0 || thinkingContent.length > 0 || parts.length > 0;
                if (chunk.type === 'text' && !hasRealContent && isStartupBanner(chunk.content)) {
                    continue;
                }

                if (firstChunk) {
                    firstChunk = false;
                    // 移除思考指示器（仅内联渲染时）
                    if (isActive && bubble) {
                        const thinking = bubble.querySelector('.buddybridge-thinking');
                        if (thinking instanceof HTMLElement) {
                            thinking.addClass('buddybridge-thinking-fadeout');
                            await new Promise(r => window.setTimeout(r, 200));
                            thinking.remove();
                        }
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
                    if (isActive && bubble) {
                        this.renderThinkingBlock(bubble, thinkingContent, '思考中...');
                    }
                } else if (chunk.type === 'tool') {
                    parts.push({ kind: 'tool', name: chunk.toolName || '', detail: chunk.toolDetail || '' });
                    this.manager.updateMessageParts(convId, aiMsg.id, parts, true);
                    if (isActive && bubble) {
                        const toolsBlock = this.renderToolsBlock(bubble);
                        this.appendToolRow(toolsBlock, chunk.toolName || '', chunk.toolDetail || '');
                    }
                } else if (chunk.type === 'text') {
                    textContent += chunk.content;
                    this.manager.updateMessage(convId, aiMsg.id, textContent, true);
                    if (isActive && bubble) {
                        await this.renderMarkdownContent(bubble, textContent);
                    }
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
                const hasContent = Boolean(textContent || thinkingContent || parts.length > 0);
                const stopped = this.stopRequests.has(convId);
                if (!hasContent) {
                    // 正文只存文本；思考/工具调用已通过 parts 持久化（流式结束后由 parts 重建可折叠块）
                    this.manager.updateMessage(convId, aiMsg.id, stopped ? '（已停止）' : '（无响应，请重试）');
                } else if (stopped && textContent) {
                    this.manager.updateMessage(convId, aiMsg.id, textContent + '\n\n（已停止）');
                } else if (isGatewayEmptyStream(textContent, thinkingContent.length, parts.length)) {
                    // 上游网关只回占位 chunk（Empty stream）：整条回复是网关失败而非模型输出，
                    // 该 session 已无法正常产出（反复失败 = 会话在 CLI 侧卡死）。
                    // 显示错误卡 + 滚动会话自愈：下一条（含错误卡「重试」）用新 sessionId 重开，
                    // 并把近期对话作为背景转写注入新会话，避免丢失多轮上下文。
                    this.manager.updateMessage(convId, aiMsg.id, `错误: ${textContent}`);
                    this.manager.updateMessageParts(convId, aiMsg.id, undefined, true);
                    this.manager.setSessionId(convId, this.api.generateId());
                    this.preserveRecentContext(convId);
                    new Notice('上游网关无输出（Empty stream），已重置会话，请重试');
                } else {
                    this.manager.updateMessage(convId, aiMsg.id, textContent);
                }
            }

            // 流式结束后从 parts 重建（思考块标签变「已思考」、工具卡保留可折叠）
            if (isActive) {
                await this.renderMessages();
            }
            await this.manager.flush();
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${message}`);
            new Notice(`请求失败: ${message}`);
            if (isActive) {
                await this.renderMessages();
            }
        } finally {
            this.streamingMsgIds.delete(convId);
            this.stopRequests.delete(convId);
        }
    }

    /** 渲染队列条：只显示「当前活跃会话」真正等待中的排队项（chip 可 ✕ 删除 / 点击内联编辑）。
     * 正在发送的项已先出队，不在此显示；其他会话的排队项也不在此展示（各会话队列独立）。 */
    private renderQueueBar(): void {
        if (!this.queueBar) return;
        const activeId = this.manager.getActive()?.id ?? null;
        const items = activeId ? this.sendQueue.listFor(activeId) : [];
        if (items.length === 0) {
            this.queueBar.empty();
            this.queueBar.addClass('buddybridge-hidden');
            return;
        }
        this.queueBar.empty();
        this.queueBar.removeClass('buddybridge-hidden');
        for (const item of items) {
            const chip = this.queueBar.createDiv({ cls: 'buddybridge-queue-chip' });
            const body = chip.createSpan({ cls: 'buddybridge-queue-chip-text', text: item.text });
            body.onclick = () => this.editQueueItem(item.id, chip, body);

            const del = chip.createSpan({
                cls: 'buddybridge-queue-chip-del',
                attr: { title: '删除该条', 'aria-label': '删除该条', role: 'button', tabindex: '0' }
            });
            setIcon(del, 'x');
            del.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                this.removeQueueItem(item.id);
            };
            del.onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.removeQueueItem(item.id);
                }
            };
        }
    }

    private removeQueueItem(id: string): void {
        this.sendQueue.remove(id);
        this.renderQueueBar();
    }

    /** 内联编辑：点击 chip 文本 → 变为输入框；Enter 保存 / Esc 取消 / 失焦保存。 */
    private editQueueItem(id: string, chip: HTMLElement, body: HTMLElement): void {
        let cancelled = false;
        const edit = document.createElement('input');
        edit.addClass('buddybridge-queue-chip-input');
        edit.type = 'text';
        edit.value = body.textContent ?? '';
        edit.addEventListener('keydown', (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                this.commitQueueEdit(id, edit.value);
            } else if (e.key === 'Escape') {
                cancelled = true;
                this.renderQueueBar();
            }
        });
        edit.addEventListener('blur', () => {
            if (!cancelled) this.commitQueueEdit(id, edit.value);
        });
        chip.replaceChild(edit, body);
        edit.focus();
        edit.select();
    }

    /** 提交队列项编辑：空内容视为删除该条。 */
    private commitQueueEdit(id: string, text: string): void {
        const trimmed = text.trim();
        if (!trimmed) {
            this.sendQueue.remove(id);
        } else {
            this.sendQueue.update(id, trimmed);
        }
        this.renderQueueBar();
    }

    /**
     * 分支 Phase 1：从指定消息「从这里继续新对话」。
     * 新会话复制截至该消息的历史（可见上下文）+ 新 sessionId，受会话上限守卫（决策 5）。
     * 分叉后首条发送时注入对话转写，供新 session 了解此前对话。
     */
    private forkFrom(msg: ChatMessage): void {
        const conv = this.manager.getActive();
        if (!conv) return;
        const idx = conv.messages.findIndex(m => m.id === msg.id);
        if (idx < 0) return;
        // 分叉即新建窗口：达上限时被拦截并提示（守卫内部提示「对话已满」）
        if (this.atConversationLimit()) return;

        const history = conv.messages.slice(0, idx + 1);
        const newConv = this.manager.createConversation(`${conv.title}（分支）`);
        this.manager.replaceMessages(newConv.id, history);
        this.forkTranscripts.set(newConv.id, this.buildForkTranscript(history));

        this.renderTabs();
        void this.renderMessages();
        this.updateSendButton();
    }

    /** 构建分支注入转写：截至分叉点的对话（角色标注），供新 session 作为背景参考。 */
    private buildForkTranscript(messages: ChatMessage[], label = '[系统注入·分支上下文] 以下是你与此用户此前的对话（截至分支点），仅作背景参考：'): string {
        const lines: string[] = [label];
        for (const m of messages) {
            const content = m.content.trim();
            if (!content) continue;
            lines.push(`${m.role === 'user' ? '用户' : '助手'}: ${content}`);
        }
        return lines.join('\n');
    }

    /**
     * 会话滚动后保留近期上下文：把最近若干条用户/助手消息（排除错误卡）作为背景转写注入
     * 新会话首条发送（复用 forkTranscripts 机制，一次性消费，上限 12 条避免再度撑爆上下文）。
     */
    private preserveRecentContext(convId: string): void {
        const conv = this.manager.getConversation(convId);
        if (!conv) return;
        const history = conv.messages.filter(m =>
            m.role === 'user' || (m.role === 'assistant' && !m.content.startsWith('错误:'))
        );
        if (history.length === 0) return;
        this.forkTranscripts.set(
            convId,
            this.buildForkTranscript(
                history.slice(-12),
                '[系统注入·会话重置] 以下是你与此用户此前的对话（会话已因网关故障重置），仅作背景参考：'
            )
        );
    }

    private updateCurrentFileBar() {
        if (this.currentFilePath) {
            this.currentFileBar.setText(`📄 ${this.currentFilePath}`);
        } else {
            this.currentFileBar.setText('');
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}
