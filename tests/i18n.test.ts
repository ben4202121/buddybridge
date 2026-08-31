import { detectLanguage, translate, tf, t } from '../src/i18n';

// 固定测试语言为中文：node 环境无 localStorage/navigator，i18n 默认回落英文；
// 显式 mock 保证 zh 侧断言确定性（detectLanguage 子集各自再覆盖 en/zh 切换）。
(global as any).localStorage = { getItem: (key: string) => (key === 'language' ? 'zh-CN' : null) };

// ==================== i18n（P2.7 界面国际化） ====================

/** 从 i18n.ts 词典取全部 key（透过 translate 的 key→缺省回退行为探测存在性）。 */
const ALL_KEYS = [
    'view.title',
    'cmd.clear', 'cmd.help', 'cmd.status', 'cmd.doctor', 'cmd.compact', 'cmd.summarize',
    'cmd.context', 'cmd.cost', 'cmd.model', 'cmd.permissions', 'cmd.config', 'cmd.export',
    'cmd.resume', 'cmd.rewind', 'cmd.init', 'cmd.plan', 'cmd.fork', 'cmd.memory', 'cmd.mcp',
    'cmd.todos', 'cmd.stats', 'cmd.cr', 'cmd.fix', 'cmd.tests', 'cmd.explain', 'cmd.rules',
    'tab.close', 'tab.branch', 'conv.new', 'conv.branchSuffix',
    'input.placeholder', 'input.send', 'input.stop',
    'empty.title', 'empty.subtitle', 'empty.tips', 'tip.enter', 'tip.commands', 'tip.context',
    'thinking.label', 'thinking.done', 'thinking.inline', 'tool.title',
    'error.title', 'error.retry', 'error.retryAria', 'error.hintPath', 'error.hintNode', 'error.hintTimeout',
    'msg.stopped', 'msg.noResponse', 'msg.errorPrefix', 'role.user', 'role.assistant',
    'notice.convFull', 'notice.requestFail', 'notice.gatewayEmpty',
    'queue.delete',
    'usage.label',
    'marker.currentNote', 'marker.noNote', 'marker.vault', 'marker.forkTranscript', 'marker.sessionReset',
    'tab.heading.connection', 'settings.pathName', 'settings.pathDesc', 'settings.pathPlaceholder',
    'settings.nodeName', 'settings.nodeDesc', 'settings.autoDetect',
    'settings.timeoutName', 'settings.timeoutDesc',
    'tab.heading.injection', 'settings.noteLinkName', 'settings.noteLinkDesc',
    'settings.vaultName', 'settings.vaultDesc', 'settings.pathExample',
    'tab.heading.appearance', 'settings.colorName', 'settings.colorDesc',
    'settings.fontName', 'settings.fontDesc',
    'tab.heading.usage', 'settings.windowName', 'settings.windowDesc',
    'tab.heading.manage', 'settings.maxConvName', 'settings.maxConvDesc',
    'settings.exportName', 'settings.exportDesc', 'settings.exportBtn',
    'settings.importName', 'settings.importDesc', 'settings.importBtn',
    'settings.resetName', 'settings.resetDesc', 'settings.resetBtn',
    'settings.resetConfirm', 'settings.resetDone'
];

describe('i18n 词典完整性（P2.7）', () => {
    it('translates every key in both languages (no missing translations)', () => {
        for (const key of ALL_KEYS) {
            const zh = translate('zh', key);
            const en = translate('en', key);
            expect(zh).not.toBe(key); // zh 必有实际翻译
            expect(en).not.toBe(key); // en 必有实际翻译
            expect(zh).not.toBe(en);  // 两语言不得相同
        }
    });

    it('returns the key itself for unknown keys (safe fallback)', () => {
        expect(translate('zh', 'no.such.key')).toBe('no.such.key');
        expect(translate('en', 'no.such.key')).toBe('no.such.key');
    });
});

describe('tf (带插值取词)', () => {
    it('interpolates a single placeholder', () => {
        expect(tf('zh', 'notice.convFull', { max: 20 })).toBe('对话已满（最多 20 个），请先删除旧对话再新建');
        expect(tf('en', 'notice.convFull', { max: 20 })).toBe('Conversation limit reached (max 20), delete an old conversation first');
    });

    it('interpolates multiple placeholders', () => {
        expect(tf('zh', 'usage.label', { tokens: '12,345', window: '200,000', pct: '6' }))
            .toBe('上下文 12,345 / 200,000 (6%)');
        expect(tf('en', 'usage.label', { tokens: '12,345', window: '200,000', pct: '6' }))
            .toBe('Context 12,345 / 200,000 (6%)');
    });

    it('interpolates repeatedly when the placeholder appears more than once', () => {
        expect(tf('zh', 'notice.requestFail', { msg: 'x' })).toBe('请求失败: x');
    });
});

describe('系统注入标记跟随界面语言（方案 A）', () => {
    it('zh markers match the legacy Chinese format', () => {
        expect(tf('zh', 'marker.currentNote', { path: '笔记/a.md' })).toBe('[系统注入·当前笔记: 笔记/a.md]');
        expect(tf('zh', 'marker.vault', { path: '/vault' })).toBe('[系统注入·Vault: /vault]');
        expect(t('marker.noNote')).toBe('[系统注入·当前笔记: 无]');
        expect(t('marker.forkTranscript')).toBe('[系统注入·分支上下文] 以下是你与此用户此前的对话（截至分支点），仅作背景参考：');
        expect(t('marker.sessionReset')).toBe('[系统注入·会话重置] 以下是你与此用户此前的对话（会话已因网关故障重置），仅作背景参考：');
    });

    it('en markers use English labels (UI 切英文时注入也切换)', () => {
        expect(tf('en', 'marker.currentNote', { path: 'notes/a.md' })).toBe('[System injection·Current note: notes/a.md]');
        expect(tf('en', 'marker.vault', { path: '/vault' })).toBe('[System injection·Vault: /vault]');
        expect(tf('en', 'marker.noNote', {})).toBe('[System injection·Current note: none]');
    });
});

describe('detectLanguage', () => {
    const origLang = (global as any).navigator?.language;

    afterEach(() => {
        delete (global as any).localStorage;
        if (origLang === undefined) {
            delete (global as any).navigator;
        } else {
            (global as any).navigator = { language: origLang };
        }
    });

    it('prefers localStorage language starting with zh', () => {
        (global as any).localStorage = { getItem: (k: string) => (k === 'language' ? 'zh-CN' : null) };
        expect(detectLanguage()).toBe('zh');
    });

    it('treats zh-Hant as zh too', () => {
        (global as any).localStorage = { getItem: (k: string) => (k === 'language' ? 'zh-Hant' : null) };
        expect(detectLanguage()).toBe('zh');
    });

    it('falls back to en for non-zh locales', () => {
        (global as any).localStorage = { getItem: (k: string) => (k === 'language' ? 'en-US' : null) };
        expect(detectLanguage()).toBe('en');
    });

    it('falls back to navigator.language when localStorage is absent', () => {
        delete (global as any).localStorage;
        (global as any).navigator = { language: 'en-GB' };
        expect(detectLanguage()).toBe('en');
    });

    it('t returns the current-language value (zh environment)', () => {
        (global as any).localStorage = { getItem: (k: string) => (k === 'language' ? 'zh-CN' : null) };
        expect(t('view.title')).toBe('BuddyBridge 聊天');
    });
});
