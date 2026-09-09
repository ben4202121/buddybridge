import { BuddyBridgeAPI } from '../../src/api';
import { createFakeAcp, sessionUpdate } from './fake-server';

// P1 缝合点测试：api.sendMessage 在 transportMode='acp' 时路由到 ACP 管理器，
// 产出同构 StreamChunk，cancel 经 activeStreams 定向，resolveInterruption 透传。
const ORIG_PLATFORM = process.platform;

function acpServer() {
    return createFakeAcp({
        onRequest: (req, respond, emit) => {
            switch (req.method) {
                case 'initialize':
                    respond({ protocolVersion: 1 });
                    return;
                case 'session/new':
                    respond({ sessionId: 'acp-api-uuid' });
                    return;
                case 'session/prompt':
                    emit(sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '来自 ACP' } }));
                    emit(sessionUpdate({ sessionUpdate: 'session_end' }));
                    respond({});
                    return;
                // session/cancel 等通知：不响应
            }
        },
    });
}

beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
});
afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
});

describe('BuddyBridgeAPI ACP 缝合（P1）', () => {
    it('transportMode=acp：sendMessage 走 ACP 分支（spawn --acp），done 携带 acpSessionId', async () => {
        const { server, spawnMock } = acpServer();
        const api = new BuddyBridgeAPI(1000);
        api.setCodebuddyPath('codebuddy');
        api.setTransportMode('acp');
        try {
            const chunks: any[] = [];
            for await (const c of api.sendMessage('api-sess', 'hi', '/vault')) chunks.push(c);

            expect(chunks.some((c) => c.type === 'text' && c.content === '来自 ACP')).toBe(true);
            const done = chunks.find((c) => c.type === 'done');
            expect(done && done.acpSessionId).toBe('acp-api-uuid');

            // spawn 参数确认 ACP 模式
            const args = spawnMock.mock.calls[0][1] as string[];
            expect(args[0]).toBe('--acp');
        } finally {
            api.disposeAcp();
            server.restore();
        }
    });

    it('transportMode 默认 print；setTransportMode(acp) 后切回 print 销毁 ACP 管理器', () => {
        const api = new BuddyBridgeAPI(1000);
        expect(api.getTransportMode()).toBe('print');
        api.setTransportMode('acp');
        expect(api.getTransportMode()).toBe('acp');
        // 切回 print 不抛错（dispose 空管理器）
        expect(() => api.setTransportMode('print')).not.toThrow();
        api.disposeAcp();
    });

    it('cancel(sessionId) 在 ACP 模式定向到 ACP 管理器（发 session/cancel，进程保留）', async () => {
        const { server } = acpServer();
        const api = new BuddyBridgeAPI(1000);
        api.setCodebuddyPath('codebuddy');
        api.setTransportMode('acp');
        try {
            const gen = api.sendMessage('api-sess', 'hi', '/vault');
            const first = await gen.next();
            expect(first.done).toBe(false);

            api.cancel('api-sess');
            // 消费到结束
            for (let r = await gen.next(); !r.done; r = await gen.next()) { /* drain */ }

            const cancels = server.requests.filter((r) => r.method === 'session/cancel');
            expect(cancels.length).toBeGreaterThanOrEqual(1);
        } finally {
            api.disposeAcp();
            server.restore();
        }
    });

    it('ACP 分支把 chat 为绕 cmd 编码的 U+2028 还原为自然换行（print 路径不动）', async () => {
        const promptTexts: string[] = [];
        const { server } = createFakeAcp({
            onRequest: (req, respond, emit) => {
                switch (req.method) {
                    case 'initialize':
                        respond({ protocolVersion: 1 });
                        return;
                    case 'session/new':
                        respond({ sessionId: 'acp-api-uuid' });
                        return;
                    case 'session/prompt':
                        promptTexts.push((req.params.prompt as Array<{ text: string }>)[0].text);
                        emit(sessionUpdate({ sessionUpdate: 'session_end' }));
                        respond({});
                        return;
                }
            },
        });
        const api = new BuddyBridgeAPI(1000);
        api.setCodebuddyPath('codebuddy');
        api.setTransportMode('acp');
        try {
            const input = '第一行' + String.fromCharCode(0x2028) + '第二行';
            for await (const _c of api.sendMessage('api-sess', input, '/vault')) { /* drain */ }
            expect(promptTexts.length).toBe(1);
            // U+2028 已被还原为 \n
            expect(promptTexts[0]).toBe('第一行\n第二行');
            expect(promptTexts[0].includes(String.fromCharCode(0x2028))).toBe(false);
        } finally {
            api.disposeAcp();
            server.restore();
        }
    });
});
