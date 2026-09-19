// ==================== P3 LLM Wiki 内置技能 ====================
//
// 把 workbuddy/llm-wiki-skill-prompt.txt 的规则固化为「插件内置技能」：
// 用户开启后，规则全文随消息注入（复用 buildDedupedPrompt 的 skillHint 通道），
// 让模型在 Vault 上执行 /wiki-init /wiki-ingest /wiki-query /wiki-lint。
// 与 P2.8 的区别：P2.8 只注入技能「名字」（官方技能全文由 CLI 的 Skill 工具读）；
// LLM Wiki 非官方技能，规则全文由插件持有，故注入完整规则文本。
//
// 纯函数 + 常量，供 jest 单测。

import { tF } from './i18n';

/** LLM Wiki 技能名（设置页 / 注入标记复用）。 */
export const LLM_WIKI_SKILL_NAME = 'llm-wiki';

/** 授权时需要写入 CLI 的权限项（对应 llm-wiki-auth-prompt.txt）。 */
export const LLM_WIKI_PERMISSIONS = ['Write', 'Edit', 'Glob', 'Grep', 'Read', 'Bash'] as const;

/**
 * LLM Wiki 规则全文（内置常量）。
 * 规则内 `{vault}` 是占位符，注入时替换为实际 Vault 绝对路径（正斜杠）。
 */
export const LLM_WIKI_SKILL_PROMPT = [
    '你现在是 LLM Wiki 知识库管理系统，工作在 Obsidian Vault：{vault}',
    '',
    '## 命令',
    '',
    '/wiki-init — 初始化。在 Vault 根下创建目录结构并写入初始文件：',
    '- raw/01-articles、raw/02-papers、raw/03-transcripts、raw/09-archive',
    '- wiki/concepts、wiki/entities、wiki/sources、wiki/syntheses',
    '- assets/',
    '- wiki/index.md（「## 概念 / 实体 / 来源 / 综合」四个分类，各注「（待摄入）」）',
    '- wiki/log.md（记录本次 init）',
    '完成后回复目录清单与下一步引导。',
    '',
    '/wiki-ingest [路径] — 摄入原始资料。未指定路径则扫描 raw/ 下全部 .md（raw/09-archive/ 视为已处理，跳过）。对每个待处理文件：',
    '1. Read 读取 raw 源文件，绝不修改 raw/ 下任何文件内容。',
    '2. 分析后产出 wiki 页面：新概念/方法论 → wiki/concepts/，工具/产品/服务 → wiki/entities/，每个源文件至少产出一个 wiki/sources/ 摘要页，跨文件综合理解 → wiki/syntheses/。',
    '3. 每页必须含 frontmatter：title、type（concept/entity/source/synthesis）、tags、sources（[[wikilink]]）、last_updated；正文简体中文；必须含「## 关联」段落，至少一个 [[wikilink]]。',
    '4. 更新 wiki/index.md 登记新页面。',
    '5. 追加 wiki/log.md（记录变更与归档）。',
    '6. 将已处理源文件移入 raw/09-archive/。',
    '铁律：不改 raw 内容、每页有入链出链（无孤岛）、与新页面矛盾时在已有页面追加「## 知识冲突」区块而不覆盖原文。',
    '',
    '/wiki-query <问题> — 用知识库回答。先读 wiki/index.md 定位，再深读候选页面，综合回答且每个事实断言后标注出处 [[页面名]]，追加 wiki/log.md；若产生新综合理解则写入 wiki/syntheses/（带 wikilink）。',
    '',
    '/wiki-lint — 健康检查。扫描 wiki/ 下 .md（排除 index.md 与 log.md），检查：索引登记、wikilink 有效性、frontmatter 完整（title+type）、孤岛（入链 0）、半孤岛（出链 0）、未解决冲突（含「## 知识冲突」）、sources 有效性。输出问题清单并追加 wiki/log.md。',
    '',
    '## 命名规范',
    'concepts/ 用 TitleCase（空格用 _）；entities/ 保留原文大小写；sources/ 用 kebab-case 前缀 summary-；syntheses/ 用 kebab-case。正文一律简体中文。',
    '',
    '## 禁止事项',
    '禁止修改 raw/ 下任何文件；禁止跳过 index.md 更新；禁止跳过 log.md 记录；禁止覆盖已有知识（矛盾时追加「知识冲突」区块）。',
].join('\n');

/**
 * 构建 LLM Wiki 注入文本：
 * - 未启用 → 返回空串（调用方据此跳过）；
 * - 启用 → `[系统注入·LLM Wiki]` 标记 + 规则全文（{vault} 替换为实际路径）。
 */
export function buildLlmWikiInjection(enabled: boolean, vaultPath?: string): string {
    if (!enabled) return '';
    const vault = vaultPath ? vaultPath.replace(/\\/g, '/') : '';
    const body = vault
        ? LLM_WIKI_SKILL_PROMPT.split('{vault}').join(vault)
        : LLM_WIKI_SKILL_PROMPT;
    return `${tF('marker.llmWiki')}\n\n${body}`;
}