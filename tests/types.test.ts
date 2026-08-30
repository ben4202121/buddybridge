import { DEFAULT_SETTINGS, migrateSettings, isObject, getString, getNumber, getErrorMessage, normalizePersistedData, normalizeConversation, DATA_VERSION, type Conversation } from '../src/types';

describe('DEFAULT_SETTINGS', () => {
    it('should accept empty codebuddyPath', () => {
        expect(DEFAULT_SETTINGS.codebuddyPath).toBe('');
    });
    it('should have sensible maxConversations', () => {
        expect(DEFAULT_SETTINGS.maxConversations).toBeGreaterThan(0);
    });
    it('should default timeoutSeconds to 300', () => {
        expect(DEFAULT_SETTINGS.timeoutSeconds).toBe(300);
    });
    it('should default fontSize to 14', () => {
        expect(DEFAULT_SETTINGS.fontSize).toBe(14);
    });
});

describe('migrateSettings', () => {
    it('should return defaults for null', () => {
        const r = migrateSettings(null);
        expect(r.codebuddyPath).toBe('');
        expect(r.maxConversations).toBe(DEFAULT_SETTINGS.maxConversations);
        expect(r.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('should return defaults for non-object values', () => {
        expect(migrateSettings('string')).toEqual(DEFAULT_SETTINGS);
        expect(migrateSettings(123)).toEqual(DEFAULT_SETTINGS);
    });

    it('should merge stored values', () => {
        const r = migrateSettings({ codebuddyPath: '/custom/codebuddy', maxConversations: 10 });
        expect(r.codebuddyPath).toBe('/custom/codebuddy');
        expect(r.maxConversations).toBe(10);
    });

    it('should ignore invalid maxConversations', () => {
        expect(migrateSettings({ maxConversations: 0 }).maxConversations).toBe(DEFAULT_SETTINGS.maxConversations);
        expect(migrateSettings({ maxConversations: -5 }).maxConversations).toBe(DEFAULT_SETTINGS.maxConversations);
        expect(migrateSettings({ maxConversations: '20' }).maxConversations).toBe(DEFAULT_SETTINGS.maxConversations);
    });

    it('should reset version to current', () => {
        const r = migrateSettings({ version: 1 });
        expect(r.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('should migrate v1.0.20 shape to v2.0 with timeoutSeconds default (P0.7)', () => {
        // v1.0.20 存储结构：无 timeoutSeconds、version 为 1
        const r = migrateSettings({
            codebuddyPath: 'C:\\old\\codebuddy',
            maxConversations: 7,
            primaryColor: '#ff0000',
            version: 1
        });
        expect(r.codebuddyPath).toBe('C:\\old\\codebuddy');
        expect(r.maxConversations).toBe(7);
        expect(r.primaryColor).toBe('#ff0000');
        expect(r.timeoutSeconds).toBe(300); // 新字段回落默认
        expect(r.fontSize).toBe(14); // v8 新增字段回落默认
        expect(r.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('should preserve timeoutSeconds when present and valid', () => {
        expect(migrateSettings({ timeoutSeconds: 60 }).timeoutSeconds).toBe(60);
        expect(migrateSettings({ timeoutSeconds: 0 }).timeoutSeconds).toBe(300);
        expect(migrateSettings({ timeoutSeconds: -1 }).timeoutSeconds).toBe(300);
        expect(migrateSettings({ timeoutSeconds: '300' }).timeoutSeconds).toBe(300);
    });

    it('should preserve fontSize when present and within bounds', () => {
        expect(migrateSettings({ fontSize: 12 }).fontSize).toBe(12);
        expect(migrateSettings({ fontSize: 18 }).fontSize).toBe(18);
        expect(migrateSettings({ fontSize: 16 }).fontSize).toBe(16);
    });

    it('should fall back to default fontSize when missing or invalid', () => {
        expect(migrateSettings({}).fontSize).toBe(14);
        expect(migrateSettings({ fontSize: 5 }).fontSize).toBe(14);  // 低于下限
        expect(migrateSettings({ fontSize: 99 }).fontSize).toBe(14); // 高于上限
        expect(migrateSettings({ fontSize: '14' }).fontSize).toBe(14); // 非数字
    });

    it('should migrate nodePath from stored value', () => {
        expect(migrateSettings({ nodePath: 'C:\\node.exe' }).nodePath).toBe('C:\\node.exe');
    });

    it('should default new toggles correctly', () => {
        const r = migrateSettings({});
        expect(r.nodePath).toBe('');
        expect(r.noteLinkInjection).toBe(true);
        expect(r.vaultContextInjection).toBe(false);
    });

    it('should preserve boolean toggle values', () => {
        expect(migrateSettings({ noteLinkInjection: false }).noteLinkInjection).toBe(false);
        expect(migrateSettings({ vaultContextInjection: true }).vaultContextInjection).toBe(true);
    });

    it('should treat non-boolean toggles as defaults', () => {
        expect(migrateSettings({ noteLinkInjection: 'yes' }).noteLinkInjection).toBe(true);
        expect(migrateSettings({ vaultContextInjection: 1 }).vaultContextInjection).toBe(false);
    });
});

describe('type helpers', () => {
    describe('isObject', () => {
        it('returns true for plain objects', () => {
            expect(isObject({})).toBe(true);
            expect(isObject({ a: 1 })).toBe(true);
        });

        it('returns false for arrays, null, and primitives', () => {
            expect(isObject(null)).toBe(false);
            expect(isObject([])).toBe(false);
            expect(isObject('string')).toBe(false);
            expect(isObject(123)).toBe(false);
        });
    });

    describe('getString', () => {
        it('returns string values', () => {
            expect(getString({ key: 'value' }, 'key')).toBe('value');
        });

        it('returns undefined for non-strings', () => {
            expect(getString({ key: 123 }, 'key')).toBeUndefined();
            expect(getString({}, 'missing')).toBeUndefined();
        });
    });

    describe('getNumber', () => {
        it('returns number values', () => {
            expect(getNumber({ key: 42 }, 'key')).toBe(42);
        });

        it('returns undefined for non-numbers', () => {
            expect(getNumber({ key: '42' }, 'key')).toBeUndefined();
            expect(getNumber({}, 'missing')).toBeUndefined();
        });
    });

    describe('getErrorMessage', () => {
        it('extracts Error message', () => {
            expect(getErrorMessage(new Error('boom'))).toBe('boom');
        });

        it('returns string as-is', () => {
            expect(getErrorMessage('plain string')).toBe('plain string');
        });

        it('falls back to default for unknown values', () => {
            expect(getErrorMessage(null)).toBe('未知错误');
            expect(getErrorMessage({})).toBe('未知错误');
        });
    });

    describe('normalizePersistedData', () => {
        it('returns dataVersion for invalid input', () => {
            expect(normalizePersistedData(null)).toEqual({ dataVersion: DATA_VERSION });
            expect(normalizePersistedData('string')).toEqual({ dataVersion: DATA_VERSION });
        });

        it('preserves conversations array and stamps dataVersion', () => {
            const conversations: Conversation[] = [{ id: '1', title: 't', sessionId: '', messages: [], createdAt: 0, updatedAt: 0 }];
            expect(normalizePersistedData({ conversations })).toEqual({ dataVersion: DATA_VERSION, conversations });
        });

        it('normalizes settings object', () => {
            const result = normalizePersistedData({ settings: { codebuddyPath: '/path' } });
            expect(result.settings?.codebuddyPath).toBe('/path');
            expect(result.settings?.version).toBe(DEFAULT_SETTINGS.version);
        });

        it('keeps existing dataVersion', () => {
            const result = normalizePersistedData({ dataVersion: 9, conversations: [] });
            expect(result.dataVersion).toBe(9);
        });

        it('filters out invalid conversation entries (P0.7)', () => {
            const result = normalizePersistedData({ conversations: [null, 'x', 42] });
            expect(result.conversations).toEqual([]);
        });
    });

    describe('normalizeConversation', () => {
        it('fills missing fields with defaults', () => {
            const conv = normalizeConversation({ id: 'abc' });
            expect(conv).not.toBeNull();
            expect(conv!.id).toBe('abc');
            expect(conv!.title).toBe('新对话');
            expect(conv!.sessionId).toBe('');
            expect(conv!.messages).toEqual([]);
            expect(typeof conv!.createdAt).toBe('number');
            expect(conv!.updatedAt).toBe(conv!.createdAt);
        });

        it('keeps provided values intact', () => {
            const conv = normalizeConversation({
                id: '1', title: 't', sessionId: 'uuid', messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 }], createdAt: 100, updatedAt: 200
            });
            expect(conv!.sessionId).toBe('uuid');
            expect(conv!.messages).toHaveLength(1);
            expect(conv!.updatedAt).toBe(200);
        });

        it('returns null for invalid input', () => {
            expect(normalizeConversation(null)).toBeNull();
            expect(normalizeConversation('x')).toBeNull();
            expect(normalizeConversation([])).toBeNull();
        });

        it('keeps message parts intact (thinking/tool persistence)', () => {
            const conv = normalizeConversation({
                id: '1', title: 't', sessionId: 's',
                messages: [{ id: 'm', role: 'assistant', content: '', timestamp: 1, parts: [{ kind: 'thinking', content: 'x' }] }],
                createdAt: 0, updatedAt: 0
            });
            expect(conv!.messages[0].parts).toEqual([{ kind: 'thinking', content: 'x' }]);
        });
    });
});
