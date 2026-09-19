import { LLM_WIKI_SKILL_PROMPT, LLM_WIKI_SKILL_NAME, buildLlmWikiInjection } from '../src/llm-wiki';

// 固定测试语言为中文（同 skills.test.ts：node 测试环境无 localStorage，i18n 默认回落英文）
(global as any).localStorage = { getItem: (key: string) => (key === 'language' ? 'zh-CN' : null) };

describe('LLM_WIKI_SKILL_NAME', () => {
    it('技能名为 llm-wiki', () => {
        expect(LLM_WIKI_SKILL_NAME).toBe('llm-wiki');
    });
});

describe('LLM_WIKI_SKILL_PROMPT (P3 规则全文)', () => {
    it('含四个命令 /wiki-init /wiki-ingest /wiki-query /wiki-lint', () => {
        for (const cmd of ['/wiki-init', '/wiki-ingest', '/wiki-query', '/wiki-lint']) {
            expect(LLM_WIKI_SKILL_PROMPT).toContain(cmd);
        }
    });

    it('含 {vault} 占位符供注入替换', () => {
        expect(LLM_WIKI_SKILL_PROMPT).toContain('{vault}');
    });

    it('含 file 铁律与禁止事项（不覆盖已入库知识 / 不改 raw）', () => {
        expect(LLM_WIKI_SKILL_PROMPT).toContain('知识冲突');
        expect(LLM_WIKI_SKILL_PROMPT).toContain('禁止修改 raw/');
    });
});

describe('buildLlmWikiInjection (P3 注入文本)', () => {
    it('未启用 → 空串', () => {
        expect(buildLlmWikiInjection(false, 'H:/vault')).toBe('');
    });

    it('启用 + vaultPath → 替换 {vault} 为正斜杠路径 + 带标记', () => {
        const out = buildLlmWikiInjection(true, 'H:\\obsidian\\vault');
        expect(out).toContain('[系统注入·LLM Wiki]');
        expect(out).toContain('H:/obsidian/vault');
        expect(out).not.toContain('{vault}');
    });

    it('启用但无 vaultPath → 保留 {vault} 占位（不替换）', () => {
        const out = buildLlmWikiInjection(true);
        expect(out).toContain('{vault}');
    });

    it('规则全文位于标记之后', () => {
        const out = buildLlmWikiInjection(true, '/v');
        expect(out.indexOf('[系统注入·LLM Wiki]')).toBe(0);
        expect(out.indexOf('/wiki-init')).toBeGreaterThan(out.indexOf('LLM Wiki'));
    });
});