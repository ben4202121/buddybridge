import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile } from 'fs/promises';
import {
    cliSettingsPath,
    normalizeVaultPath,
    isVaultAuthorized,
    buildAuthorizedSettings,
    applyVaultAuth,
    readCliSettings,
} from '../src/auth-assist';
import { LLM_WIKI_PERMISSIONS } from '../src/llm-wiki';

describe('cliSettingsPath', () => {
    it('homeDir + .codebuddy/settings.json', () => {
        expect(cliSettingsPath('/home/u')).toBe(join('/home/u', '.codebuddy', 'settings.json'));
    });
});

describe('normalizeVaultPath', () => {
    it('反斜杠转正斜杠', () => {
        expect(normalizeVaultPath('H:\\obsidian\\vault')).toBe('H:/obsidian/vault');
    });
    it('已是正斜杠则不变', () => {
        expect(normalizeVaultPath('/home/u/vault')).toBe('/home/u/vault');
    });
});

describe('isVaultAuthorized', () => {
    it('settings 非对象 → false', () => {
        expect(isVaultAuthorized(null, '/v')).toBe(false);
    });

    it('已信任但缺权限 → false', () => {
        expect(isVaultAuthorized({ trustedDirectories: ['/v'] }, '/v')).toBe(false);
    });

    it('权限齐全但未信任 → false', () => {
        expect(isVaultAuthorized({ permissions: { allow: [...LLM_WIKI_PERMISSIONS] } }, '/v')).toBe(false);
    });

    it('信任 + 全权限 → true', () => {
        const s = { trustedDirectories: ['/v'], permissions: { allow: [...LLM_WIKI_PERMISSIONS] } };
        expect(isVaultAuthorized(s, '/v')).toBe(true);
    });

    it('Windows 路径规范化后匹配', () => {
        const s = { trustedDirectories: ['H:/obsidian/vault'], permissions: { allow: [...LLM_WIKI_PERMISSIONS] } };
        expect(isVaultAuthorized(s, 'H:\\obsidian\\vault')).toBe(true);
    });
});

describe('buildAuthorizedSettings', () => {
    it('settings 非对象（文件不存在）→ 新建完整结构', () => {
        const r = buildAuthorizedSettings(null, 'H:\\v')!;
        expect(r.trustedDirectories).toEqual(['H:/v']);
        expect((r.permissions as { allow: string[] }).allow).toEqual([...LLM_WIKI_PERMISSIONS]);
    });

    it('已有其他路径 → 补 vault 且保留现有路径', () => {
        const s = { trustedDirectories: ['/other'], foo: 'bar' };
        const r = buildAuthorizedSettings(s, '/v')!;
        expect(r.trustedDirectories).toEqual(['/other', '/v']);
        expect(r.foo).toBe('bar');
    });

    it('缺个别权限 → 补 allow（并集）', () => {
        const s = { trustedDirectories: ['/v'], permissions: { allow: ['Write', 'Read'] } };
        const r = buildAuthorizedSettings(s, '/v')!;
        const allow = (r.permissions as { allow: string[] }).allow;
        expect(new Set(allow)).toEqual(new Set(LLM_WIKI_PERMISSIONS));
    });

    it('已完全授权 → null（无需改动）', () => {
        const s = { trustedDirectories: ['/v'], permissions: { allow: [...LLM_WIKI_PERMISSIONS] } };
        expect(buildAuthorizedSettings(s, '/v')).toBeNull();
    });

    it('不可变：原对象不被改动', () => {
        const s = { trustedDirectories: ['/other'] };
        buildAuthorizedSettings(s, '/v');
        expect(s.trustedDirectories).toEqual(['/other']);
    });
});

describe('applyVaultAuth (集成，tmpdir)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bb-auth-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('首次 → created 写文件，二次 → already 幂等', async () => {
        const r1 = await applyVaultAuth('H:\\v', dir);
        expect(r1.status).toBe('created');
        const parsed = JSON.parse(await readFile(join(dir, '.codebuddy', 'settings.json'), 'utf-8'));
        expect(parsed.trustedDirectories).toContain('H:/v');

        const r2 = await applyVaultAuth('H:\\v', dir);
        expect(r2.status).toBe('already');
    });

    it('已有其他配置 → added，保留现有字段', async () => {
        const codebuddyDir = join(dir, '.codebuddy');
        mkdirSync(codebuddyDir, { recursive: true });
        writeFileSync(join(codebuddyDir, 'settings.json'), JSON.stringify({ trustedDirectories: ['/other'], custom: 1 }), 'utf-8');

        const r = await applyVaultAuth('/v', dir);
        expect(r.status).toBe('added');
        const parsed = JSON.parse(await readFile(join(codebuddyDir, 'settings.json'), 'utf-8'));
        expect(parsed.trustedDirectories).toEqual(['/other', '/v']);
        expect(parsed.custom).toBe(1);
    });
});

describe('readCliSettings', () => {
    it('文件不存在 → null；正常 → 解析；损坏 → null', async () => {
        const d = mkdtempSync(join(tmpdir(), 'bb-readcli-'));
        try {
            expect(await readCliSettings(d)).toBeNull();
            const cb = join(d, '.codebuddy');
            mkdirSync(cb, { recursive: true });
            writeFileSync(join(cb, 'settings.json'), JSON.stringify({ a: 1 }), 'utf-8');
            expect(await readCliSettings(d)).toEqual({ a: 1 });
            writeFileSync(join(cb, 'settings.json'), '{bad', 'utf-8');
            expect(await readCliSettings(d)).toBeNull();
        } finally {
            rmSync(d, { recursive: true, force: true });
        }
    });
});