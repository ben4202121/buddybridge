import { buildExportPayload, serializeExport, validateExport, parseExport, EXPORT_FORMAT, EXPORT_VERSION } from '../src/io';
import { DEFAULT_SETTINGS, DATA_VERSION, type Conversation } from '../src/types';

const conv: Conversation = { id: '1', title: 't', sessionId: 's', messages: [], createdAt: 1, updatedAt: 2, attachedFiles: [] };

describe('buildExportPayload', () => {
    it('builds a versioned export with normalized settings and conversations', () => {
        const payload = buildExportPayload({ codebuddyPath: '/x', maxConversations: 3 }, [conv]);
        expect(payload.format).toBe(EXPORT_FORMAT);
        expect(payload.exportVersion).toBe(EXPORT_VERSION);
        expect(payload.dataVersion).toBe(DATA_VERSION);
        expect(payload.settings.codebuddyPath).toBe('/x');
        expect(payload.settings.timeoutSeconds).toBe(DEFAULT_SETTINGS.timeoutSeconds);
        expect(payload.conversations).toHaveLength(1);
        expect(payload.conversations[0].id).toBe('1');
    });
});

describe('serializeExport', () => {
    it('produces valid JSON carrying the format marker', () => {
        const json = serializeExport(buildExportPayload({}, [conv]));
        expect(() => JSON.parse(json)).not.toThrow();
        expect(JSON.parse(json).format).toBe(EXPORT_FORMAT);
    });
});

describe('validateExport', () => {
    it('accepts a valid export object', () => {
        expect(validateExport(buildExportPayload({}, [conv]))).not.toBeNull();
    });

    it('rejects wrong format', () => {
        expect(validateExport({ format: 'other', exportVersion: EXPORT_VERSION, dataVersion: DATA_VERSION })).toBeNull();
    });

    it('rejects unsupported export version', () => {
        expect(validateExport({ format: EXPORT_FORMAT, exportVersion: EXPORT_VERSION + 1, dataVersion: DATA_VERSION })).toBeNull();
    });

    it('rejects missing dataVersion', () => {
        expect(validateExport({ format: EXPORT_FORMAT, exportVersion: EXPORT_VERSION })).toBeNull();
    });

    it('filters invalid conversation entries', () => {
        const raw = buildExportPayload({}, [conv]);
        (raw as { conversations: unknown[] }).conversations = [conv, null, 'x'];
        const result = validateExport(raw);
        expect(result).not.toBeNull();
        expect(result!.conversations).toHaveLength(1);
    });

    it('migrates settings inside the export', () => {
        const raw: unknown = { format: EXPORT_FORMAT, exportVersion: EXPORT_VERSION, dataVersion: DATA_VERSION, settings: { version: 1 }, conversations: [] };
        const result = validateExport(raw);
        expect(result).not.toBeNull();
        expect(result!.settings.timeoutSeconds).toBe(DEFAULT_SETTINGS.timeoutSeconds);
    });
});

describe('parseExport', () => {
    it('parses a valid JSON string', () => {
        const json = serializeExport(buildExportPayload({}, [conv]));
        const result = parseExport(json);
        expect(result).not.toBeNull();
        expect(result!.conversations).toHaveLength(1);
    });

    it('returns null for invalid JSON', () => {
        expect(parseExport('not json')).toBeNull();
    });

    it('round-trips an export payload', () => {
        const original = buildExportPayload({ codebuddyPath: '/x', maxConversations: 5 }, [conv]);
        const restored = parseExport(serializeExport(original));
        expect(restored).toEqual(original);
    });
});
