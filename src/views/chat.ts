import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
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

    private get vaultPath(): string | undefined {
        const adapter = this.app.vault.adapter as { basePath?: string };
        return adapter.basePath;
    }

    constructor(leaf: WorkspaceLeaf, api: BuddyBridgeAPI) {
        super(leaf);
        this.api = api;
        this.manager = new ConversationManager();
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
            text: '+',
            cls: 'buddybridge-new-chat-btn',
            attr: { title: '新建对话' }
        });
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

        const sendBtn = inputArea.createEl('button', {
            text: '发送',
            cls: 'buddybridge-send-btn'
        });
        sendBtn.onclick = () => this.sendMessage();
    }

    loadConversations(conversations: Conversation[]) {
        this.manager.load(conversations);
        this.renderTabs();
        this.renderMessages();
    }

    private createNewChat() {
        this.manager.createConversation();
        this.renderTabs();
        this.renderMessages();
    }

    private switchToChat(id: string) {
        this.manager.switchTo(id);
        this.renderTabs();
        this.renderMessages();
    }

    private deleteChat(id: string, e: MouseEvent) {
        e.stopPropagation();
        this.manager.deleteConversation(id);
        this.renderTabs();
        this.renderMessages();
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
            const closeBtn = tab.createSpan({ text: '×', cls: 'buddybridge-tab-close' });
            closeBtn.onclick = (e) => this.deleteChat(conv.id, e);
            tab.onclick = () => this.switchToChat(conv.id);

            // 把新建按钮放在最后
            if (newBtn) {
                tab.after(newBtn);
            }
        }
    }

    renderMessages() {
        this.messageContainer.empty();
        const conv = this.manager.getActive();
        if (!conv) {
            this.messageContainer.createDiv({
                text: '点击 + 新建对话',
                cls: 'buddybridge-empty-chat'
            });
            return;
        }

        for (const msg of conv.messages) {
            this.renderMessage(msg);
        }

        this.scrollToBottom();
    }

    private renderMessage(msg: ChatMessage) {
        const row = this.messageContainer.createDiv({
            cls: `buddybridge-message-row buddybridge-message-${msg.role}`
        });
        const bubble = row.createDiv({ cls: 'buddybridge-bubble' });

        // 仅当前正在等待回复的消息显示思考指示器
        const isWaiting = msg.role === 'assistant' && msg.content === '' && msg.id === this.streamingMsgId;
        if (isWaiting) {
            this.renderThinkingIndicator(bubble);
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
        this.renderMessages();

        // 创建 AI 消息占位，标记为等待回复中
        const aiMsg = this.manager.addMessage(convId, 'assistant', '');
        if (!aiMsg) return;

        this.streamingMsgId = aiMsg.id;
        this.isStreaming = true;
        this.renderMessages();

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
                        const header = block.createDiv({ cls: 'buddybridge-thinking-header', text: '思考过程 ▾' });
                        
                        const bodyDiv = block.createDiv({ cls: 'buddybridge-thinking-body' });
                        header.addEventListener('click', () => {
                            const hidden = bodyDiv.style.display === 'none';
                            bodyDiv.style.display = hidden ? '' : 'none';
                            header.textContent = hidden ? '思考过程 ▾' : '思考过程 ▸';
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
                        const hdr = toolsBlock.createDiv({ cls: 'buddybridge-tools-header', text: '🔧 工具调用 ▾' });
                        hdr.addEventListener('click', () => {
                            const list = toolsBlock.querySelector('.buddybridge-tools-list') as HTMLElement;
                            if (list) {
                                const hidden = list.style.display === 'none';
                                list.style.display = hidden ? '' : 'none';
                                hdr.textContent = hidden ? '🔧 工具调用 ▾' : '🔧 工具调用 ▸';
                            }
                        });
                        toolsBlock.createDiv({ cls: 'buddybridge-tools-list' });
                    }
                    const list = toolsBlock.querySelector('.buddybridge-tools-list') as HTMLElement;
                    if (list) {
                        list.createDiv({
                            cls: 'buddybridge-tool-call',
                            text: `${chunk.toolName || ''} ${chunk.toolDetail || ''}`
                        });
                    }
                } else if (chunk.type === 'text') {
                    textContent += chunk.content;
                    this.manager.updateMessage(convId, aiMsg.id, textContent, true);
                    let span = bubble.querySelector(':scope > span') as HTMLElement;
                    if (!span) {
                        span = bubble.createSpan({ text: '' });
                    }
                    span.textContent = textContent;
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
            await this.manager.flush();
        } catch (error: any) {
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${error.message}`);
            new Notice(`请求失败: ${error.message}`);
            this.renderMessages();
        } finally {
            this.isStreaming = false;
            this.streamingMsgId = null;
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}
