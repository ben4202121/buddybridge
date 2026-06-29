import { spawn, type SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getErrorMessage, getString, isObject } from './types';

const TIMEOUT = 300_000; // 5 分钟

// ===== 流式事件类型 =====

export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
}

interface MessageBlock {
    type: 'thinking' | 'text' | 'tool_call';
    thinking?: string;
    text?: string;
    name?: string;
    input?: unknown;
}

interface StreamEvent {
    type: string;
    thinking?: string;
    text?: string;
    name?: string;
    input?: unknown;
    result?: string;
    error?: string;
    message?: string;
    content?: string;
}

// ===== Node.js 可执行文件查找 =====

const NODE_EXECUTABLE = process.platform === 'win32' ? 'node.exe' : 'node';

export function findNodeExecutable(): string | null {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const nodeDirs: string[] = [];

    if (process.platform === 'win32') {
        nodeDirs.push(path.dirname(process.execPath));
        const appData = process.env.APPDATA || '';
        if (appData) {
            nodeDirs.push(appData);
            nodeDirs.push(path.join(appData, 'npm'));
        }
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env.LOCALAPPDATA || '';
        nodeDirs.push(
            path.join(programFiles, 'nodejs'),
            path.join(programFilesX86, 'nodejs'),
        );
        if (localAppData) {
            nodeDirs.push(path.join(localAppData, 'Programs', 'nodejs'));
        }
        const nvmSymlink = process.env.NVM_SYMLINK;
        if (nvmSymlink) {
            nodeDirs.push(nvmSymlink);
        }

        // Managed WorkBuddy Node.js (scan version directories)
        if (home) {
            const wbNodeVersionsDir = path.join(home, '.workbuddy', 'binaries', 'node', 'versions');
            try {
                const versions = fs.readdirSync(wbNodeVersionsDir);
                for (const v of versions) {
                    nodeDirs.push(path.join(wbNodeVersionsDir, v));
                }
            } catch { /* ignore missing directory */ }
        }

        // Scan common drive letters for nodejs (handles non-C: installs)
        for (const drive of ['C:', 'D:', 'E:']) {
            if (drive + '\\' !== path.parse(programFiles).root.toUpperCase()) {
                nodeDirs.push(path.join(drive + '\\Program Files', 'nodejs'));
            }
        }
    } else {
        nodeDirs.push(
            path.join(home, '.local', 'bin'),
            path.join(home, '.npm-global', 'bin'),
            path.join(home, '.volta', 'bin'),
            path.join(home, 'bin', 'codebuddy'),
            '/usr/local/bin/codebuddy',
            '/opt/homebrew/bin/codebuddy',
        );
        const nvmBin = process.env.NVM_BIN;
        if (nvmBin) {
            nodeDirs.push(nvmBin);
        }
    }

    for (const dir of nodeDirs) {
        if (!dir) continue;
        try {
            const nodePath = path.join(dir, NODE_EXECUTABLE);
            if (fs.existsSync(nodePath) && fs.statSync(nodePath).isFile()) {
                console.log('[BB] found node at:', nodePath);
                return nodePath;
            }
        } catch { /* ignore inaccessible path */ }
    }

    console.log("[BB] WARNING: node not found in any search path, falling back to 'node'");
    return 'node';
}

// ===== CodeBuddy CLI 路径查找 =====

export function resolveCodebuddyPath(customPath: string): string {
    if (customPath && fs.existsSync(customPath)) {
        return customPath;
    }
    if (process.env.CODEBUDDY_PATH && fs.existsSync(process.env.CODEBUDDY_PATH)) {
        return process.env.CODEBUDDY_PATH;
    }

    const home = process.env.HOME || process.env.USERPROFILE || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates: string[] = [];

    if (process.platform === 'win32') {
        // Windows 上优先使用可直接执行的 .exe / .cmd，避免选中无扩展名的 npm shell shim
        candidates.push(
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
        );
        if (appData) {
            candidates.push(path.join(appData, 'npm', 'codebuddy.cmd'));
            candidates.push(path.join(appData, 'npm', 'codebuddy'));
        }
        candidates.push(
            path.join(programFiles, 'nodejs', 'codebuddy.cmd'),
            path.join(programFiles, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
            path.join(programFilesX86, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
            path.join(programFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
            path.join(programFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
            path.join(programFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
            path.join(programFilesX86, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
            path.join(programFilesX86, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
            path.join(programFilesX86, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
        );

        // Scan common drive letters for WorkBuddy installation
        for (const drive of ['C:', 'D:', 'E:']) {
            candidates.push(
                path.join(drive + '\\Program Files', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
                path.join(drive + '\\Program Files', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
                path.join(drive + '\\Program Files', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
            );
        }
    } else {
        candidates.push(
            path.join(home, '.local', 'bin', 'codebuddy'),
            path.join(home, '.npm-global', 'bin', 'codebuddy'),
            path.join(home, '.volta', 'bin', 'codebuddy'),
            path.join(home, 'bin', 'codebuddy'),
            '/usr/local/bin/codebuddy',
            '/opt/homebrew/bin/codebuddy',
        );
    }

    const nvmBin = process.env.NVM_BIN;
    if (nvmBin) candidates.push(path.join(nvmBin, 'codebuddy'));
    const npmPrefix = process.env.npm_config_prefix;
    if (npmPrefix) candidates.push(path.join(npmPrefix, 'bin', 'codebuddy'));

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            console.log('[BB] resolved codebuddy path:', p);
            return p;
        }
    }

    // 搜索系统 PATH
    const envPath = process.env.PATH || '';
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const exeNames = process.platform === 'win32' ? ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy'] : ['codebuddy'];
    for (const dir of envPath.split(pathSep)) {
        if (!dir) continue;
        for (const name of exeNames) {
            try {
                const p = path.join(dir, name);
                if (fs.existsSync(p)) return p;
            } catch { /* ignore inaccessible path */ }
        }
    }

    return 'codebuddy';
}

// ===== 消息块解析 =====

export function parseMessageBlock(block: unknown): MessageBlock | null {
    if (!isObject(block)) return null;
    const type = getString(block, 'type');
    if (type !== 'thinking' && type !== 'text' && type !== 'tool_call') return null;
    return {
        type,
        thinking: getString(block, 'thinking'),
        text: getString(block, 'text'),
        name: getString(block, 'name'),
        input: block.input,
    };
}

export function blockToChunk(block: MessageBlock): StreamChunk | null {
    if (block.type === 'thinking') {
        return { type: 'thinking', content: block.thinking || '' };
    }
    if (block.type === 'text') {
        return { type: 'text', content: block.text || '' };
    }
    const input = block.input;
    return {
        type: 'tool',
        content: '',
        toolName: block.name || 'unknown',
        toolDetail: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
    };
}

// ===== 流事件解析 =====

export function parseStreamEvent(raw: unknown): StreamEvent | null {
    if (!isObject(raw)) return null;
    const event = isObject(raw.event) ? raw.event : raw;
    if (!isObject(event)) return null;
    return {
        type: getString(event, 'type') || '',
        thinking: getString(event, 'thinking'),
        text: getString(event, 'text'),
        name: getString(event, 'name'),
        input: event.input,
        result: getString(event, 'result'),
        error: getString(event, 'error'),
        message: getString(event, 'message'),
        content: getString(event, 'content'),
    };
}

export function parseStreamLine(line: string): StreamChunk | null {
    if (!line.trim()) return null;
    try {
        const raw = JSON.parse(line) as unknown;

        // Shape 1: assistant/user envelope with nested message.content blocks
        if (isObject(raw) && (raw.type === 'assistant' || raw.type === 'user')) {
            const message = isObject(raw.message) ? raw.message : null;
            const content = Array.isArray(message?.content) ? message.content : [];
            for (const item of content) {
                const block = parseMessageBlock(item);
                if (block) {
                    const chunk = blockToChunk(block);
                    if (chunk) return chunk;
                }
            }
            return null;
        }

        // Shape 2: direct event object
        const event = parseStreamEvent(raw);
        if (!event) return null;

        if (event.type === 'thinking') {
            return { type: 'thinking', content: event.thinking || '' };
        }
        if (event.type === 'message_delta') {
            return { type: 'text', content: event.text || '' };
        }
        if (event.type === 'tool_call') {
            const input = event.input;
            return {
                type: 'tool',
                content: '',
                toolName: event.name || 'unknown',
                toolDetail: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
            };
        }
        if (event.type === 'result') {
            return { type: 'done', content: event.result || '' };
        }
        if (event.type === 'error') {
            return { type: 'error', content: event.error || event.message || '未知错误' };
        }

        // 未知事件类型, 输出原始 JSON 便于调试
        console.log('[BB] unknown event:', line.substring(0, 200));
        const fallbackText = event.text || event.content || event.message || '';
        if (fallbackText) {
            return { type: 'text', content: fallbackText };
        }
        return null;
    } catch {
        return { type: 'text', content: line };
    }
}

// ===== 判断是否需要 node 来执行 =====

export function isWindowsWrapper(scriptPath: string): boolean {
    return scriptPath.endsWith('.cmd') || scriptPath.endsWith('.exe') || scriptPath.endsWith('.bat');
}

export function isBareFallback(scriptPath: string): boolean {
    // 兜底值 'codebuddy' 不是真实文件路径，让 OS 在 PATH 里找
    return scriptPath === 'codebuddy' || !path.isAbsolute(scriptPath);
}

export function needsWindowsShell(scriptPath: string): boolean {
    return process.platform === 'win32' && (scriptPath.endsWith('.cmd') || scriptPath.endsWith('.bat'));
}

export class BuddyBridgeAPI {
    private timeout: number;
    private scriptPath: string;

    constructor(timeout: number = TIMEOUT) {
        this.timeout = timeout;
        this.scriptPath = resolveCodebuddyPath('');
    }

    setCodebuddyPath(p: string): void {
        this.scriptPath = resolveCodebuddyPath(p);
    }

    generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r: number = (Math.random() * 16) | 0;
            const v: number = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    async *sendMessage(sessionId: string, text: string, vaultPath?: string): AsyncGenerator<StreamChunk> {
        const scriptPath = this.scriptPath;
        const procOptions: SpawnOptions = {
            timeout: this.timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
        };
        if (vaultPath) {
            procOptions.cwd = vaultPath;
        }

        // --print --output-format stream-json: 结构化流式输出
        const cliArgs = ['--print', '--output-format', 'stream-json', '--session-id', sessionId, text];

        // Node 18+ Windows 下 spawn .cmd/.bat 需要 shell: true
        if (needsWindowsShell(scriptPath)) {
            procOptions.shell = true;
        }

        // 根据实际路径类型选择启动方式：
        // - .cmd/.exe/.bat → 直接 spawn（Windows 可执行/包装脚本）
        // - 兜底 'codebuddy' → 直接 spawn（让 OS 在 PATH 中查找）
        // - 纯脚本文件（无扩展名或 .js）→ spawn via node
        let proc;
        if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
            proc = spawn(scriptPath, cliArgs, procOptions);
        } else {
            const nodeBin = findNodeExecutable() || 'node';
            proc = spawn(nodeBin, [scriptPath, ...cliArgs], procOptions);
        }

        let buffer = '';
        let errOut = '';
        let hasOutput = false;
        const chunkQueue: StreamChunk[] = [];
        let resolveQueue: ((r: IteratorResult<StreamChunk>) => void) | null = null;
        let closed = false;

        proc.stdout.on('data', (d: Buffer) => {
            buffer += d.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const chunk = parseStreamLine(line);
                if (chunk) {
                    hasOutput = true;
                    const preview = typeof chunk.content === 'string' ? chunk.content.substring(0, 80) : JSON.stringify(chunk.content).substring(0, 80);
                    console.log('[BB] chunk:', chunk.type, preview);
                    if (resolveQueue) {
                        resolveQueue({ value: chunk, done: false });
                        resolveQueue = null;
                    } else {
                        chunkQueue.push(chunk);
                    }
                }
            }
        });

        proc.stderr.on('data', (d: Buffer) => {
            errOut += d.toString();
            console.log('[BB] stderr:', errOut);
        });

        proc.on('close', (code, signal) => {
            console.log('[BB] exit:', code, signal ? 'signal:' + signal : '', '| err:', errOut.substring(0, 200));
            closed = true;
            if (resolveQueue) {
                if (errOut && !hasOutput) {
                    resolveQueue({ value: { type: 'error', content: errOut }, done: true });
                } else {
                    resolveQueue({ value: { type: 'done', content: '' }, done: true });
                }
                resolveQueue = null;
            }
        });

        proc.on('error', (e) => {
            console.log('[BB] spawn err:', e.message, '| scriptPath:', scriptPath);
            closed = true;
            if (resolveQueue) {
                let hint = e.message;
                if (e.message.includes('ENOENT')) {
                    if (scriptPath === 'codebuddy') {
                        hint = '找不到 codebuddy CLI。请确认已安装 WorkBuddy 桌面版，或在插件设置中指定 codebuddy 路径。';
                    } else if (!isWindowsWrapper(scriptPath) && !isBareFallback(scriptPath)) {
                        hint = `找不到 Node.js 来运行 codebuddy (路径: ${scriptPath})。请确认已安装 Node.js。`;
                    }
                }
                resolveQueue({ value: { type: 'error', content: hint }, done: true });
                resolveQueue = null;
            }
        });

        // 主循环
        while (true) {
            if (chunkQueue.length > 0) {
                const nextChunk = chunkQueue.shift();
                if (nextChunk) {
                    yield nextChunk;
                    continue;
                }
            }
            if (closed) {
                if (buffer.trim()) {
                    const chunk = parseStreamLine(buffer);
                    if (chunk) yield chunk;
                }
                break;
            }
            const next = await new Promise<IteratorResult<StreamChunk>>((r) => {
                resolveQueue = r;
            });
            if (next.done) {
                if (next.value?.type === 'error') throw new Error(next.value.content);
                break;
            }
            yield next.value;
        }
    }

    cancel(): void {}
}
