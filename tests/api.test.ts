import { spawn } from 'child_process';
import { BuddyBridgeAPI, parseStreamLine, parseMessageBlock, blockToChunk, parseStreamEvent, isWindowsWrapper, isBareFallback, needsWindowsShell, resolveCodebuddyPath, type StreamChunk } from '../src/api';
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
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));
        const npmDir = path.join(tempDir, 'npm');
        fs.mkdirSync(npmDir);
        fs.writeFileSync(path.join(npmDir, 'codebuddy.cmd'), '');
        process.env.APPDATA = tempDir;
    });

    afterEach(() => {
        process.env.APPDATA = originalAppData;
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
});
