import type { Conversation, ChatMessage } from '../types';

export class ConversationManager {
    private conversations: Map<string, Conversation> = new Map();
    private activeId: string | null = null;
    private persistCallback: ((convs: Conversation[]) => Promise<void>) | null = null;

    setPersistCallback(callback: (convs: Conversation[]) => Promise<void>) {
        this.persistCallback = callback;
    }

    private async save() {
        if (this.persistCallback) {
            await this.persistCallback(this.getAll());
        }
    }

    /** 从持久化数据加载对话 */
    load(conversations: Conversation[]) {
        if (!conversations || conversations.length === 0) {
            // 创建一个新对话作为默认
            this.createConversation();
            return;
        }
        for (const conv of conversations) {
            this.conversations.set(conv.id, { ...conv });
        }
        // 激活第一个
        this.activeId = conversations[0].id;
    }

    /** 创建新对话 */
    createConversation(title?: string): Conversation {
        const id = this.generateId();
        const conv: Conversation = {
            id,
            title: title || '新对话',
            sessionId: '', // 首次发送消息时由 Gateway 分配
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.conversations.set(id, conv);
        this.activeId = id;
        this.save();
        return conv;
    }

    /** 删除对话 */
    deleteConversation(id: string): boolean {
        if (!this.conversations.has(id)) return false;
        this.conversations.delete(id);
        if (this.activeId === id) {
            const remaining = this.getAll();
            this.activeId = remaining.length > 0 ? remaining[0].id : null;
        }
        this.save();
        return true;
    }

    /** 切换到指定对话 */
    switchTo(id: string): Conversation | null {
        const conv = this.conversations.get(id);
        if (!conv) return null;
        this.activeId = id;
        return conv;
    }

    /** 获取当前活跃对话 */
    getActive(): Conversation | null {
        if (!this.activeId) return null;
        return this.conversations.get(this.activeId) || null;
    }

    /** 获取所有对话（按更新时间倒序） */
    getAll(): Conversation[] {
        return Array.from(this.conversations.values())
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** 添加消息到当前活跃对话 */
    addMessage(convId: string, role: 'user' | 'assistant', content: string): ChatMessage | null {
        const conv = this.conversations.get(convId);
        if (!conv) return null;

        const msg: ChatMessage = {
            id: this.generateId(),
            role,
            content,
            timestamp: Date.now()
        };
        conv.messages.push(msg);
        conv.updatedAt = Date.now();

        // 首条用户消息自动生成标题
        if (conv.title === '新对话' && role === 'user' && content.trim()) {
            conv.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        }

        this.save();
        return msg;
    }

    /** 更新指定消息内容（用于流式追加） */
    updateMessage(convId: string, msgId: string, content: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        const msg = conv.messages.find(m => m.id === msgId);
        if (!msg) return false;
        msg.content = content;
        conv.updatedAt = Date.now();
        return true;
    }

    /** 设置对话的 Gateway sessionId */
    setSessionId(convId: string, sessionId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.sessionId = sessionId;
        return true;
    }

    private generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
