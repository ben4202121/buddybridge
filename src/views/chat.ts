import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, Component, setIcon } from 'obsidian';
import { ConversationManager } from '../chat/manager';
import { BuddyBridgeAPI, type StreamChunk } from '../api';
import type { Conversation, ChatMessage } from '../types';

export const VIEW_TYPE_CHAT = "buddybridge-panel";

export class BuddyBridgeChatView extends ItemView {
    private manager: ConversationManager;
    private api: BuddyBridgeAPI;
    private messageContainer!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;
    private tabBar!: HTMLElement;
    private isStreaming: boolean = false;
    private streamingMsgId: string | null = null;
    private markdownComponent: Component;
    private loadDataCallback: () => Promise<Conversation[]>;

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

        // 顶部标签栏
        this.tabBar = container.createDiv({ cls: 'buddybridge-tab-bar' });
        const newBtn = this.tabBar.createEl('button', {
            text: '',
            cls: 'buddybridge-new-chat-btn',
            attr: { title: '新建对话', 'aria-label': '新建对话' }
        });
        setIcon(newBtn, 'plus');
        newBtn.onclick = () => this.createNewChat();

        // 消息区域
        this.messageContainer = container.createDiv({ cls: 'buddybridge-messages' });

        // 底部输入区
        const inputArea = container.createDiv({ cls: 'buddybridge-input-area' });
        this.inputEl = inputArea.createEl('textarea', {
            cls: 'buddybridge-input',
            attr: { placeholder: '输入消息... (Shift+Enter 换行，Enter 发送)', rows: '2' }
        });
        this.inputEl.onkeydown = (e) => this.handleKeydown(e);
        this.inputEl.oninput = () => this.adjustTextareaHeight();

        const sendBtn = inputArea.createEl('button', {
            text: '发送',
            cls: 'buddybridge-send-btn',
            attr: { 'aria-label': '发送' }
        });
        sendBtn.onclick = () => this.sendMessage();

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
    }

    private async switchToChat(id: string) {
        this.manager.switchTo(id);
        this.renderTabs();
        await this.renderMessages();
    }

    private async deleteChat(id: string, e: MouseEvent) {
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
            closeBtn.onclick = (e) => this.deleteChat(conv.id, e);
            closeBtn.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.deleteChat(conv.id, e as unknown as MouseEvent);
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
            empty.createDiv({ cls: 'buddybridge-empty-chat-subtitle', text: '点击上方 + 按钮或输入消息开始聊天' });
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
            await this.renderMarkdownContent(bubble, msg.content);
        } else {
            bubble.createSpan({ text: msg.content });
        }
        return row;
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
        let markdownContainer = bubble.querySelector('.buddybridge-markdown-content') as HTMLElement;
        if (!markdownContainer) {
            markdownContainer = bubble.createDiv({ cls: 'buddybridge-markdown-content' });

            // 如果有思考块/工具块，将 Markdown 内容插入到它们之前
            if (thinkingBlock) {
                bubble.insertBefore(markdownContainer, thinkingBlock);
            } else if (toolsBlock) {
                bubble.insertBefore(markdownContainer, toolsBlock);
            }
        }

        // 清空之前渲染的内容
        markdownContainer.empty();

        await MarkdownRenderer.renderMarkdown(
            content,
            markdownContainer,
            '',
            this.markdownComponent
        );
    }

    private adjustTextareaHeight() {
        this.inputEl.style.setProperty('--buddybridge-input-height', `${this.inputEl.scrollHeight}px`);
    }

    private async handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await this.sendMessage();
        }
    }

    private async sendMessage() {
        if (this.isStreaming) return;

        const text = this.inputEl.value.trim();
        if (!text) return;

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
        this.isStreaming = true;
        await this.renderMessages();

        // 流式发送
        let firstChunk = true;
        let thinkingContent = '';
        let textContent = '';
        try {
            // 注入 vault 上下文
            const contextText = this.vaultPath
                ? `当前 Obsidian Vault 路径: ${this.vaultPath}
工作目录即 vault 根目录，请基于 vault 中的文件回答问题。

---

${text}`
                : text;

            const streamingBubble = this.messageContainer.querySelector(
                `.buddybridge-message-assistant:last-child .buddybridge-bubble`
            ) as HTMLElement;

            for await (const chunk of this.api.sendMessage(conv.sessionId, contextText, this.vaultPath)) {
                if (!streamingBubble) continue;
                const bubble = streamingBubble;

                if (firstChunk) {
                    firstChunk = false;
                    // 移除思考指示器
                    const thinking = bubble.querySelector('.buddybridge-thinking') as HTMLElement;
                    if (thinking) {
                        thinking.addClass('buddybridge-thinking-fadeout');
                        await new Promise(r => setTimeout(r, 200));
                        thinking.remove();
                    }
                }

                if (chunk.type === 'thinking') {
                    thinkingContent += chunk.content;
                    let block = bubble.querySelector('.buddybridge-thinking-block') as HTMLElement;
                    if (!block) {
                        block = bubble.createDiv({ cls: 'buddybridge-thinking-block' });
                        const header = block.createDiv({ cls: 'buddybridge-thinking-header' });
                        const icon = header.createSpan({ cls: 'buddybridge-thinking-header-icon' });
                        setIcon(icon, 'sparkles');
                        const label = header.createSpan({ cls: 'buddybridge-thinking-header-text', text: '思考中...' });
                        const chevron = header.createSpan({ cls: 'buddybridge-thinking-header-chevron', text: '▾' });

                        const bodyDiv = block.createDiv({ cls: 'buddybridge-thinking-body buddybridge-hidden' });
                        header.addEventListener('click', () => {
                            const hidden = bodyDiv.hasClass('buddybridge-hidden');
                            bodyDiv.toggleClass('buddybridge-hidden', !hidden);
                            chevron.textContent = hidden ? '▾' : '▸';
                        });
                    }
                    const body = block.querySelector('.buddybridge-thinking-body') as HTMLElement;
                    if (body) {
                        body.setText(thinkingContent);
                    }
                } else if (chunk.type === 'tool') {
                    let toolsBlock = bubble.querySelector('.buddybridge-tools-block') as HTMLElement;
                    if (!toolsBlock) {
                        toolsBlock = bubble.createDiv({ cls: 'buddybridge-tools-block' });
                        const hdr = toolsBlock.createDiv({ cls: 'buddybridge-tools-header' });
                        const icon = hdr.createSpan({ cls: 'buddybridge-tools-header-icon' });
                        setIcon(icon, 'wrench');
                        const label = hdr.createSpan({ cls: 'buddybridge-tools-header-text', text: '工具调用' });
                        const chevron = hdr.createSpan({ cls: 'buddybridge-tools-header-chevron', text: '▾' });

                        hdr.addEventListener('click', () => {
                            const list = toolsBlock.querySelector('.buddybridge-tools-list') as HTMLElement;
                            if (list) {
                                const hidden = list.hasClass('buddybridge-hidden');
                                list.toggleClass('buddybridge-hidden', !hidden);
                                chevron.textContent = hidden ? '▾' : '▸';
                            }
                        });
                        toolsBlock.createDiv({ cls: 'buddybridge-tools-list buddybridge-hidden' });
                    }
                    const list = toolsBlock.querySelector('.buddybridge-tools-list') as HTMLElement;
                    if (list) {
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
                this.manager.updateMessage(convId, aiMsg.id, '（无响应，请重试）');
            }

            // 流式结束后再渲染一次，确保思考指示器等占位元素被清除
            if (streamingBubble) {
                const thinkingLabel = streamingBubble.querySelector('.buddybridge-thinking-header-text') as HTMLElement;
                if (thinkingLabel) {
                    thinkingLabel.setText('已思考');
                }
            }
            await this.renderMessages();
            await this.manager.flush();
        } catch (error: any) {
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${error.message}`);
            new Notice(`请求失败: ${error.message}`);
            await this.renderMessages();
        } finally {
            this.isStreaming = false;
            this.streamingMsgId = null;
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}
