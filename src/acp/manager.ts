// ==================== ACP 会话进程管理器（P1） ====================
//
// 决策基线（用户已确认）：
// - **每会话一个常驻 ACP 进程**：Map<会话key, handle>，懒启动、空闲超时回收。
//   保留 v2.2.0 跨会话并发流式（会话 A 流式期间会话 B 可并行——各自独立进程）。
// - 缝合点：`sendMessage(sessionId, text, vaultPath)` 产出与 api.ts 相同的
//   `AsyncGenerator<StreamChunk>`，聊天视图 for-await 消费点零改动。
// - 自愈：进程 exit → 本轮出错误卡；下轮重启 + `session/load` 续上下文。
// - `Conversation.sessionId` 语义复用：ACP 模式下由 `session/new` 返回的真实 UUID
//   写回（done chunk 携带 acpSessionId），`--print` 下仍是 CLI `--session-id`。

import { AcpConnection } from './transport';
import { mapAcpEvent, parseToolCall } from './events';
import type { StreamChunk } from '../api';
import { getErrorMessage, getString, isObject } from '../types';

/** 空闲回收阈值（无活跃 prompt 后多久 kill 进程） */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface AcpHandle {
    /** ACP 会话真实 UUID（session/new 返回；重启后用 session/load 续接） */
    acpUuid: string;
    /** 进程连接（exit 后置 null，由 ensureLive 重生） */
    conn: AcpConnection | null;
    /** 本轮是否通过 session/new 新建（done chunk 需写回 acpSessionId） */
    justCreated: boolean;
    /** 当前进行中的轮次事件接收槽（单会话单轮串行） */
    activeRound: { sink: (update: unknown) => void } | null;
    /** 空闲回收定时器 */
    idleTimer: ReturnType<typeof setTimeout> | null;
    /** 会话工作目录（vault 根），session/new/load 用 */
    cwd?: string;
}

export interface AcpSessionManagerOptions {
    /** 解析后的 codebuddy 可执行路径 */
    scriptPath: string;
    /** 裸脚本场景 Node 路径（可选） */
    nodePath?: string;
    /** --permission-mode：default | acceptEdits | dontAsk | bypassPermissions */
    permissionMode: string;
    /** 轮级请求超时（毫秒，沿用插件 timeoutSeconds） */
    timeoutMs: number;
}

export class AcpSessionManager {
    private options: AcpSessionManagerOptions;
    /** 实时权限模式：设置项变更即时生效（新连接读取；已存活的连接保持旧值） */
    private permissionMode: string;
    private handles = new Map<string, AcpHandle>();
    private cancelHandlers = new Map<string, () => void>();
    private disposed = false;

    constructor(options: AcpSessionManagerOptions) {
        this.options = options;
        this.permissionMode = options.permissionMode;
    }

    /** 更新权限模式：影响之后建立的新 ACP 连接（老进程/存活会话不受影响）。 */
    setPermissionMode(mode: string): void {
        this.permissionMode = mode;
    }

    /** 每会话并发/串行无关的外部取消入口（chat 停止按钮 → api.cancel → 此处）。 */
    cancel(sessionId: string): void {
        this.cancelHandlers.get(sessionId)?.();
    }

    /**
     * 发送消息并流式返回（镜像 api.sendMessage 签名）。
     * 同会话串行由视图层发送队列保证；此处加 busy 守卫防重入。
     */
    async *sendMessage(sessionId: string, text: string, vaultPath?: string): AsyncGenerator<StreamChunk> {
        if (this.disposed) {
            yield { type: 'error', content: 'ACP 传输已关闭' };
            return;
        }

        let cancelled = false;
        let pendingResolve: ((r: IteratorResult<StreamChunk>) => void) | null = null;
        const chunkQueue: StreamChunk[] = [];
        let terminal: StreamChunk | null = null;
        const seenToolIds = new Set<string>();

        const handle = await this.ensureHandle(sessionId, vaultPath);
        await this.ensureLive(handle);
        if (handle.activeRound) {
            yield { type: 'error', content: '该会话已有进行中的请求，请等待完成后再发送' };
            return;
        }
        if (handle.idleTimer) {
            clearTimeout(handle.idleTimer);
            handle.idleTimer = null;
        }
        const acpUuid = handle.acpUuid;
        const isNewSession = handle.justCreated;
        handle.justCreated = false;

        // 取消注册：按传入 sessionId（chat 当前持有的 conv.sessionId）定向。
        // 点停止 → 发 session/cancel（进程保留）+ 唤醒主循环收尾。
        const cancelHandler = () => {
            cancelled = true;
            if (handle.conn && acpUuid) {
                handle.conn.notify('session/cancel', { sessionId: acpUuid });
            }
            if (pendingResolve) {
                pendingResolve({ value: { type: 'done', content: '' }, done: true });
                pendingResolve = null;
            }
        };
        this.cancelHandlers.set(sessionId, cancelHandler);

        // 事件 → chunk 分发（映射 + 工具卡按 toolCallId 去重）。
        const enqueue = (chunk: StreamChunk) => {
            if (cancelled || terminal) return;
            if (pendingResolve) {
                pendingResolve({ value: chunk, done: false });
                pendingResolve = null;
            } else {
                chunkQueue.push(chunk);
            }
        };
        handle.activeRound = {
            sink: (update: unknown) => {
                if (cancelled || terminal) return;
                if (isToolCallUpdate(update)) {
                    const info = parseToolCall(update as Record<string, unknown>);
                    if (info) {
                        if (seenToolIds.has(info.toolCallId)) return;
                        seenToolIds.add(info.toolCallId);
                    }
                }
                const chunk = mapAcpEvent(update);
                if (chunk) {
                    // 新会话轮内所有 done chunk 都带 acpSessionId：session_end 会先于
                    // session/prompt 的 result 抵达，消费者拿到的最后一个 done 是 session_end
                    // 派生的，写回条件必须对它生效（否则 acpSessionId 永不落账）。
                    if (isNewSession && chunk.type === 'done') {
                        chunk.acpSessionId = acpUuid;
                    }
                    enqueue(chunk);
                }
            },
        };

        try {
            // 轮级超时：超时 → session/cancel + 错误卡（与 api.ts P0.3 同款文案）
            const timeoutSeconds = Math.max(1, Math.round(this.options.timeoutMs / 1000));
            const timer = setTimeout(() => {
                if (terminal) return;
                if (handle.conn && acpUuid) handle.conn.notify('session/cancel', { sessionId: acpUuid });
                const errChunk: StreamChunk = {
                    type: 'error',
                    content: `请求超时（已等待 ${timeoutSeconds} 秒），请检查 CodeBuddy CLI 是否正常运行或尝试重试`,
                };
                if (pendingResolve) {
                    pendingResolve({ value: errChunk, done: true });
                    pendingResolve = null;
                } else {
                    terminal = errChunk;
                }
            }, this.options.timeoutMs);
            timer.unref?.();

            // 发 prompt；完成后置 terminal（done / error）
            const conn = handle.conn;
            if (!conn) throw new Error('ACP 进程不可用');
            const p = conn.request('session/prompt', {
                sessionId: acpUuid,
                prompt: [{ type: 'text', text }],
            });
            p.then(() => {
                const done: StreamChunk = {
                    type: 'done',
                    content: '',
                    ...(isNewSession && acpUuid ? { acpSessionId: acpUuid } : {}),
                };
                if (pendingResolve) {
                    pendingResolve({ value: done, done: true });
                    pendingResolve = null;
                } else {
                    terminal = done;
                }
            }).catch((e: unknown) => {
                const errChunk: StreamChunk = { type: 'error', content: getErrorMessage(e) };
                if (pendingResolve) {
                    pendingResolve({ value: errChunk, done: true });
                    pendingResolve = null;
                } else {
                    terminal = errChunk;
                }
            });

            // 主循环（pull/push，同 api.ts 模式）
            while (true) {
                if (cancelled) break;
                if (chunkQueue.length > 0) {
                    const c = chunkQueue.shift();
                    if (c) yield c;
                    continue;
                }
                if (terminal) {
                    clearTimeout(timer);
                    if (terminal.type === 'error') yield terminal;
                    break;
                }
                const next = await new Promise<IteratorResult<StreamChunk>>((r) => {
                    pendingResolve = r;
                });
                if (next.done) {
                    if (next.value?.type === 'error') yield next.value;
                    break;
                }
                yield next.value;
            }
            clearTimeout(timer);
        } finally {
            handle.activeRound = null;
            this.cancelHandlers.delete(sessionId);
            this.scheduleIdle(handle);
        }
    }

    /** 关闭全部 ACP 进程（Obsidian unload）。 */
    dispose(): void {
        this.disposed = true;
        for (const [, handler] of this.cancelHandlers) {
            handler();
        }
        this.cancelHandlers.clear();
        for (const handle of this.handles.values()) {
            if (handle.idleTimer) clearTimeout(handle.idleTimer);
            handle.conn?.stop();
            handle.conn = null;
        }
        this.handles.clear();
    }

    // ==================== 内部 ====================

    /**
     * 取/建会话句柄。key = 插件侧 sessionId（可能是 session/new 前的占位 UUID，
     * 也可能是已写回的 ACP UUID）：按 key 直查 → 按 acpUuid 反查（别名）→ 新建。
     */
    private async ensureHandle(key: string, vaultPath?: string): Promise<AcpHandle> {
        let handle = this.handles.get(key);
        if (handle) return handle;

        // 反查：上一轮 session/new 写回后，后续 key 已是 acpUuid（别名复用同一进程）
        for (const [, h] of this.handles) {
            if (h.acpUuid === key) {
                this.handles.set(key, h);
                return h;
            }
        }

        // 新建：懒 spawn + 握手 + 会话建立
        handle = this.createHandle(key, vaultPath);
        this.handles.set(key, handle);
        try {
            await handle.conn?.start();
        } catch (e) {
            this.handles.delete(key);
            throw new Error(`ACP 启动失败: ${getErrorMessage(e)}`);
        }

        // 会话：key 形如 UUID 时先试 session/load（续接持久会话，含 Obsidian 重启后）；
        // 失败（会话不存在）→ session/new 全新开始。
        const conn = handle.conn;
        if (!conn) throw new Error('ACP 进程不可用');
        const isUuid = /^[0-9a-fA-F-]{36}$/.test(key);
        if (isUuid) {
            try {
                await conn.request('session/load', { sessionId: key, cwd: vaultPath ?? '', mcpServers: [] });
                handle.acpUuid = key;
                return handle;
            } catch {
                // 会话不存在 → 落到 session/new
            }
        }
        const res = await conn.request('session/new', { cwd: vaultPath ?? '', mcpServers: [] });
        handle.acpUuid = getString(isObject(res) ? res : {}, 'sessionId') ?? '';
        if (!handle.acpUuid) {
            this.handles.delete(key);
            throw new Error('ACP 会话创建失败：未返回 sessionId');
        }
        handle.justCreated = true;
        return handle;
    }

    /** 保证句柄的进程存活：已死 → 重生 + session/load 续接。 */
    private async ensureLive(handle: AcpHandle): Promise<void> {
        if (handle.conn && handle.conn.isAlive()) return;

        if (handle.conn) {
            handle.conn.stop();
        }
        handle.conn = this.newConnection(handle);
        await handle.conn.start();

        // 有已知 acpUuid → session/load 续上下文；失败则新开
        if (handle.acpUuid) {
            try {
                await handle.conn.request('session/load', { sessionId: handle.acpUuid, cwd: handle.cwd ?? '', mcpServers: [] });
            } catch {
                const res = await handle.conn.request('session/new', { cwd: handle.cwd ?? '', mcpServers: [] });
                const fresh = getString(isObject(res) ? res : {}, 'sessionId') ?? '';
                handle.acpUuid = fresh || handle.acpUuid;
                handle.justCreated = Boolean(fresh);
            }
        }
    }

    private createHandle(key: string, vaultPath?: string): AcpHandle {
        const handle: AcpHandle = {
            acpUuid: '',
            conn: null,
            justCreated: false,
            activeRound: null,
            idleTimer: null,
            cwd: vaultPath,
        };
        handle.conn = this.newConnection(handle);
        return handle;
    }

    /** 每个进程绑定自己的 handle：事件/退出直接路由到该 handle，不做 cwd 匹配。 */
    private newConnection(handle: AcpHandle): AcpConnection {
        let conn: AcpConnection;
        conn = new AcpConnection({
            scriptPath: this.options.scriptPath,
            nodePath: this.options.nodePath,
            permissionMode: this.permissionMode,
            cwd: handle.cwd,
            timeoutMs: this.options.timeoutMs,
            onSessionUpdate: (update: unknown) => {
                handle.activeRound?.sink(update);
            },
            onExit: () => {
                // 仅当退出的仍是当前连接时置空（避免旧连接 exit 误伤已被替换的新连接）
                if (handle.conn === conn) handle.conn = null;
            },
        });
        return conn;
    }

    private scheduleIdle(handle: AcpHandle): void {
        if (handle.idleTimer) clearTimeout(handle.idleTimer);
        handle.idleTimer = setTimeout(() => {
            handle.conn?.stop();
            handle.conn = null;
            handle.idleTimer = null;
        }, IDLE_TIMEOUT_MS);
        handle.idleTimer.unref?.();
    }
}

// ==================== 辅助 ====================

function isToolCallUpdate(update: unknown): boolean {
    return isObject(update) && update.sessionUpdate === 'tool_call';
}
