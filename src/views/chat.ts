import { ItemView, Notice, MarkdownRenderer, Component, setIcon, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { ConversationManager } from '../chat/manager';
import { BuddyBridgeAPI } from '../api';
import { getErrorMessage, type Conversation, type AttachedFile } from '../types';

const ALLOWED_EXTENSIONS = new Set(['txt', 'md', 'docx', 'doc', 'pdf', 'xls', 'xlsx']);

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

export const VIEW_TYPE_CHAT = "buddybridge-panel";

export class BuddyBridgeChatView extends ItemView {
    private manager: ConversationManager;
    private api: BuddyBridgeAPI;
    private messageContainer!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;
    private sendBtn!: HTMLButtonElement;
    private tabBar!: HTMLElement;
    private currentFileBar!: HTMLElement;
    private attachments: AttachedFile[] = [];
    private attachmentsBar!: HTMLElement;
    private streamingConversations: Set<string> = new Set();
    private streamingMsgId: string | null = null;
    private markdownComponent: Component;
    private loadDataCallback: () => Promise<Conversation[]>;
    private commandDropdown!: HTMLElement | null;

    private get vaultPath(): string | undefined {
        const adapter = this.app.vault.adapter as { basePath?: string };
        return adapter.basePath;
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

        // 应用自定义主色调
        const plugin = this.app.plugins.getPlugin('buddybridge');
        if (plugin && plugin.settings && plugin.settings.primaryColor) {
            this.setCssProps(container, { '--buddybridge-primary': plugin.settings.primaryColor });
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

        // 监听文件切换
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
        this.sendBtn.onclick = () => this.sendMessage();

        // 拖拽支持
        this.setupDragDrop();

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

    private async createNewChat() {
        this.manager.createConversation();
        this.renderTabs();
        await this.renderMessages();
        this.setInputEnabled(true);
        this.sendBtn.setText('发送');
    }

    private async switchToChat(id: string) {
        this.manager.switchTo(id);
        this.renderTabs();
        await this.renderMessages();
        const isSending = this.streamingConversations.has(id);
        this.setInputEnabled(!isSending);
        this.sendBtn.setText(isSending ? '发送中...' : '发送');
    }

    private async deleteChat(id: string, e: UIEvent) {
        e.stopPropagation();
        this.manager.deleteConversation(id);
        this.renderTabs();
        await this.renderMessages();
        this.setInputEnabled(true);
        this.sendBtn.setText('发送');
    }

    private async continueConversation() {
        const conv = this.manager.getActive();
        if (!conv || conv.messages.length < 2) {
            new Notice('对话太短，无需续接');
            return;
        }

        // 保存旧消息用于构建摘要
        const oldMessages = conv.messages;
        const oldTitle = conv.title;

        // 创建新对话
        const newConv = this.manager.createConversation(oldTitle + ' (续)');
        newConv.sessionId = this.api.generateId();

        // 构建摘要：取首条用户消息 + 最近几条消息
        const firstUserMsg = oldMessages.find(m => m.role === 'user');
        const recentMsgs = oldMessages.slice(-6);

        const summaryParts: string[] = [
            `【续接对话】上轮对话「${oldTitle}」已到达上限，自动延续到新对话。`,
            '',
            `📋 上轮对话摘要（共 ${oldMessages.length} 条消息）`,
            '',
        ];

        if (firstUserMsg) {
            summaryParts.push(`**最初目标**: ${firstUserMsg.content.substring(0, 200)}`);
            summaryParts.push('');
        }

        summaryParts.push('**最近交流**:');
        for (const m of recentMsgs) {
            const label = m.role === 'user' ? '👤 用户' : '🤖 AI';
            const content = m.content.substring(0, 300);
            summaryParts.push(`> ${label}: ${content}`);
        }

        summaryParts.push('');
        summaryParts.push('---');
        summaryParts.push('请基于以上上下文继续工作。');

        const summary = summaryParts.join('\n');

        // 把摘要作为新对话的第一条消息
        newConv.messages.push({
            id: this.api.generateId(),
            role: 'assistant',
            content: summary,
            timestamp: Date.now(),
        });

        // 切换到新对话
        this.renderTabs();
        await this.renderMessages();
        this.scrollToBottom();
        new Notice('已创建续接对话，上下文已保留');
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

            // 续接按钮（仅当有消息时显示）
            if (conv.messages.length >= 2) {
                const continueBtn = tab.createSpan({
                    cls: 'buddybridge-tab-continue',
                    attr: { title: '续接新对话', 'aria-label': '续接新对话', role: 'button', tabindex: '0' }
                });
                continueBtn.setText('↻');
                continueBtn.onclick = (e: MouseEvent) => {
                    e.stopPropagation();
                    void this.continueConversation();
                };
                continueBtn.onkeydown = (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void this.continueConversation();
                    }
                };
            }

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
                '发送文件让 AI 读取（支持 txt, md, pdf, docx, xlsx）',
                '拖拽文件到聊天面板快速附加',
                'Shift+Enter 换行，Enter 发送',
                '多轮对话自动保持上下文',
            ];
            for (const tip of tipItems) {
                tipList.createEl('li', { text: tip });
            }
            return;
        }

        for (const msg of conv.messages) {
            await this.renderMessage(msg);
        }

        this.scrollToBottom();
    }

    private async renderMessage(msg: ChatMessage) {
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
                this.renderErrorCard(bubble, msg.content);
            } else {
                await this.renderMarkdownContent(bubble, msg.content);
            }
        } else {
            // 用户消息中的错误也显示为卡片
            if (msg.content.startsWith('错误:') || msg.content.startsWith('Error:')) {
                this.renderErrorCard(bubble, msg.content);
            } else {
                bubble.createSpan({ text: msg.content });
            }
        }
        return row;
    }

    private renderErrorCard(bubble: HTMLElement, content: string) {
        const card = bubble.createDiv({ cls: 'buddybridge-error-card' });
        const icon = card.createDiv({ cls: 'buddybridge-error-card-icon' });
        setIcon(icon, 'alert-triangle');

        // 提取错误消息（去掉 "错误: " 前缀）
        const errorMsg = content.replace(/^错误:\s*/, '').replace(/^Error:\s*/, '');
        card.createDiv({ cls: 'buddybridge-error-card-title', text: '请求失败' });
        card.createDiv({ cls: 'buddybridge-error-card-body', text: errorMsg });

        // 根据错误内容提供可操作提示
        const hint = this.getErrorHint(errorMsg);
        if (hint) {
            card.createDiv({ cls: 'buddybridge-error-card-hint', text: hint });
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
            return '请求超时，请重试。如果频繁出现，请检查网络连接或 CodeBuddy 状态。';
        }
        if (errorMsg.includes('无响应') || errorMsg.includes('no response') || errorMsg.includes('empty')) {
            return 'AI 未返回任何内容，请重试。如果问题持续，请检查 CodeBuddy 是否正常运行。';
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
    }

    private adjustTextareaHeight() {
        this.setCssProps(this.inputEl, { '--buddybridge-input-height': 'auto' });
        this.setCssProps(this.inputEl, { '--buddybridge-input-height': `${this.inputEl.scrollHeight}px` });
    }

    private setInputEnabled(enabled: boolean) {
        this.inputEl.disabled = !enabled;
        this.sendBtn.disabled = !enabled;
        this.sendBtn.setText(enabled ? '发送' : '发送中...');
    }

    private updateCommandDropdown() {
        const val = this.inputEl.value;
        // 只显示命令列表
        if (val === '/') {
            if (!this.commandDropdown) {
                this.commandDropdown = this.inputEl.parentElement?.createDiv({ cls: 'buddybridge-command-dropdown' }) ?? null;
                if (this.commandDropdown) {
                    for (const [cmd, info] of Object.entries(COMMANDS)) {
                        const item = this.commandDropdown.createDiv({ cls: 'buddybridge-command-item' });
                        const nameSpan = item.createSpan({ cls: 'buddybridge-command-name', text: cmd });
                        item.createSpan({ cls: 'buddybridge-command-desc', text: info });
                        item.onclick = () => {
                            this.inputEl.value = cmd + ' ';
                            this.inputEl.focus();
                            this.removeCommandDropdown();
                        };
                    }
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

    private addAttachment(file: AttachedFile) {
        // 避免重复添加
        if (this.attachments.some(a => a.path === file.path)) return;
        this.attachments.push(file);
        this.renderAttachments();
    }

    private removeAttachment(path: string) {
        this.attachments = this.attachments.filter(a => a.path !== path);
        this.renderAttachments();
    }

    private renderAttachments() {
        this.attachmentsBar.empty();
        if (this.attachments.length === 0) return;

        for (const file of this.attachments) {
            const chip = this.attachmentsBar.createDiv({ cls: 'buddybridge-attachment-chip' });
            const icon = chip.createSpan({ cls: 'buddybridge-attachment-chip-icon' });
            setIcon(icon, 'file-text');
            chip.createSpan({ cls: 'buddybridge-attachment-chip-name', text: file.name });
            const closeBtn = chip.createSpan({
                cls: 'buddybridge-attachment-chip-close',
                attr: { role: 'button', 'aria-label': '移除文件', tabindex: '0' }
            });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.removeAttachment(file.path);
            };
            closeBtn.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.removeAttachment(file.path);
                }
            };
        }

        // 显示文件数量
        const count = this.attachmentsBar.createDiv({ cls: 'buddybridge-attachment-count' });
        count.createSpan({ text: `${this.attachments.length} 个文件` });
    }

    private setupDragDrop() {
        const container = this.containerEl;

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.addClass('buddybridge-drag-over');
        });

        container.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.addClass('buddybridge-drag-over');
        });

        container.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.removeClass('buddybridge-drag-over');
        });

        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.removeClass('buddybridge-drag-over');

            // 尝试从 Obsidian 文件管理器拖拽（text/plain 包含文件路径）
            const path = e.dataTransfer?.getData('text/plain');
            if (path) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const ext = file.extension.toLowerCase();
                    if (ALLOWED_EXTENSIONS.has(ext)) {
                        this.addAttachment({
                            name: file.name,
                            path: file.path,
                            extension: file.extension,
                        });
                        new Notice(`已附加: ${file.name}`);
                        return;
                    }
                }
            }

            // 可能是 Obsidian 内部拖拽，尝试其他数据格式
            const uriList = e.dataTransfer?.getData('text/uri-list');
            if (uriList) {
                new Notice('不支持从该位置拖拽文件，请使用回形针按钮选择文件');
            }
        });
    }

    private async sendMessage() {
        // 检查该对话是否正在流式响应
        const activeConv = this.manager.getActive();
        if (!activeConv) return;
        if (this.streamingConversations.has(activeConv.id)) return;

        const text = this.inputEl.value.trim();
        if (!text) return;

        // 处理斜杠命令
        if (text.startsWith('/')) {
            const cmd = text.split(' ')[0].toLowerCase();
            if (cmd === '/clear') {
                this.createNewChat();
                return;
            }
            // 其他命令（含 /help）透传给 CLI
            await this.sendCommandToCLI(text);
            return;
        }

        // 确保有活跃对话
        let conv = this.manager.getActive();
        if (!conv) {
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
        try {
            // 注入 vault 上下文 + 当前文件 + 附件
            const activeFile = this.app.workspace.getActiveFile();
            const activeFilePath = activeFile?.path || null;
            const filesContext = '';
            const contextText = text;

            // 用 querySelectorAll 取最后一个 assistant bubble，不受 continue 等元素干扰
            const bubbles = this.messageContainer.querySelectorAll('.buddybridge-message-assistant .buddybridge-bubble');
            const streamingBubble = bubbles.length > 0 ? bubbles[bubbles.length - 1] as HTMLElement : null;
            if (!streamingBubble) {
                throw new Error('找不到 Assistant 消息气泡');
            }

            for await (const chunk of this.api.sendMessage(conv.sessionId, contextText, this.vaultPath)) {
                const bubble = streamingBubble;

                // 过滤 CLI 的启动确认消息
                if (chunk.type === 'text' && /(Working directory|文件操作规则|待命中|已锁定|已确认)/.test(chunk.content)) {
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
                    let block = bubble.querySelector('.buddybridge-thinking-block');
                    if (!(block instanceof HTMLElement)) {
                        block = bubble.createDiv({ cls: 'buddybridge-thinking-block' });
                        const header = block.createDiv({ cls: 'buddybridge-thinking-header' });
                        const icon = header.createSpan({ cls: 'buddybridge-thinking-header-icon' });
                        setIcon(icon, 'sparkles');
                        header.createSpan({ cls: 'buddybridge-thinking-header-text', text: '思考中...' });
                        const chevron = header.createSpan({ cls: 'buddybridge-thinking-header-chevron', text: '▾' });

                        const bodyDiv = block.createDiv({ cls: 'buddybridge-thinking-body buddybridge-hidden' });
                        header.addEventListener('click', () => {
                            const hidden = bodyDiv.hasClass('buddybridge-hidden');
                            bodyDiv.toggleClass('buddybridge-hidden', !hidden);
                            chevron.textContent = hidden ? '▾' : '▸';
                        });
                    }
                    const body = block.querySelector('.buddybridge-thinking-body');
                    if (body instanceof HTMLElement) {
                        body.setText(thinkingContent);
                    }
                } else if (chunk.type === 'tool') {
                    let toolsBlock = bubble.querySelector('.buddybridge-tools-block');
                    if (!(toolsBlock instanceof HTMLElement)) {
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
                    const list = toolsBlock.querySelector('.buddybridge-tools-list');
                    if (list instanceof HTMLElement) {
                        const toolName = chunk.toolName || '';
                        const toolDetail = chunk.toolDetail || '';
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
                } else if (chunk.type === 'text') {
                    textContent += chunk.content;
                    this.manager.updateMessage(convId, aiMsg.id, textContent, true);
                    await this.renderMarkdownContent(bubble, textContent);
                } else if (chunk.type === 'error') {
                    this.manager.updateMessage(convId, aiMsg.id, `错误: ${chunk.content}`, true);
                    new Notice(`请求失败: ${chunk.content}`);
                }
            }

            const finalContent = textContent || thinkingContent;
            this.manager.updateMessage(convId, aiMsg.id, finalContent);

            if (!finalContent) {
                this.manager.updateMessage(convId, aiMsg.id, '错误: AI 未返回任何内容。请重试，或检查 CodeBuddy 是否正常运行。');
            }

            // 流式结束后再渲染一次，确保思考指示器等占位元素被清除
            const thinkingLabel = streamingBubble.querySelector('.buddybridge-thinking-header-text');
            if (thinkingLabel instanceof HTMLElement) {
                thinkingLabel.setText('已思考');
            }
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
            this.setInputEnabled(true);
        }
    }

    private async sendCommandToCLI(command: string) {
        let conv = this.manager.getActive();
        if (!conv) {
            conv = this.manager.createConversation();
            this.renderTabs();
        }
        if (!conv.sessionId) {
            conv.sessionId = this.api.generateId();
        }

        const convId = conv.id;
        this.manager.addMessage(convId, 'user', command);
        this.inputEl.value = '';
        this.adjustTextareaHeight();
        await this.renderMessages();

        const aiMsg = this.manager.addMessage(convId, 'assistant', '');
        if (!aiMsg) return;

        this.streamingMsgId = aiMsg.id;
        this.streamingConversations.add(convId);
        this.setInputEnabled(false);
        await this.renderMessages();

        let responseText = '';
        try {
            for await (const chunk of this.api.sendMessage(conv.sessionId, command, this.vaultPath)) {
                if (chunk.type === 'text') {
                    responseText += chunk.content;
                    this.manager.updateMessage(convId, aiMsg.id, responseText, true);
                    // 更新气泡
                    const bubs = this.messageContainer.querySelectorAll('.buddybridge-message-assistant .buddybridge-bubble');
                    const bubble = bubs.length > 0 ? bubs[bubs.length - 1] as HTMLElement : null;
                    if (bubble) {
                        await this.renderMarkdownContent(bubble, responseText);
                    }
                } else if (chunk.type === 'error') {
                    this.manager.updateMessage(convId, aiMsg.id, `错误: ${chunk.content}`, true);
                    new Notice(`命令执行失败: ${chunk.content}`);
                }
            }

            const finalContent = responseText || '（命令执行完成，无输出）';
            this.manager.updateMessage(convId, aiMsg.id, finalContent);
            await this.renderMessages();
            await this.manager.flush();
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${message}`);
            new Notice(`命令执行失败: ${message}`);
            await this.renderMessages();
        } finally {
            this.streamingConversations.delete(convId);
            this.streamingMsgId = null;
            this.setInputEnabled(true);
        }
    }

    private updateCurrentFileBar() {
        const file = this.app.workspace.getActiveFile();
        if (file) {
            this.currentFileBar.setText(`📄 ${file.path}`);
            this.currentFileBar.addClass('buddybridge-current-file-active');
        } else {
            this.currentFileBar.setText('');
            this.currentFileBar.removeClass('buddybridge-current-file-active');
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}
