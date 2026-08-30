import { SendQueue, type QueueItem } from '../src/chat/queue';

describe('SendQueue', () => {
    it('starts empty', () => {
        const q = new SendQueue();
        expect(q.isEmpty()).toBe(true);
        expect(q.size()).toBe(0);
        expect(q.peekFor('c1')).toBeNull();
        expect(q.dequeue('c1')).toBeNull();
        expect(q.listFor('c1')).toEqual([]);
    });

    it('enqueues FIFO per conversation and assigns unique ids', () => {
        const q = new SendQueue();
        const a = q.enqueue('conv-1', 'hello', 'note-a.md');
        const b = q.enqueue('conv-1', 'world', null);
        expect(a.id).not.toBe(b.id);
        expect(a.text).toBe('hello');
        expect(a.notePath).toBe('note-a.md');
        expect(b.notePath).toBeNull();
        expect(b.convId).toBe('conv-1');
        expect(q.size()).toBe(2);
        expect(q.listFor('conv-1').map(i => i.text)).toEqual(['hello', 'world']);
    });

    it('keeps per-conversation queues isolated', () => {
        const q = new SendQueue();
        q.enqueue('a', 'a1', null);
        q.enqueue('b', 'b1', null);
        q.enqueue('a', 'a2', null);
        // 各会话独立 FIFO：peekFor/dequeue 只作用于指定会话
        expect(q.peekFor('a')?.text).toBe('a1');
        expect(q.peekFor('b')?.text).toBe('b1');
        expect(q.dequeue('b')?.text).toBe('b1');
        expect(q.peekFor('b')).toBeNull();
        expect(q.listFor('a').map(i => i.text)).toEqual(['a1', 'a2']);
        expect(q.dequeue('a')?.text).toBe('a1');
        expect(q.dequeue('a')?.text).toBe('a2');
        expect(q.dequeue('a')).toBeNull();
        expect(q.isEmpty()).toBe(true);
    });

    it('dequeue removes empty conversation from map (isEmpty true)', () => {
        const q = new SendQueue();
        q.enqueue('a', 'x', null);
        expect(q.isEmpty()).toBe(false);
        q.dequeue('a');
        expect(q.isEmpty()).toBe(true);
    });

    it('remove deletes any item by id across conversations', () => {
        const q = new SendQueue();
        const a = q.enqueue('a', 'a', null);
        const b = q.enqueue('b', 'b', null);
        const c = q.enqueue('a', 'c', null);
        expect(q.remove(b.id)).toBe(true);
        expect(q.listFor('a').map(i => i.id)).toEqual([a.id, c.id]);
        expect(q.remove('nope')).toBe(false);
    });

    it('update edits text in place (keeps position)', () => {
        const q = new SendQueue();
        const a = q.enqueue('c1', 'old', null);
        q.enqueue('c1', 'second', null);
        expect(q.update(a.id, 'new')).toBe(true);
        expect(q.listFor('c1').map(i => i.text)).toEqual(['new', 'second']);
        expect(q.update('missing', 'x')).toBe(false);
    });

    it('listFor returns a copy (mutating it does not affect queue)', () => {
        const q = new SendQueue();
        q.enqueue('c1', 'a', null);
        const copy = q.listFor('c1');
        copy.push({ id: 'x', convId: 'c1', text: 'y', notePath: null } as QueueItem);
        expect(q.size()).toBe(1);
    });
});
