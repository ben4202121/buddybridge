// ==================== P2.8 官方技能支持 ====================
//
// 技能调用本身是 CodeBuddy CLI 原生能力（模型自知 available_skills，可自主调用 Skill 工具），
// 插件无需桥接。本模块负责三件辅助事：
//   1. 读取官方市场注册表（~/.codebuddy/plugins/known_marketplaces.json，206 个官方技能）；
//   2. 探测已安装技能（扫描 ~/.codebuddy/plugins/*/skills 与 ~/.codebuddy/skills 的 SKILL.md）；
//   3. 生成「已启用技能」的注入文本（发送时随消息注入，引导模型优先使用）。
//
// 所有 fs 函数允许注入 homeDir 以便单测（jest testEnvironment node）。

import { homedir } from 'os';
import { join } from 'path';
import { readFile, readdir } from 'fs/promises';
import { tF } from './i18n';

export interface OfficialPlugin {
    name: string;
    description: string;
}

export interface InstalledSkill {
    name: string;
    description: string;
}

/** 官方市场注册表路径（本地文件，CodeBuddy 自动更新）。 */
export function officialMarketplacePath(homeDir: string = homedir()): string {
    return join(homeDir, '.codebuddy', 'plugins', 'known_marketplaces.json');
}

/**
 * 读取官方市场注册表，返回全量官方技能列表。
 * 文件缺失/解析失败时抛错（设置页据此给出引导提示）。
 */
export async function readOfficialMarketplace(homeDir: string = homedir()): Promise<OfficialPlugin[]> {
    const filePath = officialMarketplacePath(homeDir);
    let text: string;
    try {
        text = await readFile(filePath, 'utf-8');
    } catch {
        throw new Error(`未找到官方市场注册表（${filePath}），请确认已安装 CodeBuddy/WorkBuddy`);
    }
    let registry: unknown;
    try {
        registry = JSON.parse(text);
    } catch {
        throw new Error('官方市场注册表解析失败（文件可能损坏）');
    }
    if (!isRecord(registry)) return [];
    const market = registry['codebuddy-plugins-official'];
    const manifest = isRecord(market) ? market.manifest : undefined;
    const plugins = isRecord(manifest) && Array.isArray(manifest.plugins) ? manifest.plugins : [];
    const out: OfficialPlugin[] = [];
    for (const p of plugins) {
        if (!isRecord(p) || typeof p.name !== 'string' || p.name.length === 0) continue;
        out.push({
            name: p.name,
            description: typeof p.description === 'string' ? p.description : '',
        });
    }
    return out;
}

/**
 * 探测已安装技能（best-effort，目录不存在则静默跳过）：
 * - ~/.codebuddy/plugins/<插件>/skills/<技能>/SKILL.md（官方插件标准结构）
 * - ~/.codebuddy/plugins/<插件>/SKILL.md（插件自身即技能）
 * - ~/.codebuddy/skills/<技能>/SKILL.md
 * 解析每个 SKILL.md 的 frontmatter（name/description）。
 */
export async function detectInstalledSkills(homeDir: string = homedir()): Promise<InstalledSkill[]> {
    const roots = [
        join(homeDir, '.codebuddy', 'plugins'),
        join(homeDir, '.codebuddy', 'skills'),
    ];
    const seen = new Set<string>();
    const out: InstalledSkill[] = [];

    for (const root of roots) {
        let entries: import('fs').Dirent[] = [];
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // 市场元数据目录不是插件
            if (entry.name === 'marketplaces') continue;
            // 每个目录可能是「插件」（skills/ 子目录）或「技能本体」（SKILL.md）
            await scanSkillCandidates(join(root, entry.name), out, seen);
        }
    }
    return out;
}

/** 递归探测单个目录下的技能：<dir>/SKILL.md 与 <dir>/skills/<技能>/SKILL.md。 */
async function scanSkillCandidates(dir: string, out: InstalledSkill[], seen: Set<string>): Promise<void> {
    const selfSkill = join(dir, 'SKILL.md');
    const skillsDir = join(dir, 'skills');

    const skill = await tryReadSkill(selfSkill);
    if (skill) {
        pushIfNew(out, seen, skill);
    }

    let subDirs: import('fs').Dirent[] = [];
    try {
        subDirs = await readdir(skillsDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const sub of subDirs) {
        if (!sub.isDirectory()) continue;
        const s = await tryReadSkill(join(skillsDir, sub.name, 'SKILL.md'));
        if (s) pushIfNew(out, seen, s);
    }
}

async function tryReadSkill(skillPath: string): Promise<InstalledSkill | null> {
    let md: string;
    try {
        md = await readFile(skillPath, 'utf-8');
    } catch {
        return null;
    }
    const { name, description } = parseSkillMarkdown(md);
    if (!name) return null;
    return { name, description: description ?? '' };
}

function pushIfNew(out: InstalledSkill[], seen: Set<string>, skill: InstalledSkill): void {
    if (seen.has(skill.name)) return;
    seen.add(skill.name);
    out.push(skill);
}

/**
 * 解析 SKILL.md 的 frontmatter（`---` 包裹的 YAML 块），取 name / description。
 * 无 frontmatter 或缺 name 时返回空对象。纯函数，供单测。
 */
export function parseSkillMarkdown(md: string): { name?: string; description?: string } {
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const body = m[1];
    const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = body.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    return { name, description };
}

/**
 * 构建「已启用技能」的注入文本（P2.8）：
 * 每行 `[系统注入·技能: name]`（跟随界面语言），供 buildDedupedPrompt 每轮随消息注入。
 * 无启用技能时返回空串（调用方据此走原逻辑）。
 */
export function buildSkillInjection(enabledSkills: string[]): string {
    if (!enabledSkills || enabledSkills.length === 0) return '';
    return enabledSkills
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => tF('marker.skill', { name: s.trim() }))
        .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
