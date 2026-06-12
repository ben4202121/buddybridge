import { BuddyBridgeAPI } from '../src/api';

describe('BuddyBridgeAPI', () => {
    let api: BuddyBridgeAPI;
    beforeEach(() => { api = new BuddyBridgeAPI('http://127.0.0.1:55808'); });

    it('should create instance', () => { expect(api).toBeDefined(); });
    it('should accept custom timeout', () => { const a = new BuddyBridgeAPI('http://127.0.0.1:55808', 5000); expect(a).toBeDefined(); });
    it('should generate valid UUID', () => { expect(api.generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); });

    describe('setGatewayUrl', () => {
        it('should update url', () => { api.setGatewayUrl('http://new:1234'); expect(api).toBeDefined(); });
    });

    describe('cancel', () => {
        it('should not throw when no request', () => { api.cancel(); });
    });

    describe('sendMessage', () => {
        it('should throw abort error when fetch rejects with AbortError', async () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            global.fetch = jest.fn(() => Promise.reject(err)) as any;
            const gen = api.sendMessage('', 'test');
            await expect(gen.next()).rejects.toThrow('请求已取消');
        });

        it('should yield text chunks from SSE stream', async () => {
            // Mock a fetch that returns a ReadableStream with SSE data
            const chunks = [
                'data: {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello "},"messageId":"m1"}}}\n\n',
                'data: {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"World"},"messageId":"m2"}}}\n\n'
            ];
            const stream = new ReadableStream({
                start(controller) {
                    for (const chunk of chunks) {
                        controller.enqueue(new TextEncoder().encode(chunk));
                    }
                    controller.close();
                }
            });
            global.fetch = jest.fn(() => Promise.resolve(new Response(stream))) as any;

            const gen = api.sendMessage('', 'test');
            const results: string[] = [];
            for await (const chunk of gen) { results.push(chunk); }
            expect(results).toEqual(['Hello ', 'World']);
        });
    });
});
