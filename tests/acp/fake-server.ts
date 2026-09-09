// 假 ACP 服务端：mock child_process.spawn，每次调用返回全新的内存流假进程，
// 支持脚本化请求应答 / 通知推送 / 进程退出 / 重试场景（每次 spawn 独立进程）。
import { PassThrough } from 'stream';
// jest.requireActual 返回真实模块对象（非 __importStar 包装）：其 spawn 属性可配置，
// jest.spyOn 才能覆写。传输层经 __importStar 命名空间访问 spawn 时，绑定 getter 会在
// 调用时读取真实模块属性，因此这里的 mock 对 api.ts / transport.ts 同样生效。
const child_process = jest.requireActual('child_process') as typeof import('child_process');

export interface FakeRequest {
    jsonrpc: string;
    id?: number | string;
    method?: string;
    params?: any;
}

export interface FakeProc {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    pid: number;
    exitCode: number | null;
    killed: boolean;
    on(ev: string, cb: (...a: any[]) => void): this;
    kill(): void;
    emit(ev: string, ...args: unknown[]): void;
    exit(code: number): void;
    fail(err: Error): void;
}

/** onRequest 第三参：向收到该请求的同一进程 stdout 推送一行 JSON（模拟事件流）。 */
export type FakeEmit = (obj: unknown) => void;

export interface FakeServer {
    /** 最近一次 spawn 返回的假进程 */
    proc: FakeProc;
    /** 全部收到的入站请求（含通知） */
    requests: FakeRequest[];
    /** 向当前进程 stdout 推送一行 JSON */
    emit(obj: unknown): void;
    /** 模拟当前进程退出 */
    exit(code: number): void;
    /** 模拟当前进程启动失败 */
    fail(err: Error): void;
    /** 清理 spy */
    restore(): void;
}

function makeFakeProc(requests: FakeRequest[], onRequest: (req: FakeRequest, respond: (result?: any, error?: any) => void, emit: FakeEmit) => void): FakeProc {
    const proc: FakeProc = {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        pid: 1000 + Math.floor(Math.random() * 9000),
        exitCode: null,
        killed: false,
        on: function (this: FakeProc, ev: string, cb: (...a: any[]) => void) {
            (this as any)['_on_' + ev] = cb;
            return this;
        },
        kill: function (this: FakeProc) {
            this.killed = true;
            return true;
        },
        emit: function (this: FakeProc, ev: string, ...args: unknown[]) {
            (this as any)['_on_' + ev]?.(...args);
        },
        exit: function (this: FakeProc, code: number) {
            this.exitCode = code;
            this.emit('close', code, null);
        },
        fail: function (this: FakeProc, err: Error) {
            this.emit('error', err);
        },
    };

    proc.stdin.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
            if (!line.trim()) continue;
            let req: FakeRequest;
            try {
                req = JSON.parse(line);
            } catch {
                continue;
            }
            requests.push(req);
            const emit = (obj: unknown) => proc.stdout.write(JSON.stringify(obj) + '\n');
            if (req.id !== undefined && req.method) {
                onRequest(req, (result, error) => {
                    if (error !== undefined) {
                        emit({ jsonrpc: '2.0', id: req.id, error });
                    } else {
                        emit({ jsonrpc: '2.0', id: req.id, result });
                    }
                }, emit);
            } else if (req.method) {
                onRequest(req, () => {}, emit);
            }
        }
    });

    return proc;
}

/** 脚本化假服务端：onRequest 决定如何应答每一条请求（含通知）。 */
export function createFakeAcp(opts: {
    onRequest: (req: FakeRequest, respond: (result?: any, error?: any) => void, emit: FakeEmit) => void;
}): { server: FakeServer; spawnMock: jest.SpyInstance } {
    const requests: FakeRequest[] = [];
    let latest: FakeProc | null = null;

    const spawnMock = jest.spyOn(child_process, 'spawn').mockImplementation((() => {
        latest = makeFakeProc(requests, opts.onRequest);
        return latest;
    }) as any);

    const server: FakeServer = {
        get proc() {
            if (!latest) throw new Error('尚未 spawn 任何进程');
            return latest;
        },
        requests,
        emit(obj) {
            latest?.stdout.write(JSON.stringify(obj) + '\n');
        },
        exit(code) {
            latest?.exit(code);
        },
        fail(err) {
            latest?.fail(err);
        },
        restore() {
            spawnMock.mockRestore();
        },
    };

    return { server, spawnMock };
}

/** 便捷：构造一条 session/update 通知。 */
export function sessionUpdate(update: Record<string, unknown>): Record<string, unknown> {
    return {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'test-session', update },
    };
}
