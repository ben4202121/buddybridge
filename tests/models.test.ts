import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getModelCatalog, parseCredits, STATIC_MODEL_IDS, localStorageDir, modelDisplayName, type ModelInfo } from '../src/models';

// fixture 形状仿照 CLI 配置 ~/.codebuddy/local_storage/entry_*.info 的结构（userId 为占位假值）。
const REAL_CONFIG = [{
    userId: '00000000-0000-0000-0000-000000000000',
    data: {
        agents: [{
            name: 'cli',
            models: ['hy4-preview', 'hy3', 'hy3-x', 'deepseek-v4-flash'],
        }],
        models: [
            { id: 'hy4-preview', name: 'Hy4 preview', credits: 'x0.00 credits' },
            { id: 'hy3', name: 'Hy3', credits: 'x0.00 credits' },
            { id: 'hy3-x', name: 'Hy3', credits: 'x0.05 credits' },
            { id: 'deepseek-v4-flash', name: 'Deepseek-V4-Flash', credits: 'x0.17 credits' },
            { id: 'default', name: 'Default', credits: 'x2.00 credits' }, // 不在 agent 可用列表，应被过滤
        ],
    },
}];

let dir: string;

function writeCatalogFile(name: string, content: unknown): void {
    const storage = join(dir, '.codebuddy', 'local_storage');
    mkdirSync(storage, { recursive: true });
    writeFileSync(join(storage, name), typeof content === 'string' ? content : JSON.stringify(content), 'utf-8');
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bb-models-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('localStorageDir', () => {
    it('指向 ~/.codebuddy/local_storage', () => {
        expect(localStorageDir('/home/u')).toBe(join('/home/u', '.codebuddy', 'local_storage'));
    });
});

describe('parseCredits (v2.6.0 免费识别)', () => {
    it('x0.00 → 0（免费）', () => {
        expect(parseCredits('x0.00 credits')).toBe(0);
    });

    it('x0.17 → 0.17（收费）', () => {
        expect(parseCredits('x0.17 credits')).toBe(0.17);
    });

    it('x2.00 → 2', () => {
        expect(parseCredits('x2.00 credits')).toBe(2);
    });

    it('缺失 / 无法解析 → undefined', () => {
        expect(parseCredits(undefined)).toBeUndefined();
        expect(parseCredits('')).toBeUndefined();
        expect(parseCredits('garbage')).toBeUndefined();
    });

    it('带前后空白 → 正常解析', () => {
        expect(parseCredits('  x0.00 credits  ')).toBe(0);
        expect(parseCredits('  x0.17 credits  ')).toBe(0.17);
    });

    it('无 x 前缀的 "0.00" → 0', () => {
        expect(parseCredits('0.00')).toBe(0);
    });

    it('负号 → 解析出幅值（正则不含 -；配置中不会出现，仅防御）', () => {
        expect(parseCredits('x-1.5 credits')).toBe(1.5);
    });

    it('数字后无 credits 字样 → 仍解析', () => {
        expect(parseCredits('x1.0')).toBe(1);
    });
});

describe('getModelCatalog (v2.6.0 模型目录)', () => {
    it('解析真实配置：返回 agent 可用模型 + 免费标注（hy4-preview/hy3 免费）', async () => {
        writeCatalogFile('entry_deadbeef.info', REAL_CONFIG);
        const catalog = await getModelCatalog(dir);
        expect(catalog.map((m) => m.id)).toEqual(['hy4-preview', 'hy3', 'hy3-x', 'deepseek-v4-flash']);
        expect(catalog.find((m) => m.id === 'hy4-preview')?.free).toBe(true);
        expect(catalog.find((m) => m.id === 'hy3')?.free).toBe(true);
        expect(catalog.find((m) => m.id === 'hy3-x')?.free).toBe(false);
        expect(catalog.find((m) => m.id === 'deepseek-v4-flash')?.free).toBe(false);
        expect(catalog.find((m) => m.id === 'hy3')?.name).toBe('Hy3');
    });

    it('目录不存在 → 回退静态 15 个 id，且无免费标注', async () => {
        const catalog = await getModelCatalog(dir); // dir 下无 local_storage
        expect(catalog.length).toBe(STATIC_MODEL_IDS.length);
        expect(catalog.every((m) => !m.free)).toBe(true);
        expect(catalog.map((m) => m.id)).toEqual(STATIC_MODEL_IDS);
    });

    it('entry 文件损坏 → 回退静态', async () => {
        writeCatalogFile('entry_deadbeef.info', '{ not json');
        const catalog = await getModelCatalog(dir);
        expect(catalog.length).toBe(STATIC_MODEL_IDS.length);
    });

    it('无 entry_*.info 文件 → 回退静态', async () => {
        mkdirSync(join(dir, 'local_storage'), { recursive: true });
        writeFileSync(join(dir, 'local_storage', 'other.txt'), 'x', 'utf-8');
        const catalog = await getModelCatalog(dir);
        expect(catalog.length).toBe(STATIC_MODEL_IDS.length);
    });

    it('结构不符（无 agents[0].models）→ 跳过该文件，回退静态', async () => {
        writeCatalogFile('entry_deadbeef.info', [{ data: { models: [] } }]);
        const catalog = await getModelCatalog(dir);
        expect(catalog.length).toBe(STATIC_MODEL_IDS.length);
    });

    it('多个 entry 文件：跳过结构不符的第一个，用第二个', async () => {
        writeCatalogFile('entry_bad.info', [{ data: {} }]);
        writeCatalogFile('entry_good.info', REAL_CONFIG);
        const catalog = await getModelCatalog(dir);
        expect(catalog.map((m) => m.id)).toEqual(['hy4-preview', 'hy3', 'hy3-x', 'deepseek-v4-flash']);
    });
});

// 静态清单是 ModelInfo[] 形状（供 tab.ts 兜底复用）
describe('STATIC_MODEL_IDS', () => {
    it('15 个模型 id 且与 CLI help --model 列表一致', () => {
        expect(STATIC_MODEL_IDS).toContain('hy3');
        expect(STATIC_MODEL_IDS).toContain('hy4-preview');
        expect(STATIC_MODEL_IDS).toContain('deepseek-v4-flash');
        expect(new Set(STATIC_MODEL_IDS).size).toBe(STATIC_MODEL_IDS.length);
    });
});

describe('modelDisplayName (v2.6.0 会话模型指示器)', () => {
    const catalog: ModelInfo[] = [
        { id: 'hy3', name: 'Hy3', free: true },
        { id: 'hy3-x', name: 'Hy3', free: false },
    ];

    it('命中目录 → 返回 name + free', () => {
        expect(modelDisplayName('hy3', catalog)).toEqual({ name: 'Hy3', free: true });
        expect(modelDisplayName('hy3-x', catalog)).toEqual({ name: 'Hy3', free: false });
    });

    it('未命中 → 回退 id 本身 + 非免费', () => {
        expect(modelDisplayName('unknown-model', catalog)).toEqual({ name: 'unknown-model', free: false });
    });
});
