import { DEFAULT_SETTINGS, migrateSettings, isObject, getString, getNumber, getErrorMessage, normalizePersistedData, type Conversation } from '../src/types';

describe('DEFAULT_SETTINGS', () => {
    it('should accept empty codebuddyPath', () => {
        expect(DEFAULT_SETTINGS.codebuddyPath).toBe('');
    });
    it('should have sensible maxConversations', () => {
        expect(DEFAULT_SETTINGS.maxConversations).toBeGreaterThan(0);
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
        it('returns empty object for invalid input', () => {
            expect(normalizePersistedData(null)).toEqual({});
            expect(normalizePersistedData('string')).toEqual({});
        });

        it('preserves conversations array', () => {
            const conversations: Conversation[] = [{ id: '1', title: 't', sessionId: '', messages: [], createdAt: 0, updatedAt: 0 }];
            expect(normalizePersistedData({ conversations })).toEqual({ conversations });
        });

        it('normalizes settings object', () => {
            const result = normalizePersistedData({ settings: { codebuddyPath: '/path' } });
            expect(result.settings?.codebuddyPath).toBe('/path');
            expect(result.settings?.version).toBe(DEFAULT_SETTINGS.version);
        });
    });
});
