import { spawn, type SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getErrorMessage, getNumber, getString, isObject } from './types';

const TIMEOUT = 300_000; // 5 分钟

// ===== 流式事件类型 =====

export interface UsageInfo {
    inputTokens: number;
    outputTokens: number;
}

export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    /** 该轮 token 用量（来自 assistant 信封 message.usage，P2.5 上下文用量显示） */
    usage?: UsageInfo;
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
    if (customPath) {
        // 用户显式配置的路径优先；即使不存在也按原样返回，
        // 让 spawn 产出明确的 ENOENT 错误卡（而不是静默回退自动检测）。
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

/**
 * 从 assistant/user 信封的 message.usage 提取 token 用量（P2.5 上下文用量显示）。
 * 流式输出中 assistant 的 text 事件带 message.usage（input_tokens/output_tokens），
 * 解析不到或全空时返回 undefined，UI 层按 inputTokens>0 过滤展示。
 */
export function extractUsage(raw: unknown): UsageInfo | undefined {
    if (!isObject(raw)) return undefined;
    const message = isObject(raw.message) ? raw.message : null;
    const usage = isObject(message?.usage) ? message.usage : null;
    if (!usage) return undefined;
    const input = getNumber(usage, 'input_tokens');
    const output = getNumber(usage, 'output_tokens');
    if (input === undefined && output === undefined) return undefined;
    return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** 用量占比状态：<80% 正常，≥80% 预警，≥100% 溢出（P2.5 用量条分级）。 */
export type UsageLevel = 'normal' | 'warn' | 'critical';

/**
 * 计算 token 用量占上下文窗口的百分比（P2.5）。窗口非法（≤0）视为 0%，结果钳制在 [0,100]。
 */
export function usagePercent(inputTokens: number, windowSize: number): number {
    if (windowSize <= 0) return 0;
    return Math.min(100, Math.max(0, (inputTokens / windowSize) * 100));
}

/** 按百分比分级：≥100% 溢出，≥80% 预警，否则正常。 */
export function usageLevel(pct: number): UsageLevel {
    if (pct >= 100) return 'critical';
    if (pct >= 80) return 'warn';
    return 'normal';
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
            const usage = extractUsage(raw);
            const message = isObject(raw.message) ? raw.message : null;
            const content = Array.isArray(message?.content) ? message.content : [];
            for (const item of content) {
                const block = parseMessageBlock(item);
                if (block) {
                    const chunk = blockToChunk(block);
                    if (chunk) {
                        if (usage) chunk.usage = usage;
                        return chunk;
                    }
                }
            }
            return usage ? { type: 'text', content: '', usage } : null;
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

/**
 * 判断文本块是否为 CLI 启动横幅行（用于真实回复出现前的启动噪音过滤）。
 * 采用「整行开头匹配」，避免把正文里出现的关键词（如"工作目录""已确认"）误吞。
 */
export function isStartupBanner(text: string): boolean {
    return /^(Working directory|file operation|file rules|Standing by|Awaiting|Confirmed|Vault path|待命中|文件操作|已锁定|已确认|工作目录)/i.test(text.trim());
}

export function isBareFallback(scriptPath: string): boolean {
    // 兜底值 'codebuddy' 不是真实文件路径，让 OS 在 PATH 里找
    // 同时认 posix(/x/y) 与 win32(C:\x\y) 绝对路径：CLI 桥接目标是 Windows，
    // 即使宿主在非 Windows 上也可能收到 C:\ 风格路径，应视为绝对路径而非裸命令。
    return scriptPath === 'codebuddy' || !(path.posix.isAbsolute(scriptPath) || path.win32.isAbsolute(scriptPath));
}

export function needsWindowsShell(scriptPath: string): boolean {
    return process.platform === 'win32' && (scriptPath.endsWith('.cmd') || scriptPath.endsWith('.bat'));
}

/**
 * 对进入 cmd.exe 的单个命令行参数做转义（P0.2 shell 安全）。
 * 仅在 .cmd/.bat 分支（shell:true）使用；.exe 分支 shell:false，零 shell 风险，不经过此函数。
 *
 * 策略：
 * 1. 参数整体用双引号包裹，使空格、中文、换行成为单个参数；
 * 2. 对 cmd.exe 会解释的特殊字符在前面加 `^` 转义，双引号内这些字符按字面处理。
 *
 * 特殊字符集合（与开发计划一致，另含 cmd 括号/百分号以稳妥）：
 * `& | > < ^ " ( ) % !`
 */
export function escapeCmdArg(text: string): string {
    if (text === '') return '""';
    const escaped = text.replace(/([&|><^"()%!])/g, '^$1');
    return `"${escaped}"`;
}

export class BuddyBridgeAPI {
    private timeout: number;
    private scriptPath: string;
    private nodePath = '';
    /**
     * 在途流式请求的取消句柄表：sessionId → cancel 回调。
     * 传输层按会话并发：每个会话的流式各占一个独立进程（每条消息一个 spawn），
     * 取消按会话定向（cancel(sessionId)），不互相踩踏。
     */
    private activeStreams = new Map<string, () => void>();

    constructor(timeout: number = TIMEOUT) {
        this.timeout = timeout;
        this.scriptPath = resolveCodebuddyPath('');
    }

    setCodebuddyPath(p: string): void {
        this.scriptPath = resolveCodebuddyPath(p);
    }

    /** 手动指定 Node.js 路径（设置项 nodePath）；留空则自动检测。 */
    setNodePath(p: string): void {
        this.nodePath = p || '';
    }

    getNodePath(): string {
        return this.nodePath;
    }

    /** 设置请求超时时长（毫秒）。由设置页 timeoutSeconds 驱动（默认 300s）。 */
    setTimeoutMs(ms: number): void {
        if (typeof ms === 'number' && ms > 0) {
            this.timeout = ms;
        }
    }

    getTimeoutMs(): number {
        return this.timeout;
    }

    generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r: number = (Math.random() * 16) | 0;
            const v: number = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    async *sendMessage(sessionId: string, text: string, vaultPath?: string): AsyncGenerator<StreamChunk> {
        // 并发支持：取消标志 / 唤醒器 / 进程句柄改为每次调用的局部变量（不再共享实例字段），
        // 每个会话的流式各占一个独立进程，互不踩踏；取消经 activeStreams 按 sessionId 定向。
        let cancelled = false;
        let pendingResolve: ((r: IteratorResult<StreamChunk>) => void) | null = null;
        let currentProc: ReturnType<typeof spawn> | null = null;
        const scriptPath = this.scriptPath;
        const procOptions: SpawnOptions = {
            // 不再使用 spawn 的 timeout（P0.3）：改为插件侧计时，超时产出明确错误卡
            stdio: ['ignore', 'pipe', 'pipe'],
        };
        if (vaultPath) {
            procOptions.cwd = vaultPath;
        }

        // --print --output-format stream-json: 结构化流式输出
        let cliArgs = ['--print', '--output-format', 'stream-json', '--session-id', sessionId, text];

        // Node 18+ Windows 下 spawn .cmd/.bat 需要 shell: true
        if (needsWindowsShell(scriptPath)) {
            procOptions.shell = true;
            // P0.2 shell 安全：进入 cmd.exe 的用户输入必须转义，防止 & | > < ^ " 被解释为命令
            // 其余参数（--print 等）为插件常量，无需转义
            cliArgs = [...cliArgs.slice(0, -1), escapeCmdArg(text)];
        }

        // 根据实际路径类型选择启动方式：
        // - .cmd/.exe/.bat → 直接 spawn（Windows 可执行/包装脚本）
        // - 兜底 'codebuddy' → 直接 spawn（让 OS 在 PATH 中查找）
        // - 纯脚本文件（无扩展名或 .js）→ spawn via node
        let proc: ReturnType<typeof spawn>;
        if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
            proc = spawn(scriptPath, cliArgs, procOptions);
        } else {
            // 裸脚本启动：手动指定 nodePath 优先，其次自动检测
            const nodeBin = this.nodePath || findNodeExecutable() || 'node';
            proc = spawn(nodeBin, [scriptPath, ...cliArgs], procOptions);
        }
        currentProc = proc;

        // 注册取消句柄：cancel(sessionId) 按会话定向终止本流；生成器结束（finally）即注销。
        const cancelHandler = () => {
            cancelled = true;
            // 唤醒挂起的主循环等待，让生成器立即结束（不等进程真正退出）
            if (pendingResolve) {
                pendingResolve({ value: { type: 'done', content: '' }, done: true });
                pendingResolve = null;
            }
            if (currentProc) {
                try {
                    if (process.platform === 'win32' && currentProc.pid) {
                        // Windows 上 kill() 对 .cmd/.exe wrapper 常杀不干净（子树仍持有 stdout 管道）
                        spawn('taskkill', ['/pid', String(currentProc.pid), '/T', '/F']);
                    } else {
                        currentProc.kill();
                    }
                    console.log('[BB] 已终止 CLI 进程');
                } catch (e) {
                    console.error('[BB] 终止进程失败:', e);
                }
                currentProc = null;
            }
        };
        this.activeStreams.set(sessionId, cancelHandler);

        try {
            // P0.3 插件侧计时：超时主动产出明确错误卡（不再依赖 spawn 的静默 timeout kill）
            let timedOut = false;
            const timeoutSeconds = Math.max(1, Math.round(this.timeout / 1000));
            const timer = setTimeout(() => {
                if (closed) return;
                timedOut = true;
                try { proc.kill(); } catch { /* ignore */ }
                const errChunk: StreamChunk = {
                    type: 'error',
                    content: `请求超时（已等待 ${timeoutSeconds} 秒），请检查 CodeBuddy CLI 是否正常运行或尝试重试`,
                };
                if (pendingResolve) {
                    pendingResolve({ value: errChunk, done: false });
                    pendingResolve = null;
                } else {
                    chunkQueue.push(errChunk);
                }
            }, this.timeout);
            timer.unref?.();

            let buffer = '';
            let errOut = '';
            let hasOutput = false;
            const chunkQueue: StreamChunk[] = [];
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
                        if (pendingResolve) {
                            pendingResolve({ value: chunk, done: false });
                            pendingResolve = null;
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
                currentProc = null;
                clearTimeout(timer);
                closed = true;
                if (pendingResolve) {
                    // P0.5 退出码与错误分类（三档场景）：
                    // - 非零退出码 + stdout 有内容 → 正常收尾（stderr 仅记录日志）
                    // - 非零退出码 + stdout 为空 → 致命错误卡
                    // - 零退出码（可能仅有良性 stderr 警告）→ 正常结束
                    let result: IteratorResult<StreamChunk>;
                    if (hasOutput) {
                        result = { value: { type: 'done', content: '' }, done: true };
                    } else if (code !== 0) {
                        const detail = errOut.trim()
                            || `进程异常退出（退出码 ${code}${signal ? `, 信号 ${signal}` : ''}），请检查 CodeBuddy CLI 是否正常运行`;
                        result = { value: { type: 'error', content: detail }, done: true };
                    } else {
                        result = { value: { type: 'done', content: '' }, done: true };
                    }
                    pendingResolve(result);
                    pendingResolve = null;
                }
            });

            proc.on('error', (e) => {
                console.log('[BB] spawn err:', e.message, '| scriptPath:', scriptPath);
                clearTimeout(timer);
                closed = true;
                if (pendingResolve) {
                    let hint = e.message;
                    if (e.message.includes('ENOENT')) {
                        if (scriptPath === 'codebuddy') {
                            hint = '找不到 codebuddy CLI。请确认已安装 WorkBuddy 桌面版，或在插件设置中指定 codebuddy 路径。';
                        } else if (!isWindowsWrapper(scriptPath) && !isBareFallback(scriptPath)) {
                            hint = `找不到 Node.js 来运行 codebuddy (路径: ${scriptPath})。请确认已安装 Node.js。`;
                        }
                    }
                    pendingResolve({ value: { type: 'error', content: hint }, done: true });
                    pendingResolve = null;
                }
            });

            // 主循环
            while (true) {
                // 停止即时生效：cancel() 唤醒等待后这里立刻退出（不等进程真正结束）
                if (cancelled) break;
                if (chunkQueue.length > 0) {
                    const nextChunk = chunkQueue.shift();
                    if (nextChunk) {
                        yield nextChunk;
                        continue;
                    }
                }
                // P0.3：超时错误卡已产出（或已入队），退出流式
                if (timedOut) {
                    clearTimeout(timer);
                    break;
                }
                if (closed) {
                    if (buffer.trim()) {
                        const chunk = parseStreamLine(buffer);
                        if (chunk) yield chunk;
                    }
                    break;
                }
                const next = await new Promise<IteratorResult<StreamChunk>>((r) => {
                    pendingResolve = r;
                });
                if (next.done) {
                    if (next.value?.type === 'error') throw new Error(next.value.content);
                    break;
                }
                yield next.value;
            }
            clearTimeout(timer);
        } finally {
            this.activeStreams.delete(sessionId);
        }
    }

    /** 取消流式请求：传入 sessionId 只取消该会话的流；不传则取消全部在途流（兼容旧调用）。 */
    cancel(sessionId?: string): void {
        if (sessionId) {
            const handler = this.activeStreams.get(sessionId);
            if (handler) handler();
            return;
        }
        for (const handler of [...this.activeStreams.values()]) {
            handler();
        }
        this.activeStreams.clear();
    }
}
