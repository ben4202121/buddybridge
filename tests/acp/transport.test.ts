import { AcpConnection, INIT_MAX_ATTEMPTS } from '../../src/acp/transport';
import { createFakeAcp, sessionUpdate } from './fake-server';

// 假服务端每次 spawn 返回全新假进程；测试把 process.platform 假成 linux，
// 让 killProc 走 proc.kill()（避免 Windows 分支 spawn taskkill 污染假服务端）。
const ORIG_PLATFORM = process.platform;

function makeConn(handlers: { onUpdate?: (u: unknown) => void; onExit?: (c: number | null, e: string) => void; model?: string } = {}) {
    return new AcpConnection({
        scriptPath: 'codebuddy',
        permissionMode: 'acceptEdits',
        model: handlers.model,
        cwd: '/vault',
        timeoutMs: 100,
        onSessionUpdate: handlers.onUpdate ?? (() => {}),
        onExit: handlers.onExit ?? (() => {}),
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
});
afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
});

describe('AcpConnection 握手与生命周期', () => {
    it('start 握手成功 → ready；spawn 带 --acp --permission-mode；initialize 参数正确', async () => {
        const { server, spawnMock } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn();
            await conn.start();
            expect(conn.getState()).toBe('ready');
            expect(conn.isAlive()).toBe(true);

            const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
            expect(bin).toBe('codebuddy');
            expect(args).toEqual(['--acp', '--permission-mode', 'acceptEdits']);

            const init = server.requests.find((r) => r.method === 'initialize') as any;
            expect(init).toBeTruthy();
            expect(init.params.protocolVersion).toBe(1);
            expect(init.params.agentCapabilities.loadSession).toBe(true);
        } finally {
            server.restore();
        }
    });

    it('model 显式 id → spawn 参数追加 --model <id>（v2.6.0）', async () => {
        const { server, spawnMock } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn({ model: 'hy3' });
            await conn.start();
            expect(conn.getState()).toBe('ready');

            const args = spawnMock.mock.calls[0][1] as string[];
            expect(args).toEqual(['--acp', '--permission-mode', 'acceptEdits', '--model', 'hy3']);
        } finally {
            server.restore();
        }
    });

    it("model 为 'auto' / 未传 → spawn 参数不含 --model（跟随 CLI 默认）", async () => {
        const { server, spawnMock } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn({ model: 'auto' });
            await conn.start();
            const args = spawnMock.mock.calls[0][1] as string[];
            expect(args).not.toContain('--model');
        } finally {
            server.restore();
        }
    });

    it('Windows .cmd wrapper + shell:true：permissionMode/model 经 escapeCmdArg 转义（防 cmd 注入）', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const { server, spawnMock } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            // .cmd 且 model 含 cmd 元字符 → 转义后作为单个参数，防 `&` 拼接命令
            const conn = new AcpConnection({
                scriptPath: 'codebuddy.cmd',
                permissionMode: 'acceptEdits',
                model: 'hy3 & echo HIJACKED',
                cwd: '/vault',
                timeoutMs: 100,
                onSessionUpdate: () => {},
                onExit: () => {},
            });
            await conn.start();
            expect(conn.getState()).toBe('ready');

            const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
            expect(bin).toBe('codebuddy.cmd');
            expect(args[0]).toBe('--acp');
            expect(args[1]).toBe('--permission-mode');
            // 值被双引号包裹、`&` 转义为 ^&
            expect(args[2]).toBe('"acceptEdits"');
            expect(args[3]).toBe('--model');
            expect(args[4]).toBe('"hy3 ^& echo HIJACKED"');
        } finally {
            server.restore();
            Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
        }
    });

    it('Windows .cmd wrapper：model=auto 仍转义 permissionMode，但不加 --model', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const { server, spawnMock } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = new AcpConnection({
                scriptPath: 'codebuddy.cmd',
                permissionMode: 'acceptEdits',
                model: 'auto',
                cwd: '/vault',
                timeoutMs: 100,
                onSessionUpdate: () => {},
                onExit: () => {},
            });
            await conn.start();

            const args = spawnMock.mock.calls[0][1] as string[];
            expect(args).toEqual(['--acp', '--permission-mode', '"acceptEdits"']);
            expect(args).not.toContain('--model');
        } finally {
            server.restore();
            Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
        }
    });

    it('握手持续失败 → 超过重试上限抛错并置 stale（重试会重新 spawn）', async () => {
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond(undefined, { code: -32000, message: 'boom' });
            },
        });
        try {
            const conn = makeConn();
            await expect(conn.start()).rejects.toThrow(/握手失败/);
            expect(conn.getState()).toBe('stale');
            expect(server.requests.filter((r) => r.method === 'initialize').length).toBe(INIT_MAX_ATTEMPTS);
        } finally {
            server.restore();
        }
    });

    it('进程退出 → stale + onExit 回调 + 在途请求被拒', async () => {
        let exitCode: number | null = null;
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn({ onExit: (c) => { exitCode = c; } });
            await conn.start();
            const reqPromise = conn.request('session/new', { cwd: '/vault', mcpServers: [] });
            server.exit(1);
            await expect(reqPromise).rejects.toThrow(/退出/);
            expect(conn.getState()).toBe('stale');
            expect(conn.isAlive()).toBe(false);
            expect(exitCode).toBe(1);
        } finally {
            server.restore();
        }
    });

    it('stop → 关闭 stdin 并置 stale', async () => {
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn();
            await conn.start();
            conn.stop();
            expect(conn.getState()).toBe('stale');
            expect(conn.isAlive()).toBe(false);
        } finally {
            server.restore();
        }
    });
});

describe('AcpConnection 请求 / 通知', () => {
    it('request 发 ndjson、按 id 收 result，参数透传', async () => {
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
                if (req.method === 'session/new') respond({ sessionId: 'u1' });
            },
        });
        try {
            const conn = makeConn();
            await conn.start();
            const res = await conn.request('session/new', { cwd: '/vault', mcpServers: [] });
            expect(res).toEqual({ sessionId: 'u1' });
            const req = server.requests.find((r) => r.method === 'session/new') as any;
            expect(req.params.cwd).toBe('/vault');
        } finally {
            server.restore();
        }
    });

    it('请求报错 → reject 并带 error.message', async () => {
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
                if (req.method === 'session/load') respond(undefined, { code: -32602, message: 'Invalid params' });
            },
        });
        try {
            const conn = makeConn();
            await conn.start();
            await expect(conn.request('session/load', { sessionId: 'x', cwd: '', mcpServers: [] })).rejects.toThrow('Invalid params');
        } finally {
            server.restore();
        }
    });

    it('请求不应答 → 超时 reject', async () => {
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
                // session/new 不应答 → 等 timeoutMs(100) 超时
            },
        });
        try {
            const conn = makeConn();
            await conn.start();
            await expect(conn.request('session/new', { cwd: '/vault', mcpServers: [] })).rejects.toThrow(/超时/);
        } finally {
            server.restore();
        }
    });

    it('session/update 通知 → onSessionUpdate 收到 update 对象', async () => {
        const updates: unknown[] = [];
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn({ onUpdate: (u) => updates.push(u) });
            await conn.start();
            server.emit(sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }));
            await sleep(30);
            expect(updates.length).toBe(1);
            expect(updates[0]).toMatchObject({ sessionUpdate: 'agent_message_chunk' });
        } finally {
            server.restore();
        }
    });

    it('_codebuddy.ai/command 通知 → 静默不转发', async () => {
        const updates: unknown[] = [];
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn({ onUpdate: (u) => updates.push(u) });
            await conn.start();
            server.emit({ jsonrpc: '2.0', method: '_codebuddy.ai/command', params: { name: 'workspace_info' } });
            await sleep(30);
            expect(updates.length).toBe(0);
            expect(conn.getState()).toBe('ready');
        } finally {
            server.restore();
        }
    });

    it('notify 发无 id 通知（session/cancel）', async () => {
        const { server } = createFakeAcp({
            onRequest: (req, respond) => {
                if (req.method === 'initialize') respond({ protocolVersion: 1 });
            },
        });
        try {
            const conn = makeConn();
            await conn.start();
            conn.notify('session/cancel', { sessionId: 's' });
            await sleep(30);
            const notif = server.requests.find((r) => r.method === 'session/cancel') as any;
            expect(notif).toBeTruthy();
            expect(notif.id).toBeUndefined();
            expect(notif.params.sessionId).toBe('s');
        } finally {
            server.restore();
        }
    });
});
