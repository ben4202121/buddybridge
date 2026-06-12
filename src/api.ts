import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const TIMEOUT = 300_000; // 5 分钟，复杂知识库问题可能需要较长时间

// ===== Node.js 可执行文件查找 =====

const NODE_EXECUTABLE = process.platform === 'win32' ? 'node.exe' : 'node';

function findNodeExecutable(): string | null {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const nodeDirs: string[] = [];

    if (process.platform === 'win32') {
        // Electron 进程同级目录（Obsidian 便携版可能有 node）
        nodeDirs.push(path.dirname(process.execPath));

        // npm 全局安装路径
        const appData = process.env.APPDATA || '';
        if (appData) {
            nodeDirs.push(appData);
            nodeDirs.push(path.join(appData, 'npm'));
        }

        // Node.js 安装路径
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

        // NVM for Windows
        const nvmSymlink = process.env.NVM_SYMLINK;
        if (nvmSymlink) {
            nodeDirs.push(nvmSymlink);
        }
    } else {
        nodeDirs.push(
            path.join(home, '.local', 'bin'),
            path.join(home, '.npm-global', 'bin'),
            path.join(home, '.volta', 'bin'),
            '/usr/local/bin',
            '/opt/homebrew/bin',
        );

        // NVM
        const nvmBin = process.env.NVM_BIN;
        if (nvmBin) {
            nodeDirs.push(nvmBin);
        }
    }

    // 扫描候选目录
    for (const dir of nodeDirs) {
        if (!dir) continue;
        try {
            const nodePath = path.join(dir, NODE_EXECUTABLE);
            if (fs.existsSync(nodePath) && fs.statSync(nodePath).isFile()) {
                console.log('[BB] found node at:', nodePath);
                return nodePath;
            }
        } catch {
            // 目录不可访问
        }
    }

    // 兜底: 系统 PATH
    return 'node';
}

// ===== CodeBuddy CLI 路径查找 =====

function resolveCodebuddyPath(customPath: string): string {
    // 1. 用户在设置中指定的路径
    if (customPath && fs.existsSync(customPath)) {
        return customPath;
    }

    // 2. 环境变量
    if (process.env.CODEBUDDY_PATH && fs.existsSync(process.env.CODEBUDDY_PATH)) {
        return process.env.CODEBUDDY_PATH;
    }

    // 3. 按平台搜索常见路径
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const candidates: string[] = [];

    if (process.platform === 'win32') {
        // WorkBuddy 安装路径
        candidates.push(
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
        );
        // npm 全局安装 (Windows)
        if (appData) {
            candidates.push(path.join(appData, 'npm', 'codebuddy'));
            candidates.push(path.join(appData, 'npm', 'codebuddy.cmd'));
        }
        candidates.push(
            path.join(programFiles, 'nodejs', 'codebuddy.cmd'),
            path.join(programFiles, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
            path.join(programFilesX86, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
        );
    } else {
        // macOS / Linux
        candidates.push(
            path.join(home, '.local', 'bin', 'codebuddy'),
            path.join(home, '.npm-global', 'bin', 'codebuddy'),
            path.join(home, '.volta', 'bin', 'codebuddy'),
            path.join(home, 'bin', 'codebuddy'),
            '/usr/local/bin/codebuddy',
            '/opt/homebrew/bin/codebuddy',
        );
    }

    // 跨平台: NVM / npm prefix
    const nvmBin = process.env.NVM_BIN;
    if (nvmBin) {
        candidates.push(path.join(nvmBin, 'codebuddy'));
    }
    const npmPrefix = process.env.npm_config_prefix;
    if (npmPrefix) {
        candidates.push(path.join(npmPrefix, 'bin', 'codebuddy'));
    }

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    // 4. 兜底: 系统 PATH
    return 'codebuddy';
}

export class BuddyBridgeAPI {
    private rid = 1;
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

    async *sendMessage(sessionId: string, text: string, vaultPath?: string): AsyncGenerator<string> {
        const scriptPath = this.scriptPath;
        let resolveNext: ((r: IteratorResult<string>) => void) | null = null;
        let done = false;

        // 查找真正的 Node.js 可执行文件（Electron 里 process.execPath 不是 node）
        const nodeBin = findNodeExecutable() || 'node';
        const procOptions: any = {
            timeout: this.timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
        };
        if (vaultPath) {
            procOptions.cwd = vaultPath;
        }

        // 会话管理: 始终指定 session-id 保持上下文连贯
        const args = [scriptPath, '--session-id', sessionId, text];
        const proc = spawn(nodeBin, args, procOptions);

        let out = '';
        let errOut = '';

        proc.stdout.on('data', (d: Buffer) => {
            const s = d.toString();
            out += s;
            console.log('[BB] stdout:', s);
            if (resolveNext) {
                resolveNext({ value: s, done: false });
                resolveNext = null;
            }
        });

        proc.stderr.on('data', (d: Buffer) => {
            errOut += d.toString();
            console.log('[BB] stderr:', errOut);
        });

        proc.on('close', (code, signal) => {
            console.log('[BB] exit:', code, signal ? 'signal:' + signal : '', '| err:', errOut.substring(0, 200));
            done = true;
            // 被信号杀死（如超时）— 记录错误
            if (signal && !errOut) {
                errOut = code === null ? '进程被终止，可能超时或内存不足' : `进程异常退出 (signal: ${signal})`;
            }
            if (errOut && !out) {
                const next = resolveNext;
                if (next) {
                    next({ value: undefined as unknown as string, done: true });
                    resolveNext = null;
                }
            } else if (resolveNext) {
                resolveNext({ value: out, done: true });
                resolveNext = null;
            }
        });

        proc.on('error', (e) => {
            console.log('[BB] spawn err:', e.message);
            done = true;
            if (resolveNext) {
                resolveNext({ value: undefined as unknown as string, done: true });
                resolveNext = null;
            }
        });

        while (true) {
            if (done) {
                if (errOut && !out) {
                    throw new Error(errOut);
                }
                if (out) {
                    yield out;
                    break;
                }
                break;
            }
            const next = await new Promise<IteratorResult<string>>((r) => {
                resolveNext = r;
            });
            if (next.done) break;
            yield next.value;
        }
    }

    cancel(): void {
        // 预留取消逻辑
    }
}
