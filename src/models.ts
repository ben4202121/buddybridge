// ==================== 模型目录（v2.6.0 模型切换） ====================
//
// CodeBuddy CLI 的 `--model <id>` 是进程级启动参数（print 和 ACP 通用），
// 但本地并无统一的「模型清单 + 积分」接口。模型目录来自 CLI 本地配置
// `~/.codebuddy/local_storage/entry_*.info`：data.models[] 带每个模型的
// name / credits（如 "x0.00 credits" = 免费），data.agents[0].models 是
// 当前 agent 可用的模型 id 列表。
//
// 本模块只做「读配置 → 模型目录（含免费标注）」，纯 UI 辅助数据，不参与 spawn。
// 读取失败回退静态内置 15 个模型 id（无免费标注——"暂时免费"会变，硬编码会过时）。

import { homedir } from 'os';
import { join } from 'path';
import { readFile, readdir } from 'fs/promises';

export interface ModelInfo {
    id: string;
    name: string;
    /** 免费（credits 为 x0.00；静态回退时一律 false，不硬编码） */
    free: boolean;
}

/** 静态回退模型清单（与 CLI help `--model` 内嵌列表一致，2026-09 实测）。 */
export const STATIC_MODEL_IDS: string[] = [
    'hy4-preview', 'hy3', 'hy3-x', 'glm-5.3', 'glm-5.3-flash', 'glm-5.2',
    'glm-5.1', 'glm-5v-turbo', 'minimax-m3', 'minimax-m2.7', 'kimi-k3-1',
    'kimi-k2.7', 'kimi-k2.6', 'deepseek-v4-pro', 'deepseek-v4-flash',
];

/** CLI 本地配置目录名（entry_<hash>.info 文件在此）。 */
export function localStorageDir(homeDir: string = homedir()): string {
    return join(homeDir, '.codebuddy', 'local_storage');
}

/**
 * 读取 CLI 本地配置，返回当前 agent 可用模型目录（含免费标注）。
 * 文件缺失 / 解析失败 / 结构不符 → 回退静态内置清单（无免费标注）。
 */
export async function getModelCatalog(homeDir: string = homedir()): Promise<ModelInfo[]> {
    try {
        const dir = localStorageDir(homeDir);
        const entries = await readdir(dir, { withFileTypes: true });
        // 文件名排序保证确定性：多账号（多个 entry_*.info）时优先取字典序最小的，
        // 避免不同次打开设置页因 readdir 顺序不同而展示不同模型集。
        const files = entries
            .filter((e) => e.isFile() && e.name.startsWith('entry_') && e.name.endsWith('.info'))
            .map((e) => e.name)
            .sort();
        for (const name of files) {
            const catalog = await parseCatalogFile(join(dir, name));
            if (catalog) return catalog;
        }
    } catch {
        // 目录不存在 / 无权限等 → 回退
    }
    return staticCatalog();
}

/**
 * 解析单个 entry_*.info 文件。结构不符返回 null（调用方继续扫下一个文件）。
 * 顶层是数组：`[{ userId, data: { agents: [{ name, models: string[] }], models: [{ id, name, credits }] } }]`
 */
async function parseCatalogFile(filePath: string): Promise<ModelInfo[] | null> {
    let raw: unknown;
    try {
        const text = await readFile(filePath, 'utf-8');
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (!Array.isArray(raw) || raw.length === 0 || !isRecord(raw[0])) return null;

    const data = raw[0]['data'];
    if (!isRecord(data)) return null;

    // agent 可用模型 id（取第一个带 models 数组的 agent）
    const agents = data['agents'];
    let agentIds: string[] = [];
    if (Array.isArray(agents)) {
        for (const a of agents) {
            if (isRecord(a) && Array.isArray(a['models']) && a['models'].length > 0) {
                agentIds = a['models'].filter((m): m is string => typeof m === 'string');
                break;
            }
        }
    }
    if (agentIds.length === 0) return null;

    // 模型元数据：id → { name, credits }
    const meta = new Map<string, { name?: string; credits?: string }>();
    const models = data['models'];
    if (Array.isArray(models)) {
        for (const m of models) {
            if (!isRecord(m) || typeof m['id'] !== 'string') continue;
            meta.set(m['id'], {
                name: typeof m['name'] === 'string' ? m['name'] : undefined,
                credits: typeof m['credits'] === 'string' ? m['credits'] : undefined,
            });
        }
    }

    const out: ModelInfo[] = agentIds.map((id) => {
        const info = meta.get(id);
        const free = parseCredits(info?.credits) === 0;
        return { id, name: info?.name || id, free };
    });
    return out.length > 0 ? out : null;
}

/**
 * 解析 credits 字符串（如 "x0.00 credits"）为数值。
 * 无法解析 / 缺失 → undefined（区别于免费 0）。
 */
export function parseCredits(credits: string | undefined): number | undefined {
    if (!credits) return undefined;
    const m = /([\d.]+)/.exec(credits);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * 由模型 id + 目录计算显示用名称（v2.6.0 会话界面模型指示器）。
 * id 未命中目录时回退 id 本身；纯 UI 辅助，不参与 spawn。
 */
export function modelDisplayName(model: string, catalog: ModelInfo[]): { name: string; free: boolean } {
    const info = catalog.find((m) => m.id === model);
    return info ? { name: info.name || info.id, free: info.free } : { name: model, free: false };
}

function staticCatalog(): ModelInfo[] {
    return STATIC_MODEL_IDS.map((id) => ({ id, name: id, free: false }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
