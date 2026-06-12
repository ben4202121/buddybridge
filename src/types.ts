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

/**
 * 迁移设置到最新版本。
 * 参考 Claudian 的 normalize+migrate 模式。
 */
export function migrateSettings(stored: any): BuddyBridgeSettings {
    if (!stored || typeof stored !== 'object') {
        return { ...DEFAULT_SETTINGS };
    }

    const settings: BuddyBridgeSettings = {
        codebuddyPath: typeof stored.codebuddyPath === 'string'
            ? stored.codebuddyPath
            : DEFAULT_SETTINGS.codebuddyPath,
        maxConversations: typeof stored.maxConversations === 'number' && stored.maxConversations > 0
            ? stored.maxConversations
            : DEFAULT_SETTINGS.maxConversations,
        version: CURRENT_SETTINGS_VERSION
    };

    // 迁移 v0→v1→v2→v3: 新增 codebuddyPath, 移除 gatewayUrl

    return settings;
}

// ==================== 持久化数据类型 ====================
export interface PersistedData {
    conversations?: Conversation[];
    settings?: Partial<BuddyBridgeSettings>;
}
