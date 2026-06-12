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
    gatewayUrl: string;
    maxConversations: number;
    version: number;
}

const CURRENT_SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: BuddyBridgeSettings = {
    gatewayUrl: 'http://127.0.0.1:55808',
    maxConversations: 20,
    version: CURRENT_SETTINGS_VERSION
};

/**
 * 迁移设置到最新版本。
 * 参考 Claudian 的 normalize+migrate 模式。
 */
export function migrateSettings(stored: any): BuddyBridgeSettings {
    if (!stored || typeof stored !== 'object') {
        return { ...DEFAULT_SETTINGS };
    }

    const version = typeof stored.version === 'number' ? stored.version : 0;

    const settings: BuddyBridgeSettings = {
        gatewayUrl: typeof stored.gatewayUrl === 'string'
            ? stored.gatewayUrl
            : DEFAULT_SETTINGS.gatewayUrl,
        maxConversations: typeof stored.maxConversations === 'number' && stored.maxConversations > 0
            ? stored.maxConversations
            : DEFAULT_SETTINGS.maxConversations,
        version: CURRENT_SETTINGS_VERSION
    };

    // 迁移路径 v0 → v1: 旧版可能有额外字段，自动忽略

    return settings;
}

// ==================== 持久化数据类型 ====================
export interface PersistedData {
    conversations?: Conversation[];
    settings?: Partial<BuddyBridgeSettings>;
}