// ==================== 聊天类型 ====================
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export interface Conversation {
    id: string;
    title: string;
    sessionId: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
}

// ==================== 设置类型 ====================
export interface BuddyBridgeSettings {
    codebuddyPath: string;
    maxConversations: number;
    version: number;
}

const CURRENT_SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: BuddyBridgeSettings = {
    codebuddyPath: '',
    maxConversations: 20,
    version: CURRENT_SETTINGS_VERSION
};

// ==================== 通用类型安全辅助函数 ====================

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getString(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key];
    return typeof value === 'string' ? value : undefined;
}

export function getNumber(data: Record<string, unknown>, key: string): number | undefined {
    const value = data[key];
    return typeof value === 'number' ? value : undefined;
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return '未知错误';
}

/**
 * 迁移设置到最新版本。
 * 参考 Claudian 的 normalize+migrate 模式。
 */
export function migrateSettings(stored: unknown): BuddyBridgeSettings {
    if (!isObject(stored)) {
        return { ...DEFAULT_SETTINGS };
    }

    const maxConversations = getNumber(stored, 'maxConversations');

    return {
        codebuddyPath: getString(stored, 'codebuddyPath') ?? DEFAULT_SETTINGS.codebuddyPath,
        maxConversations: typeof maxConversations === 'number' && maxConversations > 0
            ? maxConversations
            : DEFAULT_SETTINGS.maxConversations,
        version: CURRENT_SETTINGS_VERSION
    };
}

// ==================== 工具函数 ====================

export function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ==================== 持久化数据类型 ====================
export interface PersistedData {
    conversations?: Conversation[];
    settings?: Partial<BuddyBridgeSettings>;
}

export function normalizePersistedData(raw: unknown): PersistedData {
    const result: PersistedData = {};
    if (!isObject(raw)) {
        return result;
    }

    if (Array.isArray(raw.conversations)) {
        result.conversations = raw.conversations as Conversation[];
    }
    if (isObject(raw.settings)) {
        result.settings = migrateSettings(raw.settings);
    }

    return result;
}
