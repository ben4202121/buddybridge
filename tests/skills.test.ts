import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSkillInjection, parseSkillMarkdown, readOfficialMarketplace, detectInstalledSkills, officialMarketplacePath } from '../src/skills';

// 固定测试语言为中文：生产环境语言由 Obsidian 的 localStorage['language'] 决定，
// node 测试环境无 localStorage/navigator（i18n 默认回落英文），显式 mock 保证断言确定性。
(global as any).localStorage = { getItem: (key: string) => (key === 'language' ? 'zh-CN' : null) };

describe('buildSkillInjection (P2.8 技能注入文本)', () => {
    it('returns empty string when no skills enabled', () => {
        expect(buildSkillInjection([])).toBe('');
        expect(buildSkillInjection(undefined as unknown as string[])).toBe('');
    });

    it('builds one marker line per enabled skill', () => {
        expect(buildSkillInjection(['pdf', 'docx'])).toBe('[系统注入·技能: pdf]\n[系统注入·技能: docx]');
    });

    it('filters blank / non-string entries', () => {
        expect(buildSkillInjection(['pdf', '', '  ', 'docx'])).toBe('[系统注入·技能: pdf]\n[系统注入·技能: docx]');
    });

    it('trims names before injecting', () => {
        expect(buildSkillInjection([' pdf '])).toBe('[系统注入·技能: pdf]');
    });
});

describe('parseSkillMarkdown (SKILL.md frontmatter)', () => {
    it('extracts name and description', () => {
        const md = '---\nname: my-skill\ndescription: 处理 PDF\n---\n\n正文';
        expect(parseSkillMarkdown(md)).toEqual({ name: 'my-skill', description: '处理 PDF' });
    });

    it('returns empty object without frontmatter', () => {
        expect(parseSkillMarkdown('# 没有 frontmatter')).toEqual({});
    });

    it('handles missing description', () => {
        expect(parseSkillMarkdown('---\nname: a\n---')).toEqual({ name: 'a' });
    });

    it('handles CRLF line endings', () => {
        expect(parseSkillMarkdown('---\r\nname: a\r\ndescription: b\r\n---')).toEqual({ name: 'a', description: 'b' });
    });

    it('returns empty object when name is absent', () => {
        expect(parseSkillMarkdown('---\ndescription: only\n---')).toEqual({ description: 'only' });
    });
});

describe('readOfficialMarketplace (官方市场注册表读取)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bb-skills-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    function writeRegistry(registry: unknown): void {
        mkdirSync(join(dir, '.codebuddy', 'plugins'), { recursive: true });
        writeFileSync(officialMarketplacePath(dir), JSON.stringify(registry), 'utf-8');
    }

    it('returns full plugin list from the registry', async () => {
        writeRegistry({
            'codebuddy-plugins-official': {
                manifest: {
                    plugins: [
                        { name: 'pdf', description: 'PDF 处理', version: '1.0.0' },
                        { name: 'docx', description: 'Word 生成', version: '1.0.0' },
                    ],
                },
            },
        });
        const list = await readOfficialMarketplace(dir);
        expect(list).toEqual([
            { name: 'pdf', description: 'PDF 处理' },
            { name: 'docx', description: 'Word 生成' },
        ]);
    });

    it('skips entries without a name and normalizes missing description', async () => {
        writeRegistry({
            'codebuddy-plugins-official': {
                manifest: {
                    plugins: [{ description: 'x' }, { name: 'ok' }],
                },
            },
        });
        const list = await readOfficialMarketplace(dir);
        expect(list).toEqual([{ name: 'ok', description: '' }]);
    });

    it('returns empty for missing marketplace key or malformed manifest', async () => {
        writeRegistry({ other: {} });
        expect(await readOfficialMarketplace(dir)).toEqual([]);
        writeRegistry({ 'codebuddy-plugins-official': { manifest: { plugins: 'nope' } } });
        expect(await readOfficialMarketplace(dir)).toEqual([]);
    });

    it('throws when registry file is missing', async () => {
        await expect(readOfficialMarketplace(dir)).rejects.toThrow('未找到官方市场注册表');
    });

    it('throws on invalid JSON', async () => {
        mkdirSync(join(dir, '.codebuddy', 'plugins'), { recursive: true });
        writeFileSync(officialMarketplacePath(dir), 'not-json{{{', 'utf-8');
        await expect(readOfficialMarketplace(dir)).rejects.toThrow('解析失败');
    });
});

describe('detectInstalledSkills (已安装技能探测)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bb-skills-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    function writeSkill(relPath: string, md: string): void {
        const full = join(dir, relPath);
        mkdirSync(full, { recursive: true });
        writeFileSync(join(full, 'SKILL.md'), md, 'utf-8');
    }

    it('finds skills under plugin skills/ dirs, self-as-skill plugins, and ~/.codebuddy/skills', async () => {
        // 官方插件标准结构：plugins/<插件>/skills/<技能>/SKILL.md
        writeSkill('.codebuddy/plugins/plugin-a/skills/pdf', '---\nname: pdf\ndescription: PDF 处理\n---');
        // 插件自身即技能：plugins/<插件>/SKILL.md
        writeSkill('.codebuddy/plugins/plugin-b', '---\nname: docx\ndescription: Word 生成\n---');
        // 顶层 skills 目录
        writeSkill('.codebuddy/skills/xlsx', '---\nname: xlsx\ndescription: Excel\n---');
        // marketplaces 目录应被跳过
        mkdirSync(join(dir, '.codebuddy', 'plugins', 'marketplaces'), { recursive: true });

        const skills = await detectInstalledSkills(dir);
        expect(skills.map(s => s.name).sort()).toEqual(['docx', 'pdf', 'xlsx']);
    });

    it('returns empty when nothing installed', async () => {
        expect(await detectInstalledSkills(dir)).toEqual([]);
    });

    it('dedupes by name across locations', async () => {
        writeSkill('.codebuddy/plugins/a/skills/pdf', '---\nname: pdf\ndescription: X\n---');
        writeSkill('.codebuddy/skills/pdf', '---\nname: pdf\ndescription: X\n---');
        const skills = await detectInstalledSkills(dir);
        expect(skills.filter(s => s.name === 'pdf')).toHaveLength(1);
    });

    it('ignores SKILL.md without a frontmatter name', async () => {
        writeSkill('.codebuddy/skills/noname', '# 没有 frontmatter');
        expect(await detectInstalledSkills(dir)).toEqual([]);
    });
});
