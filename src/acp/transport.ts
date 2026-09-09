// ==================== ACP stdio 连接层（P1） ====================
//
// 包一个 `codebuddy --acp` 常驻进程，实现 JSON-RPC 2.0 over ndjson stdio：
// - 请求：id 自增 + 待决响应表（Map<id, {resolve,reject,timer}>），支持超时
// - 通知：method='session/update' → onSessionUpdate(update)（原始 update 交 events.ts 映射）
//   method='_codebuddy.ai/command'（workspace_info 等）→ 静默（实测不响应不阻塞）
// - 生命周期：initialize 握手（10s 超时 + 指数退避重试 1s→2s→4s，最多 3 次）
//   → state='ready'；进程 exit/close → state='stale' + 拒绝全部在途请求 + onExit
// - Windows：.cmd/.bat 走 shell:true（复用 api.ts 判定）；停止时 taskkill /T /F 杀进程树，
//   避免 cmd shim 的 node 子进程残留占用 stdout（孤儿自愈：stdin 关闭 + 树杀）。

import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { getErrorMessage, isObject } from '../types';
import { isBareFallback, isWindowsWrapper, needsWindowsShell } from '../api';

export const INIT_TIMEOUT_MS = 10_000;
export const INIT_MAX_ATTEMPTS = 3;
export const INIT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export type AcpConnState = 'starting' | 'ready' | 'stale';

interface PendingRequest {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface AcpConnectionOptions {
    /** 解析后的 codebuddy 可执行路径 */
    scriptPath: string;
    /** 裸脚本场景的 Node 路径（可选，复用 api 的 nodePath） */
    nodePath?: string;
    /** --permission-mode 取值：default | acceptEdits | dontAsk | bypassPermissions */
    permissionMode: string;
    /** 工作目录（vault 根），作为会话 cwd 与文件操作基准 */
    cwd?: string;
    /** 单个请求超时（毫秒） */
    timeoutMs: number;
    /** session/update 通知分发（原始 update 对象） */
    onSessionUpdate: (update: unknown) => void;
    /** 进程退出回调（用于 manager 标记 stale 与自愈） */
    onExit?: (code: number | null, errOut: string) => void;
}

export class AcpConnection {
    private options: AcpConnectionOptions;
    private proc: ChildProcess | null = null;
    private state: AcpConnState = 'starting';
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private buffer = '';
    private errOut = '';
    private closed = false;

    constructor(options: AcpConnectionOptions) {
        this.options = options;
    }

    getState(): AcpConnState {
        return this.state;
    }

    isAlive(): boolean {
        return this.state === 'ready' && this.proc !== null && this.proc.exitCode === null;
    }

    /** 启动进程并完成 initialize 握手（含退避重试）。失败抛错并置 stale。 */
    async start(): Promise<void> {
        if (this.proc) return;
        this.spawnProc();
        await this.handshake();
        this.state = 'ready';
    }

    private spawnProc(): void {
        const { scriptPath, nodePath, permissionMode, cwd } = this.options;
        const procOptions: SpawnOptions = { stdio: ['pipe', 'pipe', 'pipe'] };
        if (cwd) procOptions.cwd = cwd;

        const cliArgs = ['--acp', '--permission-mode', permissionMode];
        let proc: ChildProcess;
        if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
            if (needsWindowsShell(scriptPath)) {
                // .cmd/.bat → cmd.exe 包装；参数为插件常量（无用户输入），无转义需求
                procOptions.shell = true;
            }
            proc = spawn(scriptPath, cliArgs, procOptions);
        } else {
            // 裸脚本：手动指定 node 执行
            const nodeBin = nodePath || 'node';
            proc = spawn(nodeBin, [scriptPath, ...cliArgs], procOptions);
        }
        this.proc = proc;
        this.closed = false;
        this.buffer = '';
        this.errOut = '';

        proc.stdout?.on('data', (d: Buffer) => this.onStdout(d));
        proc.stderr?.on('data', (d: Buffer) => {
            this.errOut += d.toString();
        });
        proc.on('error', (e: Error) => {
            this.failAll(new Error(`ACP 进程启动失败: ${e.message}`));
            this.markStale(proc, null);
        });
        proc.on('close', (code, signal) => {
            const errOut = this.errOut.substring(0, 300);
            this.failAll(new Error(`ACP 进程退出（code=${code}${signal ? `, ${signal}` : ''}${errOut ? `, ${errOut}` : ''}）`));
            this.markStale(proc, code);
        });
    }

    private onStdout(d: Buffer): void {
        this.buffer += d.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim()) continue;
            this.onLine(line);
        }
    }

    private onLine(line: string): void {
        let msg: unknown;
        try {
            msg = JSON.parse(line);
        } catch {
            return; // 非 JSON 行忽略
        }
        if (!isObject(msg)) return;

        const hasId = typeof msg.id === 'number' || typeof msg.id === 'string';

        // 响应：有 id 且无 method
        if (hasId) {
            const id = msg.id;
            const pending = this.pending.get(Number(id));
            if (!pending) return;
            this.pending.delete(Number(id));
            clearTimeout(pending.timer);
            if (msg.error) {
                const detail = extractErrorDetail(msg.error);
                pending.reject(new Error(detail));
            } else {
                pending.resolve(msg.result);
            }
            return;
        }

        // 通知
        const method = msg.method;
        if (method === 'session/update') {
            const params = isObject(msg.params) ? msg.params : null;
            this.options.onSessionUpdate(params ? params.update : undefined);
        }
        // 其余（_codebuddy.ai/command 等）静默
    }

    /** 发请求并等待结果。返回 result；超时/出错 reject。 */
    request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            // 守卫仅查 proc：握手期间 state 是 'starting'，initialize 必须在 ready 前可发。
            // stale 时 proc 已被置 null（markStale/stop），自然拒绝。
            if (!this.proc) {
                reject(new Error('ACP 进程未就绪，无法发起请求'));
                return;
            }
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`ACP 请求超时: ${method}`));
            }, timeoutMs ?? this.options.timeoutMs);
            timer.unref?.();
            this.pending.set(id, { resolve, reject, timer });
            const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            this.proc.stdin?.write(body + '\n');
        });
    }

    /** 单向通知（不等待响应）。用于 session/cancel 等。 */
    notify(method: string, params: Record<string, unknown>): void {
        if (!this.proc || !this.proc.stdin) return;
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }

    private async handshake(): Promise<void> {
        let attempt = 0;
        while (attempt < INIT_MAX_ATTEMPTS) {
            attempt++;
            try {
                await this.request('initialize', {
                    protocolVersion: 1,
                    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
                    agentCapabilities: { loadSession: true, canLoadExistingSession: true },
                }, INIT_TIMEOUT_MS);
                return;
            } catch (e) {
                if (attempt >= INIT_MAX_ATTEMPTS) {
                    this.markStale(this.proc, null);
                    throw new Error(`ACP 握手失败（已重试 ${attempt} 次）: ${getErrorMessage(e)}`);
                }
                // 握手失败后进程可能已退出：重启进程再试
                this.failAll(new Error('握手失败，进程重启'));
                this.killProc();
                this.spawnProc();
                await sleep(INIT_RETRY_DELAYS_MS[attempt - 1] ?? 4_000);
            }
        }
    }

    private markStale(proc: ChildProcess | null, code: number | null): void {
        if (this.proc && proc && this.proc !== proc) return; // 已被新进程取代
        this.closed = true;
        this.state = 'stale';
        this.proc = null;
        this.options.onExit?.(code, this.errOut.substring(0, 300));
    }

    private failAll(err: Error): void {
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pending.clear();
    }

    private killProc(): void {
        const proc = this.proc;
        if (!proc || !proc.pid) return;
        try {
            if (process.platform === 'win32' && proc.pid) {
                // 杀进程树，避免 .cmd shim 的 node 子进程残留占用 stdout（孤儿自愈）
                spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
            } else {
                proc.kill();
            }
        } catch { /* ignore */ }
    }

    /** 停止并释放进程（关闭 stdin → CLI 自退；Windows 再补进程树清理）。 */
    stop(): void {
        const proc = this.proc;
        if (!proc) {
            this.state = 'stale';
            return;
        }
        try {
            proc.stdin?.end();
        } catch { /* ignore */ }
        this.killProc();
        this.failAll(new Error('ACP 连接已关闭'));
        this.pending.clear();
        this.closed = true;
        this.state = 'stale';
        this.proc = null;
    }

    /** 当前 stderr 片段（用于错误文案）。 */
    getErrOut(): string {
        return this.errOut.substring(0, 300);
    }
}

function extractErrorDetail(error: unknown): string {
    if (isObject(error)) {
        const msg = error.message;
        if (typeof msg === 'string') return msg;
    }
    return typeof error === 'string' ? error : 'ACP 请求失败';
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
