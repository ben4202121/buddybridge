// ==================== 聊天类型 ====================

/** 消息的结构化组成部分（思考 / 工具调用），用于在流式结束后仍能重建可折叠的展示块。 */
export interface MessagePart {
    kind: 'thinking' | 'tool';
    /** thinking 的内容 */
    content?: string;
    /** tool 的名称 */
    name?: string;
    /** tool 的入参描述 */
    detail?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    /** 结构化 parts（可选，向后兼容：旧数据无此字段仅渲染纯文本） */
    parts?: MessagePart[];
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
    primaryColor: string;
    /** CLI 请求超时（秒），默认 300 */
    timeoutSeconds: number;
    /** Node.js 可执行文件路径（留空自动检测，仅裸脚本启动时使用） */
    nodePath: string;
    /** 发送消息时自动注入当前笔记路径（当前文档感知开关） */
    noteLinkInjection: boolean;
    /** 发送消息时额外注入 Vault 根路径 */
    vaultContextInjection: boolean;
    version: number;
}

/**
 * 当前设置版本号。
 * 每次「新增设置项」时递增；migrateSettings 会把旧版本数据补全到最新结构。
 *
 * 版本历史：
 * - v1：v1.0.x 初始结构（codebuddyPath / maxConversations / primaryColor）
 * - v2-v4：v1.0.x 内迭代（结构未变，仅内部修正）
 * - v5：v2.0 新增 timeoutSeconds（CLI 超时时长）
 * - v6：v2.0.2 新增 nodePath / noteLinkInjection / vaultContextInjection
 * - v7：v2.0.2 注入开关字段命名定稿（noteLinkInjection / vaultContextInjection）
 */
const CURRENT_SETTINGS_VERSION = 7;

/**
 * 持久化数据 blob 的格式版本号。
 * 写入 loadData() 返回对象的顶层 dataVersion 字段；未来发生结构性迁移时递增。
 * v1.0.20 读取到该字段会忽略（old code 只取 conversations / settings），因此降级回 v1.0 不损坏数据。
 */
export const DATA_VERSION = 1;

export const DEFAULT_SETTINGS: BuddyBridgeSettings = {
    codebuddyPath: '',
    maxConversations: 20,
    primaryColor: '',
    timeoutSeconds: 300,
    nodePath: '',
    noteLinkInjection: true,
    vaultContextInjection: false,
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
 *
 * v1.0.20 → v2.0 迁移说明：
 * - v1.0.20 存储结构为 { codebuddyPath, maxConversations, primaryColor, version }
 * - v2.0 在保留上述字段的基础上新增 timeoutSeconds（缺省回落到默认 300s）
 * - 本函数对每个字段做类型安全的归一化，旧数据缺字段时全部回落默认值
 */
export function migrateSettings(stored: unknown): BuddyBridgeSettings {
    if (!isObject(stored)) {
        return { ...DEFAULT_SETTINGS };
    }

    const maxConversations = getNumber(stored, 'maxConversations');
    const primaryColor = getString(stored, 'primaryColor');
    const timeoutSeconds = getNumber(stored, 'timeoutSeconds');
    const nodePath = getString(stored, 'nodePath');

    const noteLinkInjection = typeof stored.noteLinkInjection === 'boolean'
        ? stored.noteLinkInjection
        : DEFAULT_SETTINGS.noteLinkInjection;

    const vaultContextInjection = typeof stored.vaultContextInjection === 'boolean'
        ? stored.vaultContextInjection
        : DEFAULT_SETTINGS.vaultContextInjection;

    return {
        codebuddyPath: getString(stored, 'codebuddyPath') ?? DEFAULT_SETTINGS.codebuddyPath,
        maxConversations: typeof maxConversations === 'number' && maxConversations > 0
            ? maxConversations
            : DEFAULT_SETTINGS.maxConversations,
        primaryColor: primaryColor ?? DEFAULT_SETTINGS.primaryColor,
        timeoutSeconds: typeof timeoutSeconds === 'number' && timeoutSeconds > 0
            ? timeoutSeconds
            : DEFAULT_SETTINGS.timeoutSeconds,
        nodePath: nodePath ?? DEFAULT_SETTINGS.nodePath,
        noteLinkInjection,
        vaultContextInjection,
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
    /** 数据 blob 格式版本号（用于未来迁移与导出版本标识） */
    dataVersion?: number;
    conversations?: Conversation[];
    settings?: Partial<BuddyBridgeSettings>;
}

/**
 * 单条会话的归一化：缺字段时补齐默认值，非法输入返回 null。
 * sessionId 沿用 v1.0 的 UUID 生成策略，保证 v1.0 ↔ v2.0 兼容。
 */
export function normalizeConversation(raw: unknown): Conversation | null {
    if (!isObject(raw)) return null;
    const id = getString(raw, 'id') ?? generateId();
    const title = getString(raw, 'title') ?? '新对话';
    const sessionId = getString(raw, 'sessionId') ?? '';
    const messages = Array.isArray(raw.messages) ? raw.messages as ChatMessage[] : [];
    const createdAt = getNumber(raw, 'createdAt') ?? Date.now();
    const updatedAt = getNumber(raw, 'updatedAt') ?? createdAt;
    return { id, title, sessionId, messages, createdAt, updatedAt };
}

export function normalizePersistedData(raw: unknown): PersistedData {
    const result: PersistedData = { dataVersion: DATA_VERSION };
    if (!isObject(raw)) {
        return result;
    }

    const dataVersion = getNumber(raw, 'dataVersion');
    if (typeof dataVersion === 'number') {
        result.dataVersion = dataVersion;
    }

    if (Array.isArray(raw.conversations)) {
        const convs: Conversation[] = [];
        for (const item of raw.conversations) {
            const conv = normalizeConversation(item);
            if (conv) convs.push(conv);
        }
        result.conversations = convs;
    }

    if (isObject(raw.settings)) {
        result.settings = migrateSettings(raw.settings);
    }

    return result;
}
