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
        bubble.createSpan({ text: msg.content });
        return row;
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

        // 创建 AI 消息占位
        const aiMsg = this.manager.addMessage(convId, 'assistant', '');
        if (!aiMsg) return;

        // 渲染占位气泡
        this.renderMessages();
        const aiBubble = this.messageContainer.querySelector(
            `.buddybridge-message-assistant:last-child .buddybridge-bubble span`
        ) as HTMLElement;

        // 流式发送
        this.isStreaming = true;
        try {
            let fullContent = '';
            for await (const chunk of this.api.sendMessage(conv.sessionId, text)) {
                fullContent += chunk;
                this.manager.updateMessage(convId, aiMsg.id, fullContent);
                // 增量更新气泡内容
                if (aiBubble) {
                    aiBubble.textContent = fullContent;
                }
            }
            this.manager.updateMessage(convId, aiMsg.id, fullContent);
            // 提取 Gateway sessionId（如果还没设置）
            if (!conv.sessionId && fullContent) {
                // sessionId 在首次响应中可能不可用；发送第二条消息时会携带
            }
        } catch (error: any) {
            this.manager.updateMessage(convId, aiMsg.id, `错误: ${error.message}`);
            new Notice(`请求失败: ${error.message}`);
        } finally {
            this.isStreaming = false;
            this.renderMessages();
            this.renderTabs();
        }
    }

    private scrollToBottom() {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
}