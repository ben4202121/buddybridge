import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const TIMEOUT = 120_000;

function resolveCodebuddyPath(): string {
    // 1. 显式环境变量优先
    if (process.env.CODEBUDDY_PATH) {
        return process.env.CODEBUDDY_PATH;
    }

    // 2. Windows 默认安装路径
    const localAppData = process.env.LOCALAPPDATA || '';
    const defaultPath = path.join(
        localAppData,
        'Programs',
        'WorkBuddy',
        'resources',
        'app.asar.unpacked',
        'cli',
        'bin',
        'codebuddy'
    );
    if (fs.existsSync(defaultPath)) {
        return defaultPath;
    }

    // 3. 兜底：寄希望于系统 PATH
    return 'codebuddy';
}

const CODEBUDDY = resolveCodebuddyPath();

export class BuddyBridgeAPI {
    private rid = 1;
    private url: string;
    private timeout: number;

    constructor(url: string, timeout: number = TIMEOUT) {
        this.url = url;
        this.timeout = timeout;
    }

    setGatewayUrl(u: string): void {
        this.url = u;
    }

    generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r: number = (Math.random() * 16) | 0;
            const v: number = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    async *sendMessage(_sessionId: string, text: string): AsyncGenerator<string> {
        const scriptPath = CODEBUDDY;
        let resolveNext: ((r: IteratorResult<string>) => void) | null = null;
        let done = false;

        // Windows 上 spawn 无法解析 shebang，必须通过 node 执行脚本
        const proc = spawn('node', [scriptPath, text], {
            timeout: this.timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

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

        proc.on('close', (code) => {
            console.log('[BB] exit:', code, '| err:', errOut.substring(0, 200));
            done = true;
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
