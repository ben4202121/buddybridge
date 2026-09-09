import { AcpSessionManager } from '../../src/acp/manager';
import type { StreamChunk } from '../../src/api';
import { createFakeAcp, sessionUpdate, type FakeServer } from './fake-server';

// 假服务端：脚本化模拟 ACP 服务端。process.platform 假成 linux，
// 让 killProc 走 proc.kill()（避免 Windows 分支 spawn taskkill 污染假服务端）。
const ORIG_PLATFORM = process.platform;

let seq = 0;
let seqScoped: { loadFail: boolean } = { loadFail: false };

function createServer(opts?: { loadFail?: boolean }) {
    seqScoped = { loadFail: opts?.loadFail ?? false };
    return createFakeAcp({
        onRequest: (req, respond, emit) => {
            switch (req.method) {
                case 'initialize':
                    respond({ protocolVersion: 1 });
                    return;
                case 'session/new':
                    respond({ sessionId: `acp-uuid-${++seq}` });
                    return;
                case 'session/load':
                    if (seqScoped.loadFail) {
                        respond(undefined, { code: -32002, message: 'Session not found' });
                    } else {
                        respond({ sessionId: req.params.sessionId });
                    }
                    return;
                case 'session/prompt': {
                    emit(sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '好的，收到' } }));
                    emit(sessionUpdate({
                        sessionUpdate: 'tool_call',
                        toolCallId: 't1',
                        status: 'pending',
                        rawInput: { command: 'pwd' },
                        title: '`pwd`',
                        kind: 'execute',
                        _meta: { 'codebuddy.ai/toolName': 'Bash', 'codebuddy.ai/toolArgumentsComplete': true },
                    }));
                    emit(sessionUpdate({ sessionUpdate: 'session_end' }));
                    respond({});
                    return;
                }
                // session/cancel 等通知：不响应
            }
        },
    });
}

function makeManager(opts?: { loadFail?: boolean }) {
    const { server } = createServer(opts);
    const manager = new AcpSessionManager({
        scriptPath: 'codebuddy',
        permissionMode: 'acceptEdits',
        timeoutMs: 500,
    });
    return { server, manager };
}

function emitText(server: FakeServer, text: string): void {
    server.emit(sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }));
}
function emitTool(server: FakeServer): void {
    server.emit(sessionUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        status: 'pending',
        rawInput: { command: 'pwd' },
        title: '`pwd`',
        kind: 'execute',
        _meta: { 'codebuddy.ai/toolName': 'Bash', 'codebuddy.ai/toolArgumentsComplete': true },
    }));
}
function emitEnd(server: FakeServer): void {
    server.emit(sessionUpdate({ sessionUpdate: 'session_end' }));
}

/** 消费整个异步生成器，返回全部 chunk。 */
async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const chunks: StreamChunk[] = [];
    for await (const c of gen) chunks.push(c);
    return chunks;
}

beforeEach(() => {
    seq = 0;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
});
afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
});

describe('AcpSessionManager 事件产出与写回', () => {
    it('sendMessage：session/new → prompt → 事件流 → done 带 acpSessionId（写回）', async () => {
        const { server, manager } = makeManager();
        try {
            const chunks = await drain(manager.sendMessage('sess-1', '你好', '/vault'));
            expect(chunks.map((c) => c.type)).toEqual(['text', 'tool', 'done']);
            expect(chunks[0]).toEqual({ type: 'text', content: '好的，收到' });
            expect(chunks[1]).toMatchObject({ type: 'tool', toolName: 'Bash', toolDetail: '`pwd`' });
            expect(chunks[2]).toMatchObject({ type: 'done', acpSessionId: 'acp-uuid-1' });

            // 协议形状：session/new 带 cwd + mcpServers；prompt 带 sessionId
            const newReq = server.requests.find((r) => r.method === 'session/new') as any;
            expect(newReq.params.cwd).toBe('/vault');
            expect(newReq.params.mcpServers).toEqual([]);
            const promptReq = server.requests.find((r) => r.method === 'session/prompt') as any;
            expect(promptReq.params.sessionId).toBe('acp-uuid-1');
            expect(promptReq.params.prompt).toEqual([{ type: 'text', text: '你好' }]);
        } finally {
            server.restore();
            manager.dispose();
        }
    });

    it('第二轮以 acpUuid 作为 key → 别名复用同一进程，无 session/new，done 不再写回', async () => {
        const { server, manager } = makeManager();
        try {
            await drain(manager.sendMessage('sess-1', '第一轮', '/vault'));
            const before = server.requests.filter((r) => r.method === 'session/new').length;
            expect(before).toBe(1);

            const chunks = await drain(manager.sendMessage('acp-uuid-1', '第二轮', '/vault'));
            const done = chunks.find((c) => c.type === 'done');
            expect(done && done.acpSessionId).toBeUndefined();
            expect(server.requests.filter((r) => r.method === 'session/new').length).toBe(1);
            expect(server.requests.filter((r) => r.method === 'session/prompt').length).toBe(2);
        } finally {
            server.restore();
            manager.dispose();
        }
    });

    it('两个会话并发 → 两个独立进程（spawn 两次），互不干扰', async () => {
        const { server, manager } = makeManager();
        try {
            const g1 = manager.sendMessage('a', '甲', '/vault');
            const g2 = manager.sendMessage('b', '乙', '/vault');
            const [c1, c2] = await Promise.all([drain(g1), drain(g2)]);
            expect(c1.some((c) => c.type === 'done')).toBe(true);
            expect(c2.some((c) => c.type === 'done')).toBe(true);
            // 每个会话一次 session/new（两个独立进程）
            expect(server.requests.filter((r) => r.method === 'session/new').length).toBe(2);
        } finally {
            server.restore();
            manager.dispose();
        }
    });

    it('同会话 busy 守卫：轮进行中再发 → 错误卡提示等待', async () => {
        const { server, manager } = makeManager();
        try {
            const g1 = manager.sendMessage('sess-1', '第一轮', '/vault');
            await g1.next(); // 启动第一轮（activeRound 已占位）

            const g2 = manager.sendMessage('sess-1', '第二轮', '/vault');
            const r = await g2.next();
            expect(r.done).toBe(false);
            expect(r.value).toMatchObject({ type: 'error' });
            expect(String((r.value as StreamChunk).content)).toMatch(/进行中/);

            await drain(g1);
        } finally {
            server.restore();
            manager.dispose();
        }
    });
});

describe('AcpSessionManager 取消与自愈', () => {
    it('cancel → 发 session/cancel 通知，进程保留，生成器正常收尾', async () => {
        const { server, manager } = makeManager();
        try {
            const gen = manager.sendMessage('sess-1', '你好', '/vault');
            const first = await gen.next();
            expect(first.done).toBe(false);

            manager.cancel('sess-1');
            await drain(gen);

            const cancels = server.requests.filter((r) => r.method === 'session/cancel');
            expect(cancels.length).toBeGreaterThanOrEqual(1);
            expect((cancels[0] as any).params.sessionId).toBe('acp-uuid-1');
            // 进程未死：还能复用（下一轮不发 session/new）
            const before = server.requests.filter((r) => r.method === 'session/new').length;
            await drain(manager.sendMessage('acp-uuid-1', '再来', '/vault'));
            expect(server.requests.filter((r) => r.method === 'session/new').length).toBe(before);
        } finally {
            server.restore();
            manager.dispose();
        }
    });

    it('进程中途 exit → 本轮错误卡；下一轮自愈：重生 + session/load 续上下文', async () => {
        const { server, manager } = makeManager();
        try {
            await drain(manager.sendMessage('sess-1', '第一轮', '/vault'));
            const spawnsBefore = server.requests.filter((r) => r.method === 'initialize').length;

            // kill 进程（异步 close → manager onExit 置 conn=null）
            server.exit(1);

            const chunks = await drain(manager.sendMessage('sess-1', '第二轮', '/vault'));
            // 自愈成功：拿到正常 done，且因为 load 续接（非新建），done 不带 acpSessionId
            const done = chunks.find((c) => c.type === 'done');
            expect(done).toBeTruthy();
            expect(done && done.acpSessionId).toBeUndefined();

            // 重新握手（重生）+ session/load 带原 UUID
            expect(server.requests.filter((r) => r.method === 'initialize').length).toBeGreaterThan(spawnsBefore);
            const load = server.requests.find((r) => r.method === 'session/load') as any;
            expect(load).toBeTruthy();
            expect(load.params.sessionId).toBe('acp-uuid-1');
        } finally {
            server.restore();
            manager.dispose();
        }
    });

    it('session/load 失败（会话不存在）→ 兜底 session/new，done 写回新 UUID', async () => {
        const { server, manager } = makeManager({ loadFail: true });
        try {
            await drain(manager.sendMessage('sess-1', '第一轮', '/vault'));
            server.exit(1);

            const chunks = await drain(manager.sendMessage('sess-1', '第二轮', '/vault'));
            const done = chunks.find((c) => c.type === 'done');
            expect(done && done.acpSessionId).toBe('acp-uuid-2');
            expect(server.requests.filter((r) => r.method === 'session/new').length).toBe(2);
        } finally {
            server.restore();
            manager.dispose();
        }
    });

    it('dispose 后 sendMessage → 错误卡（传输已关闭）', async () => {
        const { server, manager } = makeManager();
        try {
            manager.dispose();
            const gen = manager.sendMessage('sess-1', '你好', '/vault');
            const r = await gen.next();
            expect(r.value).toEqual({ type: 'error', content: 'ACP 传输已关闭' });
        } finally {
            server.restore();
        }
    });
});
