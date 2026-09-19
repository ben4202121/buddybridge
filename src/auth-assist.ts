// ==================== P3 LLM Wiki 授权辅助 ====================
//
// 对应 workbuddy/llm-wiki-auth-prompt.txt 的一次性授权，产品化为「一键授权」：
// 把 Vault 路径写入 CodeBuddy 全局配置 ~/.codebuddy/settings.json 的
// trustedDirectories + permissions.allow，让模型（ACP 常驻进程）有权限读/写 Vault。
//
// 设计要点（不可变 + 幂等）：
// - 只「打补丁」，绝不覆盖用户已有配置（保留 trustedDirectories 已有项、allow 已有项、其余字段）；
// - 已授权时返回 null（无需改动），调用方据此提示「已授权」；
// - Windows 路径规范化成正斜杠（CLI 配置约定）。
// 所有 fs 函数允许注入 homeDir 以便 jest 单测。

import { homedir } from 'os';
import { join } from 'path';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { LLM_WIKI_PERMISSIONS } from './llm-wiki';

/** CLI 全局配置文件路径（~/.codebuddy/settings.json）。 */
export function cliSettingsPath(homeDir: string = homedir()): string {
    return join(homeDir, '.codebuddy', 'settings.json');
}

/** Windows 路径规范化为正斜杠（CLI 配置约定）。 */
export function normalizeVaultPath(vaultPath: string): string {
    return vaultPath.replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** 取 settings 中的 trustedDirectories（规范化后的字符串数组，缺失回退 []）。 */
function trustedDirs(settings: Record<string, unknown>): string[] {
    return stringArray(settings['trustedDirectories']).map(normalizeVaultPath);
}

/** 取 settings 中的 permissions.allow（字符串数组，缺失回退 []）。 */
function allowedPerms(settings: Record<string, unknown>): string[] {
    const permissions = settings['permissions'];
    if (!isRecord(permissions)) return [];
    return stringArray(permissions['allow']);
}

/** Vault 是否已完全授权（已信任 + 权限齐全）。 */
export function isVaultAuthorized(settings: unknown, vaultPath: string): boolean {
    if (!isRecord(settings)) return false;
    const vault = normalizeVaultPath(vaultPath);
    const dirs = new Set(trustedDirs(settings));
    const allow = new Set(allowedPerms(settings));
    if (!dirs.has(vault)) return false;
    return LLM_WIKI_PERMISSIONS.every((p) => allow.has(p));
}

/**
 * 生成打补丁后的 settings（不可变，返回新对象；原对象不改动）。
 * - settings 非对象（配置文件不存在）→ 返回新建完整结构；
 * - 已完全授权 → 返回 null（无需改动）。
 */
export function buildAuthorizedSettings(
    settings: unknown,
    vaultPath: string,
): Record<string, unknown> | null {
    const vault = normalizeVaultPath(vaultPath);

    // 文件不存在 → 新建
    if (!isRecord(settings)) {
        return {
            trustedDirectories: [vault],
            permissions: { allow: [...LLM_WIKI_PERMISSIONS] },
        };
    }

    const dirs = trustedDirs(settings);
    const allow = allowedPerms(settings);
    const needDirs = !dirs.includes(vault);
    const missingPerms = LLM_WIKI_PERMISSIONS.filter((p) => !allow.includes(p));

    // 已完全授权 → 无需改动
    if (!needDirs && missingPerms.length === 0) return null;

    const nextDirs = needDirs ? [...dirs, vault] : dirs;
    const nextAllow = missingPerms.length > 0 ? [...allow, ...missingPerms] : allow;
    const permissions = isRecord(settings['permissions']) ? settings['permissions'] : {};
    return {
        ...settings,
        trustedDirectories: nextDirs,
        permissions: { ...permissions, allow: nextAllow },
    };
}

/** 授权结果（供 UI 提示 + 单测断言）。 */
export interface AuthApplyResult {
    /** already：已授权未改动；added：补打补丁写回；created：新建配置文件 */
    status: 'already' | 'added' | 'created';
    path: string;
}

/**
 * 应用授权补丁：读 → 补 → 写 ~/.codebuddy/settings.json（不存在则建目录+文件）。
 * 幂等：已授权时直接返回 already，不改写文件。
 */
/** 读取 ~/.codebuddy/settings.json（文件不存在/为空/解析失败 → null）。 */
export async function readCliSettings(homeDir: string = homedir()): Promise<unknown> {
    let raw: string;
    try {
        raw = await readFile(cliSettingsPath(homeDir), 'utf-8');
    } catch {
        return null;
    }
    if (!raw.trim()) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function applyVaultAuth(
    vaultPath: string,
    homeDir: string = homedir(),
): Promise<AuthApplyResult> {
    const path = cliSettingsPath(homeDir);
    const settings = await readCliSettings(homeDir);
    const existed = isRecord(settings);
    const patched = buildAuthorizedSettings(settings, vaultPath);
    if (patched === null) {
        return { status: 'already', path };
    }

    await mkdir(join(homeDir, '.codebuddy'), { recursive: true });
    await writeFile(path, JSON.stringify(patched, null, 2) + '\n', 'utf-8');
    return { status: existed ? 'added' : 'created', path };
}