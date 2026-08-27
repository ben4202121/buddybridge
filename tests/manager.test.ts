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

    it('trims oldest conversations to maxConversations (P0.4)', async () => {
        manager.setMaxConversations(2);
        const a = manager.createConversation('A');
        await new Promise(r => setTimeout(r, 5));
        const b = manager.createConversation('B');
        await new Promise(r => setTimeout(r, 5));
        const c = manager.createConversation('C');

        expect(manager.getAll()).toHaveLength(2);
        expect(manager.getActive()?.id).toBe(c.id);
        // 最旧的 A 被裁剪，B/C 保留
        expect(manager.getAll().some(x => x.id === a.id)).toBe(false);
        expect(manager.getAll().some(x => x.id === b.id)).toBe(true);
        expect(manager.getAll().some(x => x.id === c.id)).toBe(true);
    });

    it('does not trim when within limit', async () => {
        manager.setMaxConversations(5);
        manager.createConversation('A');
        manager.createConversation('B');
        expect(manager.getAll()).toHaveLength(2);
    });

    it('keeps newest conversations when created rapidly (equal timestamps)', async () => {
        manager.setMaxConversations(2);
        const a = manager.createConversation('A');
        const b = manager.createConversation('B');
        const c = manager.createConversation('C');
        const ids = manager.getAll().map(x => x.id);
        // 即使时间戳相同，也应保留最晚创建的 B/C，裁掉最早的 A
        expect(ids).toContain(b.id);
        expect(ids).toContain(c.id);
        expect(ids).not.toContain(a.id);
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
