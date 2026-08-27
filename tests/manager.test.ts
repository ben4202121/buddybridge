import { ConversationManager } from '../src/chat/manager';
import type { Conversation } from '../src/types';

describe('ConversationManager', () => {
    let manager: ConversationManager;
    let persisted: unknown[];

    beforeEach(() => {
        manager = new ConversationManager();
        persisted = [];
        manager.setPersistCallback(async (convs) => {
            persisted.push(convs);
        });
    });

    it('creates a conversation and sets it active', () => {
        const conv = manager.createConversation();
        expect(conv.title).toBe('新对话');
        expect(manager.getActive()?.id).toBe(conv.id);
    });

    it('creates a conversation with a custom title', () => {
        const conv = manager.createConversation('custom title');
        expect(conv.title).toBe('custom title');
    });

    it('loads conversations from persisted data and activates the first', async () => {
        const conversations: Conversation[] = [
            { id: '1', title: 'first', sessionId: '', messages: [], createdAt: 100, updatedAt: 100 },
            { id: '2', title: 'second', sessionId: '', messages: [], createdAt: 200, updatedAt: 200 }
        ];
        manager.load(conversations);
        expect(manager.getActive()?.id).toBe('1');
        expect(manager.getAll()).toHaveLength(2);
        await new Promise(r => setTimeout(r, 0));
        expect(persisted.length).toBeGreaterThanOrEqual(0);
    });

    it('creates a default conversation when loading empty array', () => {
        manager.load([]);
        expect(manager.getActive()).not.toBeNull();
        expect(manager.getAll()).toHaveLength(1);
    });

    it('switches between conversations', () => {
        const a = manager.createConversation('A');
        const b = manager.createConversation('B');
        expect(manager.getActive()?.id).toBe(b.id);
        manager.switchTo(a.id);
        expect(manager.getActive()?.id).toBe(a.id);
        expect(manager.switchTo('missing')).toBeNull();
    });

    it('adds messages and updates conversation title from first user message', async () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'user', 'Hello world, this is a long message');
        expect(msg).not.toBeNull();
        expect(manager.getActive()?.messages).toHaveLength(1);
        expect(manager.getActive()?.title).toBe('Hello world, this is a long me...');
        await new Promise(r => setTimeout(r, 0));
    });

    it('updates an existing message', () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'assistant', 'initial');
        expect(msg).not.toBeNull();
        if (!msg) return;
        const updated = manager.updateMessage(conv.id, msg.id, 'updated');
        expect(updated).toBe(true);
        expect(manager.getActive()?.messages[0].content).toBe('updated');
    });

    it('returns false when updating a non-existent message', () => {
        const conv = manager.createConversation();
        expect(manager.updateMessage(conv.id, 'missing', 'x')).toBe(false);
    });

    it('updates message parts (thinking/tool persistence)', async () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'assistant', '');
        expect(msg).not.toBeNull();
        const parts = [{ kind: 'thinking' as const, content: 'step' }];
        expect(manager.updateMessageParts(conv.id, msg!.id, parts, true)).toBe(true);
        expect(manager.getActive()?.messages[0].parts).toEqual(parts);
        expect(manager.updateMessageParts(conv.id, 'missing', parts)).toBe(false);
    });

    it('deletes a conversation and activates another', () => {
        const a = manager.createConversation('A');
        const b = manager.createConversation('B');
        expect(manager.deleteConversation(b.id)).toBe(true);
        expect(manager.getActive()?.id).toBe(a.id);
        expect(manager.deleteConversation('missing')).toBe(false);
    });

    it('sets session id', () => {
        const conv = manager.createConversation();
        expect(manager.setSessionId(conv.id, 'session-1')).toBe(true);
        expect(manager.getActive()?.sessionId).toBe('session-1');
        expect(manager.setSessionId('missing', 'session')).toBe(false);
    });

    it('flushes persistence', async () => {
        manager.createConversation('flush');
        await manager.flush();
        expect(persisted.length).toBeGreaterThan(0);
    });

    it('sets and reads maxConversations', () => {
        manager.setMaxConversations(3);
        expect(manager.getMaxConversations()).toBe(3);
        manager.setMaxConversations(-1);
        expect(manager.getMaxConversations()).toBe(3); // 非法值被忽略
    });

    it('atMaxConversations is false below the limit and true at the limit', () => {
        manager.setMaxConversations(2);
        expect(manager.atMaxConversations()).toBe(false);
        manager.createConversation('A');
        expect(manager.atMaxConversations()).toBe(false);
        manager.createConversation('B');
        expect(manager.atMaxConversations()).toBe(true);
    });

    it('keeps all conversations when creating beyond the limit (direction A, no trim)', () => {
        manager.setMaxConversations(2);
        const a = manager.createConversation('A');
        const b = manager.createConversation('B');
        const c = manager.createConversation('C');
        // 方向 A：达到上限不再自动裁剪，旧会话全部保留；是否允许新建由 UI 守卫决定
        expect(manager.getAll()).toHaveLength(3);
        expect(manager.getAll().some(x => x.id === a.id)).toBe(true);
        expect(manager.getAll().some(x => x.id === b.id)).toBe(true);
        expect(manager.getAll().some(x => x.id === c.id)).toBe(true);
        expect(manager.atMaxConversations()).toBe(true);
    });

    it('removes specified messages (retry support)', async () => {
        const conv = manager.createConversation();
        const u = manager.addMessage(conv.id, 'user', 'hello');
        const a = manager.addMessage(conv.id, 'assistant', '错误: boom');
        expect(conv.messages).toHaveLength(2);

        const removed = manager.removeMessages(conv.id, [u!.id, a!.id]);
        expect(removed).toBe(2);
        expect(manager.getActive()?.messages).toHaveLength(0);

        expect(manager.removeMessages(conv.id, ['missing'])).toBe(0);
        expect(manager.removeMessages('missing-conv', ['x'])).toBe(0);
    });
});
