import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { ConversationManager } from '../chat/manager';
import { BuddyBridgeAPI } from '../api';
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
        try {
            // 注入 vault 上下文，让 codebuddy 知道知识库在哪
            const contextText = this.vaultPath
                ? `当前 Obsidian Vault 路径: ${this.vaultPath}
工作目录即 vault 根目录，请基于 vault 中的文件回答问题。

---

${text}`
                : text;

            let fullContent = '';
            for await (const chunk of this.api.sendMessage(conv.sessionId, contextText, this.vaultPath)) {
                fullContent += chunk;
                this.manager.updateMessage(convId, aiMsg.id, fullContent);
                // 增量更新气泡内容
                const bubble = this.messageContainer.querySelector(
                    `.buddybridge-message-assistant:last-child .buddybridge-bubble`
                ) as HTMLElement;
                if (!bubble) continue;

                if (firstChunk) {
                    // 首个 token：替换思考指示器为实际内容
                    firstChunk = false;
                    const thinking = bubble.querySelector('.buddybridge-thinking') as HTMLElement;
                    if (thinking) {
                        thinking.addClass('buddybridge-thinking-fadeout');
                        // 等待淡出动画结束后替换
                        await new Promise(r => setTimeout(r, 200));
                        thinking.remove();
                    }
                    bubble.createSpan({ text: fullContent });
                } else {
                    const span = bubble.querySelector('span');
                    if (span) {
                        span.textContent = fullContent;
                    }
                }
            }
            this.manager.updateMessage(convId, aiMsg.id, fullContent);

            // 无响应：可能超时或进程异常退出
            if (!fullContent) {
                this.manager.updateMessage(convId, aiMsg.id, '（无响应，请重试）');
            }
        } catch (error: any) {
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${error.message}`);
            new Notice(`请求失败: ${error.message}`);
        } finally {
            this.isStreaming = false;
            this.streamingMsgId = null;
            this.renderMessages();
            this.renderTabs();
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}