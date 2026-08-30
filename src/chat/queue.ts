import { generateId } from '../types';

/**
 * 待发送队列项（草稿语义）。
 * 仅存在于视图层内存：排队中的消息不持久化，面板关闭即弃。
 */
export interface QueueItem {
    id: string;
    convId: string;
    text: string;
    /** 入队时正在查看的笔记路径快照：排队期间切笔记 / 焦点变化不影响本条消息的上下文注入。 */
    notePath: string | null;
}

/**
 * 发送队列：按会话分队列（每个会话独立 FIFO），泵只处理「当前活跃会话」的排队项。
 * 传输层是「每条消息一个进程」，天然串行 —— 队列只是视图层缓冲，
 * 保证用户能在回复流式期间继续输入，且各会话之间互不阻塞
 * （分支会话不被旧会话的排队项卡住）。
 */
export class SendQueue {
    /** convId → 该会话的 FIFO 队列 */
    private queues: Map<string, QueueItem[]> = new Map();

    /** 入队（该会话队尾）。返回带 id 的完整项。 */
    enqueue(convId: string, text: string, notePath: string | null): QueueItem {
        const item: QueueItem = { id: generateId(), convId, text, notePath };
        const list = this.queues.get(convId);
        if (list) {
            list.push(item);
        } else {
            this.queues.set(convId, [item]);
        }
        return item;
    }

    /** 查看指定会话的队头（不弹出）。该会话无排队项返回 null。 */
    peekFor(convId: string): QueueItem | null {
        const list = this.queues.get(convId);
        return list && list.length > 0 ? list[0] : null;
    }

    /** 弹出指定会话的队头。空返回 null。 */
    dequeue(convId: string): QueueItem | null {
        const list = this.queues.get(convId);
        if (!list || list.length === 0) return null;
        const item = list.shift()!;
        if (list.length === 0) this.queues.delete(convId);
        return item;
    }

    /** 按 id 删除任意会话中的项。返回是否删除成功。 */
    remove(id: string): boolean {
        for (const [convId, list] of this.queues.entries()) {
            const idx = list.findIndex(i => i.id === id);
            if (idx >= 0) {
                list.splice(idx, 1);
                if (list.length === 0) this.queues.delete(convId);
                return true;
            }
        }
        return false;
    }

    /** 按 id 编辑（保持原位置不变）。返回是否成功。 */
    update(id: string, text: string): boolean {
        for (const list of this.queues.values()) {
            const item = list.find(i => i.id === id);
            if (item) {
                item.text = text;
                return true;
            }
        }
        return false;
    }

    /** 返回指定会话的排队项副本（不改动内部状态）。 */
    listFor(convId: string): QueueItem[] {
        const list = this.queues.get(convId);
        return list ? [...list] : [];
    }

    /** 全部会话排队项总数。 */
    size(): number {
        let n = 0;
        for (const list of this.queues.values()) n += list.length;
        return n;
    }

    /** 是否所有会话都没有排队项。 */
    isEmpty(): boolean {
        return this.queues.size === 0;
    }
}
