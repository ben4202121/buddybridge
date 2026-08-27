// ==================== 设置导入/导出（P2.6）====================

import {
    isObject,
    getNumber,
    migrateSettings,
    normalizeConversation,
    DATA_VERSION,
    type Conversation,
    type BuddyBridgeSettings,
} from './types';

/** 导出文件格式标识（防止误导入其他插件的 JSON） */
export const EXPORT_FORMAT = 'buddybridge-export';
/** 导出文件自身格式版本号（未来迁移时递增；不兼容版本拒绝导入） */
export const EXPORT_VERSION = 1;

export interface BuddyBridgeExport {
    format: string;
    exportVersion: number;
    /** 数据 blob 格式版本（与 loadData 的 dataVersion 对应） */
    dataVersion: number;
    exportedAt: number;
    settings: BuddyBridgeSettings;
    conversations: Conversation[];
}

/**
 * 构建导出负载：settings + conversations 同存一份、带版本号。
 * settings 经 migrateSettings 归一化，conversations 逐条归一化。
 */
export function buildExportPayload(
    settings: Partial<BuddyBridgeSettings>,
    conversations: Conversation[],
): BuddyBridgeExport {
    return {
        format: EXPORT_FORMAT,
        exportVersion: EXPORT_VERSION,
        dataVersion: DATA_VERSION,
        exportedAt: Date.now(),
        settings: migrateSettings(settings),
        conversations: (conversations || [])
            .map(c => normalizeConversation(c))
            .filter((c): c is Conversation => c !== null),
    };
}

export function serializeExport(payload: BuddyBridgeExport): string {
    return JSON.stringify(payload, null, 2);
}

/**
 * 校验并规范化导入对象。
 * - 格式标识不符 → 拒绝
 * - exportVersion 不兼容（> 当前版本）→ 拒绝（避免旧插件读新文件导坏数据）
 * - settings 与 conversations 均做归一化
 */
export function validateExport(raw: unknown): BuddyBridgeExport | null {
    if (!isObject(raw)) return null;
    if (raw.format !== EXPORT_FORMAT) return null;
    if (getNumber(raw, 'exportVersion') !== EXPORT_VERSION) return null;
    const dataVersion = getNumber(raw, 'dataVersion');
    if (typeof dataVersion !== 'number' || dataVersion < 1) return null;

    const settings = isObject(raw.settings) ? migrateSettings(raw.settings) : migrateSettings(null);
    const rawConvs = raw.conversations;
    const conversations: Conversation[] = Array.isArray(rawConvs)
        ? rawConvs
            .map(c => normalizeConversation(c))
            .filter((c): c is Conversation => c !== null)
        : [];

    return {
        format: EXPORT_FORMAT,
        exportVersion: EXPORT_VERSION,
        dataVersion,
        exportedAt: getNumber(raw, 'exportedAt') ?? Date.now(),
        settings,
        conversations,
    };
}

/** 解析 JSON 字符串为导出对象；非法 JSON 或结构不合法返回 null。 */
export function parseExport(json: string): BuddyBridgeExport | null {
    try {
        return validateExport(JSON.parse(json));
    } catch {
        return null;
    }
}

// ==================== 桌面端文件交互（Obsidian/Electron）====================
// 以下函数依赖浏览器 DOM / Electron，仅在桌面端调用；node 单测无法覆盖，故整体标记 istanbul ignore。

/* istanbul ignore next */
export function downloadJSONFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // 挂到文档再点击：Electron 下未挂载的锚点点击可能静默失败
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    if (a.parentElement) a.remove();
    URL.revokeObjectURL(url);
}

/**
 * 尝试用 Electron 原生对话框选择并读取 JSON 文件。
 * 原生对话框不受"用户激活"限制，Obsidian 桌面端可用时最可靠。
 * @returns 文件内容字符串；用户取消返回 ''；Electron 不可用/失败返回 null（由调用方回退 DOM 方案）。
 */
/* istanbul ignore next */
function pickJSONViaElectron(): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const w = window as unknown as { require?: (m: string) => any };
            if (typeof w.require !== 'function') {
                resolve(null);
                return;
            }
            const electron = w.require('electron');
            const remote = electron?.remote;
            const dialog = remote?.dialog ?? electron?.dialog;
            if (!dialog) {
                resolve(null);
                return;
            }
            const win = remote?.getCurrentWindow ? remote.getCurrentWindow() : null;
            const opts = { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] };
            const p = win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
            if (!p || typeof p.then !== 'function') {
                resolve(null);
                return;
            }
            p.then(async (result: unknown) => {
                const r = result as { filePaths?: unknown } | null;
                const filePath = Array.isArray(r?.filePaths) && r.filePaths.length > 0 ? r.filePaths[0] : '';
                if (!filePath) {
                    resolve(''); // 用户取消
                    return;
                }
                try {
                    const fs = w.require('fs');
                    const content = await fs.promises.readFile(filePath as string, 'utf-8');
                    resolve(String(content));
                } catch {
                    resolve(null);
                }
            }).catch(() => resolve(null));
        } catch {
            resolve(null);
        }
    });
}

/**
 * 回退方案：DOM file input 选择并读取 JSON。
 * 注意：Chromium 要求 file input 的 click 必须发生在"用户激活"内；
 * 因此本方案必须由同步的原生 click 事件触发（Obsidian 包装的异步 onClick 会丢失激活）。
 * 取消时 resolve 空串。
 */
/* istanbul ignore next */
function pickJSONViaDomInput(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        document.body.appendChild(input);

        let safetyTimer = 0;
        const cleanup = () => {
            if (safetyTimer) window.clearTimeout(safetyTimer);
            if (input.parentElement) input.remove();
        };
        const finish = (value: string) => { cleanup(); resolve(value); };
        const fail = (err: Error) => { cleanup(); reject(err); };

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                finish('');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => finish(String(reader.result ?? ''));
            reader.onerror = () => fail(new Error('读取文件失败'));
            reader.readAsText(file);
        };
        // 用户取消文件选择（Chromium 事件，TS DOM 类型未收录，故用断言）
        (input as HTMLInputElement & { oncancel?: () => void }).oncancel = () => finish('');

        // 兜底：无论弹框失败还是其他原因，不让 Promise 永久挂起
        safetyTimer = window.setTimeout(() => finish(''), 60000);

        input.click();
    });
}

/**
 * 弹出文件选择框并读取选中的 JSON 文本；取消时 resolve 空串。
 * 优先 Electron 原生对话框（无用户激活限制），不可用时回退 DOM file input。
 */
/* istanbul ignore next */
export async function pickAndReadJSONFile(): Promise<string> {
    const viaElectron = await pickJSONViaElectron();
    if (viaElectron !== null) return viaElectron;
    return pickJSONViaDomInput();
}
