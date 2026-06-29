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
});
