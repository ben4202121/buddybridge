import { spawn } from 'child_process';
import { BuddyBridgeAPI, parseStreamLine, parseMessageBlock, blockToChunk, parseStreamEvent, isWindowsWrapper, isBareFallback, needsWindowsShell, escapeCmdArg, isStartupBanner, resolveCodebuddyPath, extractUsage, usagePercent, usageLevel, type StreamChunk } from '../src/api';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('child_process');
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createFakeProc() {
    const handlers: Record<string, Function[]> = {};
    const proc = {
        stdout: {
            on: (event: string, cb: Function) => {
                handlers[`stdout:${event}`] = handlers[`stdout:${event}`] || [];
                handlers[`stdout:${event}`].push(cb);
            }
        },
        stderr: {
            on: (event: string, cb: Function) => {
                handlers[`stderr:${event}`] = handlers[`stderr:${event}`] || [];
                handlers[`stderr:${event}`].push(cb);
            }
        },
        on: (event: string, cb: Function) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
        }
    };
    const emit = (source: string, event: string, ...args: unknown[]) => {
        const key = source ? `${source}:${event}` : event;
        handlers[key]?.forEach(cb => cb(...args));
    };
    return { proc, emit };
}

describe('BuddyBridgeAPI', () => {
    let api: BuddyBridgeAPI;
    beforeEach(() => { api = new BuddyBridgeAPI(); });

    it('should create instance', () => { expect(api).toBeDefined(); });
    it('should accept custom timeout', () => { const a = new BuddyBridgeAPI(5000); expect(a).toBeDefined(); });
    it('should generate valid UUID', () => { expect(api.generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); });

    describe('setCodebuddyPath', () => {
        it('should not throw', () => { api.setCodebuddyPath(''); });
    });

    describe('cancel', () => {
        it('should not throw', () => { api.cancel(); });
    });

    describe('sendMessage', () => {
        it('streams text chunks from child process', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-1', 'hello');

            const firstPromise = gen.next();
            emit('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'world' }) + '\n'));
            const first = await firstPromise;
            expect(first.done).toBe(false);
            expect(first.value).toEqual({ type: 'text', content: 'world' });

            const secondPromise = gen.next();
            emit('', 'close', 0, null);
            const second = await secondPromise;
            expect(second.done).toBe(true);
        });

        it('throws when stderr is non-empty and stdout is empty', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-2', 'hello');

            const firstPromise = gen.next();
            emit('stderr', 'data', Buffer.from('command not found'));
            emit('', 'close', 1, null);
            await expect(firstPromise).rejects.toThrow('command not found');
        });

        it('runs two concurrent streams independently (per-session state)', async () => {
            const { proc: procA, emit: emitA } = createFakeProc();
            const { proc: procB, emit: emitB } = createFakeProc();
            const spawnCalls: unknown[][] = [];
            mockedSpawn.mockImplementation((...args: any[]) => {
                spawnCalls.push(args);
                return (spawnCalls.length === 1 ? procA : procB) as any;
            });

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');

            const genA = api.sendMessage('session-A', 'hello A');
            const genB = api.sendMessage('session-B', 'hello B');

            const pA = genA.next();
            const pB = genB.next();

            emitA('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'A1' }) + '\n'));
            emitB('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'B1' }) + '\n'));

            const [rA, rB] = await Promise.all([pA, pB]);
            expect(rA.done).toBe(false);
            expect(rA.value).toEqual({ type: 'text', content: 'A1' });
            expect(rB.done).toBe(false);
            expect(rB.value).toEqual({ type: 'text', content: 'B1' });
            // 两个会话各自 spawn 了一次独立进程
            expect(spawnCalls).toHaveLength(2);

            // 正常收尾两个会话
            emitA('', 'close', 0, null);
            emitB('', 'close', 0, null);
            const [fA, fB] = await Promise.all([genA.next(), genB.next()]);
            expect(fA.done).toBe(true);
            expect(fB.done).toBe(true);
        });

        it('cancel(sessionId) only cancels that session; the other stream continues', async () => {
            const { proc: procA, emit: emitA } = createFakeProc();
            const { proc: procB, emit: emitB } = createFakeProc();
            const spawnCalls: unknown[][] = [];
            mockedSpawn.mockImplementation((...args: any[]) => {
                spawnCalls.push(args);
                return (spawnCalls.length === 1 ? procA : procB) as any;
            });

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');

            const genA = api.sendMessage('session-A', 'hello A');
            const genB = api.sendMessage('session-B', 'hello B');

            const pA = genA.next();
            const pB = genB.next();

            // 定向取消会话 A：A 立即结束，B 不受影响
            api.cancel('session-A');
            const rA = await pA;
            expect(rA.done).toBe(true);

            emitB('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'B1' }) + '\n'));
            const rB = await pB;
            expect(rB.done).toBe(false);
            expect(rB.value).toEqual({ type: 'text', content: 'B1' });

            // 收尾 B；取消一个不存在的会话不抛错（注销后表已清空）
            emitB('', 'close', 0, null);
            await genB.next();
            expect(() => api.cancel('nope')).not.toThrow();
        });

        it('cancel() with no args cancels all in-flight streams', async () => {
            const { proc: procA } = createFakeProc();
            const { proc: procB } = createFakeProc();
            const spawnCalls: unknown[][] = [];
            mockedSpawn.mockImplementation((...args: any[]) => {
                spawnCalls.push(args);
                return (spawnCalls.length === 1 ? procA : procB) as any;
            });

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');

            const genA = api.sendMessage('session-A', 'hello A');
            const genB = api.sendMessage('session-B', 'hello B');

            const pA = genA.next();
            const pB = genB.next();

            api.cancel();

            const [rA, rB] = await Promise.all([pA, pB]);
            expect(rA.done).toBe(true);
            expect(rB.done).toBe(true);
        });

        it('runs three concurrent streams; cancelling one leaves the other two intact', async () => {
            const { proc: procA, emit: emitA } = createFakeProc();
            const { proc: procB, emit: emitB } = createFakeProc();
            const { proc: procC, emit: emitC } = createFakeProc();
            const spawnCalls: unknown[][] = [];
            mockedSpawn.mockImplementation((...args: any[]) => {
                spawnCalls.push(args);
                return [procA, procB, procC][spawnCalls.length - 1] as any;
            });

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');

            const genA = api.sendMessage('session-A', 'hello A');
            const genB = api.sendMessage('session-B', 'hello B');
            const genC = api.sendMessage('session-C', 'hello C');

            const pA = genA.next();
            const pB = genB.next();
            const pC = genC.next();

            // 三条流同时产出各自首个 chunk
            emitA('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'A1' }) + '\n'));
            emitB('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'B1' }) + '\n'));
            emitC('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'C1' }) + '\n'));

            const [rA, rB, rC] = await Promise.all([pA, pB, pC]);
            expect(rA.done).toBe(false);
            expect(rA.value).toEqual({ type: 'text', content: 'A1' });
            expect(rB.value).toEqual({ type: 'text', content: 'B1' });
            expect(rC.value).toEqual({ type: 'text', content: 'C1' });
            // 三个会话各自 spawn 了一次独立进程
            expect(spawnCalls).toHaveLength(3);

            // 定向取消中间那条 B：B 立即结束，A/C 继续工作
            api.cancel('session-B');
            const fB = await genB.next();
            expect(fB.done).toBe(true);

            // A 继续产出并正常收尾
            emitA('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'A2' }) + '\n'));
            emitA('', 'close', 0, null);
            const fA = await genA.next();
            expect(fA.done).toBe(false);
            expect(fA.value).toEqual({ type: 'text', content: 'A2' });
            expect((await genA.next()).done).toBe(true);

            // C 继续产出并正常收尾
            emitC('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'C2' }) + '\n'));
            emitC('', 'close', 0, null);
            const fC = await genC.next();
            expect(fC.done).toBe(false);
            expect(fC.value).toEqual({ type: 'text', content: 'C2' });
            expect((await genC.next()).done).toBe(true);
        });
    });
});

describe('parseMessageBlock', () => {
    it('returns null for non-objects', () => {
        expect(parseMessageBlock(null)).toBeNull();
        expect(parseMessageBlock('text')).toBeNull();
    });

    it('returns null for unsupported types', () => {
        expect(parseMessageBlock({ type: 'image' })).toBeNull();
    });

    it('parses thinking block', () => {
        expect(parseMessageBlock({ type: 'thinking', thinking: 'reason' })).toEqual({
            type: 'thinking',
            thinking: 'reason',
            text: undefined,
            name: undefined,
            input: undefined
        });
    });

    it('parses text block', () => {
        expect(parseMessageBlock({ type: 'text', text: 'hi' })).toEqual({
            type: 'text', thinking: undefined, text: 'hi', name: undefined, input: undefined
        });
    });

    it('parses tool_call block', () => {
        expect(parseMessageBlock({ type: 'tool_call', name: 'read', input: { x: 1 } })).toEqual({
            type: 'tool_call',
            thinking: undefined,
            text: undefined,
            name: 'read',
            input: { x: 1 }
        });
    });
});

describe('blockToChunk', () => {
    it('converts thinking block', () => {
        expect(blockToChunk({ type: 'thinking', thinking: 't' })).toEqual({ type: 'thinking', content: 't' });
    });

    it('converts text block', () => {
        expect(blockToChunk({ type: 'text', text: 't' })).toEqual({ type: 'text', content: 't' });
    });

    it('converts tool_call block with string input', () => {
        expect(blockToChunk({ type: 'tool_call', name: 'n', input: 'arg' })).toEqual({
            type: 'tool', content: '', toolName: 'n', toolDetail: 'arg'
        });
    });

    it('converts tool_call block with object input', () => {
        expect(blockToChunk({ type: 'tool_call', name: 'n', input: { x: 1 } })).toEqual({
            type: 'tool', content: '', toolName: 'n', toolDetail: JSON.stringify({ x: 1 })
        });
    });
});

describe('parseStreamEvent', () => {
    it('returns null for non-objects', () => {
        expect(parseStreamEvent('string')).toBeNull();
        expect(parseStreamEvent(null)).toBeNull();
    });

    it('extracts event from nested event property', () => {
        expect(parseStreamEvent({ event: { type: 'text', text: 'nested' } })).toMatchObject({
            type: 'text', text: 'nested'
        });
    });

    it('falls back to raw object when event property is not an object', () => {
        expect(parseStreamEvent({ type: 'direct', text: 'value' })).toMatchObject({
            type: 'direct', text: 'value'
        });
    });
});

describe('path helpers', () => {
    describe('isWindowsWrapper', () => {
        it('returns true for windows executables', () => {
            expect(isWindowsWrapper('a.cmd')).toBe(true);
            expect(isWindowsWrapper('a.exe')).toBe(true);
            expect(isWindowsWrapper('a.bat')).toBe(true);
        });

        it('returns false otherwise', () => {
            expect(isWindowsWrapper('a')).toBe(false);
            expect(isWindowsWrapper('a.js')).toBe(false);
        });
    });

    describe('isBareFallback', () => {
        it('returns true for bare command and relative paths', () => {
            expect(isBareFallback('codebuddy')).toBe(true);
            expect(isBareFallback('relative/path')).toBe(true);
        });

        it('returns false for absolute paths', () => {
            expect(isBareFallback('/usr/bin/codebuddy')).toBe(false);
            expect(isBareFallback('C:\\codebuddy.exe')).toBe(false);
        });
    });

    describe('needsWindowsShell', () => {
        const originalPlatform = process.platform;
        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        it('returns true on win32 for batch files', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            expect(needsWindowsShell('a.cmd')).toBe(true);
            expect(needsWindowsShell('a.bat')).toBe(true);
            expect(needsWindowsShell('a.exe')).toBe(false);
        });

        it('returns false on non-windows platforms', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            expect(needsWindowsShell('a.cmd')).toBe(false);
        });
    });
});

describe('resolveCodebuddyPath', () => {
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    const originalPlatform = process.platform;
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));
        const npmDir = path.join(tempDir, 'npm');
        fs.mkdirSync(npmDir);
        fs.writeFileSync(path.join(npmDir, 'codebuddy.cmd'), '');
        process.env.APPDATA = tempDir;
        // 隔离真实安装：LOCALAPPDATA 指向不存在的目录，避免命中本机真实 WorkBuddy
        process.env.LOCALAPPDATA = path.join(tempDir, 'no-workbuddy');
        // CI 跑在 Linux 上：固定走 win32 候选分支（APPDATA\npm\codebuddy.cmd），
        // 与 needsWindowsShell 测试同样的 platform mock 模式。
        Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env.APPDATA = originalAppData;
        process.env.LOCALAPPDATA = originalLocalAppData;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves codebuddy from known candidate paths', () => {
        const result = resolveCodebuddyPath('');
        expect(result).toBe(path.join(tempDir, 'npm', 'codebuddy.cmd'));
    });
});

describe('parseStreamLine', () => {
    it('returns null for empty lines', () => {
        expect(parseStreamLine('')).toBeNull();
        expect(parseStreamLine('   ')).toBeNull();
    });

    it('returns text chunk for plain text on parse failure', () => {
        expect(parseStreamLine('not json')).toEqual({ type: 'text', content: 'not json' });
    });

    it('parses assistant envelope with thinking block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'thinking', thinking: 'step 1' }]
            }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'thinking', content: 'step 1' });
    });

    it('parses assistant envelope with text block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'hello' }]
            }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'hello' });
    });

    it('parses assistant envelope with tool_call block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'tool_call', name: 'read', input: { path: '/tmp' } }]
            }
        });
        const expected: StreamChunk = {
            type: 'tool',
            content: '',
            toolName: 'read',
            toolDetail: JSON.stringify({ path: '/tmp' })
        };
        expect(parseStreamLine(line)).toEqual(expected);
    });

    it('parses user envelope with text block', () => {
        const line = JSON.stringify({
            type: 'user',
            message: {
                content: [{ type: 'text', text: 'user hello' }]
            }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'user hello' });
    });

    it('returns null for assistant envelope without recognized blocks', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'image', url: 'http://x' }]
            }
        });
        expect(parseStreamLine(line)).toBeNull();
    });

    it('parses direct thinking event', () => {
        const line = JSON.stringify({ type: 'thinking', thinking: 'reasoning' });
        expect(parseStreamLine(line)).toEqual({ type: 'thinking', content: 'reasoning' });
    });

    it('parses direct message_delta event', () => {
        const line = JSON.stringify({ type: 'message_delta', text: 'delta' });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'delta' });
    });

    it('parses direct tool_call event', () => {
        const line = JSON.stringify({ type: 'tool_call', name: 'write', input: 'data' });
        const expected: StreamChunk = {
            type: 'tool',
            content: '',
            toolName: 'write',
            toolDetail: 'data'
        };
        expect(parseStreamLine(line)).toEqual(expected);
    });

    it('parses result event', () => {
        const line = JSON.stringify({ type: 'result', result: 'done' });
        expect(parseStreamLine(line)).toEqual({ type: 'done', content: 'done' });
    });

    it('parses error event', () => {
        const line = JSON.stringify({ type: 'error', error: 'fail' });
        expect(parseStreamLine(line)).toEqual({ type: 'error', content: 'fail' });
    });

    it('falls back to message when error field is missing', () => {
        const line = JSON.stringify({ type: 'error', message: 'oops' });
        expect(parseStreamLine(line)).toEqual({ type: 'error', content: 'oops' });
    });

    it('uses fallback text fields for unknown events', () => {
        const line = JSON.stringify({ type: 'unknown', content: 'fallback' });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'fallback' });
    });

    it('returns null for unknown events without fallback text', () => {
        const line = JSON.stringify({ type: 'unknown', value: 123 });
        expect(parseStreamLine(line)).toBeNull();
    });

    it('attaches usage to assistant text chunk (P2.5)', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'hello' }],
                usage: { input_tokens: 24512, output_tokens: 1024 }
            }
        });
        expect(parseStreamLine(line)).toEqual({
            type: 'text',
            content: 'hello',
            usage: { inputTokens: 24512, outputTokens: 1024 }
        });
    });

    it('attaches usage to empty assistant envelope (P2.5)', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'image', url: 'http://x' }],
                usage: { input_tokens: 100, output_tokens: 50 }
            }
        });
        expect(parseStreamLine(line)).toEqual({
            type: 'text',
            content: '',
            usage: { inputTokens: 100, outputTokens: 50 }
        });
    });
});

describe('extractUsage (P2.5 上下文用量)', () => {
    it('extracts input/output tokens from message.usage', () => {
        const raw = { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } };
        expect(extractUsage(raw)).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('handles missing output_tokens (defaults to 0)', () => {
        const raw = { type: 'assistant', message: { usage: { input_tokens: 100 } } };
        expect(extractUsage(raw)).toEqual({ inputTokens: 100, outputTokens: 0 });
    });

    it('handles missing input_tokens (defaults to 0)', () => {
        const raw = { type: 'assistant', message: { usage: { output_tokens: 50 } } };
        expect(extractUsage(raw)).toEqual({ inputTokens: 0, outputTokens: 50 });
    });

    it('returns undefined when both token fields absent', () => {
        expect(extractUsage({ type: 'assistant', message: { usage: {} } })).toBeUndefined();
    });

    it('returns undefined when no message.usage', () => {
        expect(extractUsage({ type: 'assistant', message: { content: [] } })).toBeUndefined();
    });

    it('returns undefined for zero tokens', () => {
        const raw = { type: 'assistant', message: { usage: { input_tokens: 0, output_tokens: 0 } } };
        expect(extractUsage(raw)).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    it('returns undefined for non-object input', () => {
        expect(extractUsage(null)).toBeUndefined();
        expect(extractUsage('nope')).toBeUndefined();
        expect(extractUsage([])).toBeUndefined();
    });
});

describe('usagePercent / usageLevel (P2.5 用量条分级)', () => {
    it('computes plain percentage', () => {
        expect(usagePercent(100000, 200000)).toBeCloseTo(50, 5);
        expect(usagePercent(20000, 200000)).toBeCloseTo(10, 5);
    });

    it('clamps below 0 and above 100', () => {
        expect(usagePercent(-50, 200000)).toBe(0);
        expect(usagePercent(250000, 200000)).toBe(100);
    });

    it('treats invalid window as 0%', () => {
        expect(usagePercent(100, 0)).toBe(0);
        expect(usagePercent(100, -5)).toBe(0);
    });

    it('grades warn at >=80% and critical at >=100%', () => {
        expect(usageLevel(79.9)).toBe('normal');
        expect(usageLevel(80)).toBe('warn');
        expect(usageLevel(99.9)).toBe('warn');
        expect(usageLevel(100)).toBe('critical');
        expect(usageLevel(150)).toBe('critical');
        expect(usageLevel(0)).toBe('normal');
    });
});

describe('isStartupBanner (启动横幅过滤, 防误伤正文)', () => {
    it('detects CLI startup banner lines', () => {
        expect(isStartupBanner('Working directory: C:\\vault')).toBe(true);
        expect(isStartupBanner('Vault path: C:\\vault')).toBe(true);
        expect(isStartupBanner('已确认')).toBe(true);
        expect(isStartupBanner('Standing by...')).toBe(true);
    });

    it('does not flag reply text that merely contains keywords mid-sentence', () => {
        expect(isStartupBanner('好的，我已经完成了文件操作，结果如下')).toBe(false);
        expect(isStartupBanner('这个工作目录的配置需要调整')).toBe(false);
        expect(isStartupBanner('我已经确认了你的要求')).toBe(false);
        expect(isStartupBanner('请确认后再执行下一步')).toBe(false);
    });
});

describe('escapeCmdArg (P0.2 shell safety)', () => {
    it('wraps empty string in quotes', () => {
        expect(escapeCmdArg('')).toBe('""');
    });

    it('wraps plain text with spaces in quotes', () => {
        expect(escapeCmdArg('hello world')).toBe('"hello world"');
    });

    it('escapes cmd special characters', () => {
        expect(escapeCmdArg('a&b|c>d<e^f"g')).toBe('"a^&b^|c^>d^<e^^f^"g"');
    });

    it('keeps chinese characters intact', () => {
        expect(escapeCmdArg('中文消息 & 更多')).toBe('"中文消息 ^& 更多"');
    });

    it('keeps newlines as literal characters inside quotes', () => {
        expect(escapeCmdArg('line1\nline2')).toBe('"line1\nline2"');
    });
});

describe('sendMessage shell branch (P0.2)', () => {
    let tempDir: string;
    const originalPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-shell-'));
        jest.clearAllMocks();
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('spawns .exe without shell and passes raw text', async () => {
        const exePath = path.join(tempDir, 'codebuddy.exe');
        fs.writeFileSync(exePath, '');
        mockedSpawn.mockReturnValue(createFakeProc().proc as any);

        const api = new BuddyBridgeAPI();
        api.setCodebuddyPath(exePath);
        void api.sendMessage('s1', 'hello & world').next();

        const call = mockedSpawn.mock.calls[0];
        expect(call[0]).toBe(exePath);
        const args = call[1] as string[];
        expect(args[args.length - 1]).toBe('hello & world'); // 原样透传，不进 shell
        expect((call[2] as any).shell).toBeFalsy();
    });

    it('spawns .cmd with shell:true and escapes user text', async () => {
        const cmdPath = path.join(tempDir, 'codebuddy.cmd');
        fs.writeFileSync(cmdPath, '');
        mockedSpawn.mockReturnValue(createFakeProc().proc as any);

        const api = new BuddyBridgeAPI();
        api.setCodebuddyPath(cmdPath);
        void api.sendMessage('s1', 'a&b').next();

        const call = mockedSpawn.mock.calls[0];
        expect(call[0]).toBe(cmdPath);
        const args = call[1] as string[];
        expect(args[args.length - 1]).toBe(escapeCmdArg('a&b'));
        expect((call[2] as any).shell).toBe(true);
    });
});

describe('sendMessage exit code classification (P0.5)', () => {
    it('treats exit 0 with stdout as success', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const api = new BuddyBridgeAPI();
        api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
        const gen = api.sendMessage('s1', 'hi');
        const p = gen.next();
        emit('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'ok' }) + '\n'));
        const first = await p;
        expect(first.done).toBe(false);
        const p2 = gen.next();
        emit('', 'close', 0, null);
        const second = await p2;
        expect(second.done).toBe(true);
    });

    it('treats exit 0 with only stderr as benign warning (no throw)', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const api = new BuddyBridgeAPI();
        api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
        const gen = api.sendMessage('s1', 'hi');
        const p = gen.next();
        emit('stderr', 'data', Buffer.from('warning only'));
        emit('', 'close', 0, null);
        const result = await p;
        expect(result.done).toBe(true);
    });

    it('throws error when non-zero exit and empty stdout', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const api = new BuddyBridgeAPI();
        api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
        const gen = api.sendMessage('s1', 'hi');
        const p = gen.next();
        emit('', 'close', 1, null);
        await expect(p).rejects.toThrow(/退出码 1/);
    });

    it('treats non-zero exit with stdout as normal finish (stderr logged only)', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const api = new BuddyBridgeAPI();
        api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
        const gen = api.sendMessage('s1', 'hi');
        const p = gen.next();
        emit('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'partial' }) + '\n'));
        const first = await p;
        expect(first.done).toBe(false);
        const p2 = gen.next();
        emit('', 'close', 1, null);
        const second = await p2;
        expect(second.done).toBe(true);
    });
});

describe('sendMessage timeout (P0.3)', () => {
    it('yields a clear timeout error chunk and ends', async () => {
        const { proc } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const api = new BuddyBridgeAPI(50); // 50ms 超时
        api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
        const gen = api.sendMessage('s1', 'hi');

        const p = gen.next();
        const first = await p; // 等待插件侧超时触发
        expect(first.done).toBe(false);
        expect(first.value).toMatchObject({ type: 'error' });
        expect((first.value as StreamChunk).content).toContain('请求超时');

        const second = await gen.next();
        expect(second.done).toBe(true);
    });
});

describe('resolveCodebuddyPath .exe priority (P0.2)', () => {
    const originalLocal = process.env.LOCALAPPDATA;
    const originalApp = process.env.APPDATA;
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-exe-'));
        const bin = path.join(tempDir, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, 'codebuddy.exe'), '');
        fs.writeFileSync(path.join(bin, 'codebuddy.cmd'), '');
        process.env.LOCALAPPDATA = tempDir;
        process.env.APPDATA = tempDir;
    });

    afterEach(() => {
        process.env.LOCALAPPDATA = originalLocal;
        process.env.APPDATA = originalApp;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('prefers .exe over .cmd in the same WorkBuddy install dir', () => {
        if (process.platform !== 'win32') return; // 仅 Windows 候选路径包含该结构
        const result = resolveCodebuddyPath('');
        expect(result.toLowerCase().endsWith('codebuddy.exe')).toBe(true);
    });

    it('keeps a non-existent explicit custom path so spawn surfaces a clear error', () => {
        const custom = 'C:\\Definitely\\Not\\Exist\\codebuddy.exe';
        expect(resolveCodebuddyPath(custom)).toBe(custom);
    });
});

describe('sendMessage nodePath override (P2.6)', () => {
    it('uses the manually specified node path for a bare script', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-node-'));
        try {
            const nodePath = path.join(tempDir, 'node.exe');
            fs.writeFileSync(nodePath, '');
            const scriptPath = path.join(tempDir, 'codebuddy'); // 无扩展名绝对路径 → 走 node 启动分支
            fs.writeFileSync(scriptPath, '');
            mockedSpawn.mockReturnValue(createFakeProc().proc as any);
            jest.clearAllMocks();

            const api = new BuddyBridgeAPI();
            api.setCodebuddyPath(scriptPath);
            api.setNodePath(nodePath);
            void api.sendMessage('s1', 'hi').next();

            const call = mockedSpawn.mock.calls[0];
            expect(call[0]).toBe(nodePath);
            expect(call[1]).toContain(scriptPath);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
