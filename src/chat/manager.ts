import type { Conversation, ChatMessage, MessagePart } from '../types';
import { generateId, getErrorMessage } from '../types';

export class ConversationManager {
    private conversations: Map<string, Conversation> = new Map();
    private activeId: string | null = null;
    private maxConversations = 20;
    private persistCallback: ((convs: Conversation[]) => Promise<void>) | null = null;

    setPersistCallback(callback: (convs: Conversation[]) => Promise<void>) {
        this.persistCallback = callback;
    }

    /** 设置最大对话数；创建新对话后按 updatedAt 裁剪（P0.4）。 */
    setMaxConversations(max: number): void {
        if (typeof max === 'number' && max > 0) {
            this.maxConversations = max;
        }
    }

    getMaxConversations(): number {
        return this.maxConversations;
    }

    private async persist() {
        if (this.persistCallback) {
            await this.persistCallback(this.getAll());
        }
    }

    private handlePersistError(error: unknown) {
        console.error('[BB] persist failed:', getErrorMessage(error));
    }

    /** 显式触发持久化（流式结束后调用） */
    async flush(): Promise<void> {
        await this.persist();
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
        const id = generateId();
        // 时间戳单调递增：避免毫秒级相同时间戳导致裁剪时"新会话"与"旧会话"排序不分先后
        let updatedAt = Date.now();
        for (const c of this.conversations.values()) {
            if (c.updatedAt >= updatedAt) updatedAt = c.updatedAt + 1;
        }
        const conv: Conversation = {
            id,
            title: title || '新对话',
            sessionId: '', // 首次发送消息时由 Gateway 分配
            messages: [],
            createdAt: Date.now(),
            updatedAt
        };
        this.conversations.set(id, conv);
        this.activeId = id;
        this.trimConversations();
        this.persist().catch((err) => this.handlePersistError(err));
        return conv;
    }

    /**
     * P0.4：按 updatedAt 降序保留最近 maxConversations 个会话，删除更旧的。
     * 若当前活跃会话被裁掉，回退到保留列表中最新的一条。
     */
    private trimConversations(): void {
        if (this.maxConversations <= 0) return;
        const all = this.getAll(); // 已按 updatedAt 降序
        if (all.length <= this.maxConversations) return;

        const keepIds = new Set(all.slice(0, this.maxConversations).map(c => c.id));
        for (const conv of all.slice(this.maxConversations)) {
            this.conversations.delete(conv.id);
        }
        if (this.activeId && !keepIds.has(this.activeId)) {
            this.activeId = all[0]?.id ?? null;
        }
    }

    /** 删除指定消息（用于错误卡重试时移除失败的 user+assistant 对）。返回实际删除条数。 */
    removeMessages(convId: string, ids: string[]): number {
        const conv = this.conversations.get(convId);
        if (!conv || !ids || ids.length === 0) return 0;
        const before = conv.messages.length;
        conv.messages = conv.messages.filter(m => !ids.includes(m.id));
        const removed = before - conv.messages.length;
        if (removed > 0) {
            conv.updatedAt = Date.now();
            this.persist().catch((err) => this.handlePersistError(err));
        }
        return removed;
    }

    /** 删除对话 */
    deleteConversation(id: string): boolean {
        if (!this.conversations.has(id)) return false;
        this.conversations.delete(id);
        if (this.activeId === id) {
            const remaining = this.getAll();
            this.activeId = remaining.length > 0 ? remaining[0].id : null;
        }
        this.persist().catch((err) => this.handlePersistError(err));
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
            id: generateId(),
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

        this.persist().catch((err) => this.handlePersistError(err));
        return msg;
    }

    /** 更新指定消息内容（用于流式追加） */
    updateMessage(convId: string, msgId: string, content: string, skipSave = false): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        const msg = conv.messages.find(m => m.id === msgId);
        if (!msg) return false;
        msg.content = content;
        conv.updatedAt = Date.now();
        if (!skipSave) {
            this.persist().catch((err) => this.handlePersistError(err));
        }
        return true;
    }

    /** 更新指定消息的结构化 parts（思考 / 工具调用），供流式结束后重建展示块。 */
    updateMessageParts(convId: string, msgId: string, parts: MessagePart[] | undefined, skipSave = false): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        const msg = conv.messages.find(m => m.id === msgId);
        if (!msg) return false;
        msg.parts = parts ? [...parts] : undefined;
        conv.updatedAt = Date.now();
        if (!skipSave) {
            this.persist().catch((err) => this.handlePersistError(err));
        }
        return true;
    }

    /** 设置对话的 Gateway sessionId */
    setSessionId(convId: string, sessionId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.sessionId = sessionId;
        return true;
    }

}
