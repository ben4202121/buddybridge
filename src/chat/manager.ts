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

    /** 设置最大对话数；达到上限时禁止新建（方向 A，由 UI 层守卫提示）。 */
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
            updatedAt,
            attachedFiles: [],
        };
        this.conversations.set(id, conv);
        this.activeId = id;
        this.persist().catch((err) => this.handlePersistError(err));
        return conv;
    }

    /** 是否已达到最大对话数（方向 A：达到上限禁止新建，由 UI 层守卫提示）。 */
    atMaxConversations(): boolean {
        return this.conversations.size >= this.maxConversations;
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

    /** 清除指定对话的所有消息并重置标题（/clear 语义：清当前对话，不新建）。
     * 同时重置 sessionId —— CLI 侧会话历史彻底作废，下一条消息换新 session 全新开始。 */
    clearConversation(convId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.messages = [];
        conv.title = '新对话';
        conv.sessionId = '';
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
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

    /** 按 id 获取对话（用于队列项按会话定位；不存在返回 null）。 */
    getConversation(id: string): Conversation | null {
        return this.conversations.get(id) ?? null;
    }

    /** 批量替换指定会话的消息列表（用于分支复制历史），持久化一次。 */
    replaceMessages(convId: string, messages: ChatMessage[]): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.messages = messages.map(m => ({
            ...m,
            parts: m.parts ? m.parts.map(p => ({ ...p })) : undefined
        }));
        // 只升不降：分叉会话创建时已带单调递增的 updatedAt（createConversation 的 max+1），
        // 这里若回退到 Date.now() 会让新分叉排序落到旧会话后面（分叉后找不到）。
        conv.updatedAt = Math.max(conv.updatedAt, Date.now());
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
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

    /** 附加文件到指定会话（P2.4）：去重合并，持久化。返回实际新增数。 */
    attachFiles(convId: string, paths: string[]): number {
        const conv = this.conversations.get(convId);
        if (!conv || !paths || paths.length === 0) return 0;
        const existing = new Set(conv.attachedFiles);
        const added: string[] = [];
        for (const p of paths) {
            if (typeof p === 'string' && p.trim() && !existing.has(p)) {
                existing.add(p);
                added.push(p);
            }
        }
        if (added.length === 0) return 0;
        conv.attachedFiles = Array.from(existing);
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return added.length;
    }

    /** 从指定会话移除一个附加文件（P2.4），持久化。 */
    detachFile(convId: string, path: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        const before = conv.attachedFiles.length;
        conv.attachedFiles = conv.attachedFiles.filter(p => p !== path);
        if (conv.attachedFiles.length === before) return false;
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
    }

    /** 清空指定会话的附加文件（P2.4）。 */
    clearAttachedFiles(convId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv || conv.attachedFiles.length === 0) return false;
        conv.attachedFiles = [];
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
    }

}
