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
    /** P2.4 附加到会话上下文的文件（vault 相对路径，发送时注入；md 读全文，非 md 只给路径） */
    attachedFiles: string[];
}

// ==================== 设置类型 ====================
export interface BuddyBridgeSettings {
    codebuddyPath: string;
    maxConversations: number;
    primaryColor: string;
    /** 聊天区字体大小（px），默认 14 */
    fontSize: number;
    /** 上下文窗口大小（token），用量显示的分母，默认 200000 */
    contextWindowSize: number;
    /** CLI 空闲超时（秒）：连续该时长无任何输出即判定卡死并终止，默认 60 */
    timeoutSeconds: number;
    /** Node.js 可执行文件路径（留空自动检测，仅裸脚本启动时使用） */
    nodePath: string;
    /** 发送消息时自动注入当前笔记路径（当前文档感知开关） */
    noteLinkInjection: boolean;
    /** 发送消息时额外注入 Vault 根路径 */
    vaultContextInjection: boolean;
    /** P2.8 已启用的官方技能名列表（发送时注入提示，引导模型优先使用） */
    enabledSkills: string[];
    /** P1 传输方式：'print' 旧路径（每条消息 spawn 新进程）| 'acp' 常驻 ACP 进程（默认 print） */
    transportMode: 'print' | 'acp';
    /** P1 ACP 权限模式：--permission-mode 取值（default | acceptEdits | dontAsk | bypassPermissions，默认 acceptEdits） */
    acpPermissionMode: string;
    /** P1 默认模型：'auto' 跟随 CLI 默认（不传 --model）| 具体模型 id（仅 ACP 传输生效，新连接应用） */
    defaultModel: string;
    /** P3 LLM Wiki：开启后把 LLM Wiki 规则注入每条消息（在 Vault 上用 /wiki-init /wiki-ingest /wiki-query /wiki-lint 管理知识库） */
    llmWikiEnabled: boolean;
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
 * - v8：v2.2.0 新增 fontSize（聊天区字体大小，px）
 * - v9：v2.3.0 新增 contextWindowSize（上下文窗口大小，token）
 * - v10：v2.4.0 新增 enabledSkills（已启用的官方技能名列表，P2.8）
 * - v11：v2.5.0 新增 transportMode（print/acp 传输方式）+ acpPermissionMode（ACP 权限模式，P1）
 * - v12：v2.6.0 新增 defaultModel（默认模型，ACP 模式生效，模型切换）
 * - v13：v2.7.0 新增 llmWikiEnabled（LLM Wiki 内置技能开关，P3）
 */
const CURRENT_SETTINGS_VERSION = 13;

/** 聊天区字体大小范围（px），与设置页滑块联动 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 18;

/** 上下文窗口大小范围（token），与设置页输入联动 */
export const CONTEXT_WINDOW_MIN = 1000;
export const CONTEXT_WINDOW_MAX = 1000000;

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
    fontSize: 14,
    contextWindowSize: 200000,
    timeoutSeconds: 60,
    nodePath: '',
    noteLinkInjection: true,
    vaultContextInjection: false,
    enabledSkills: [],
    transportMode: 'print',
    acpPermissionMode: 'acceptEdits',
    defaultModel: 'auto',
    llmWikiEnabled: false,
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
    const fontSize = getNumber(stored, 'fontSize');
    const contextWindowSize = getNumber(stored, 'contextWindowSize');
    const timeoutSeconds = getNumber(stored, 'timeoutSeconds');
    const nodePath = getString(stored, 'nodePath');

    const noteLinkInjection = typeof stored.noteLinkInjection === 'boolean'
        ? stored.noteLinkInjection
        : DEFAULT_SETTINGS.noteLinkInjection;

    const vaultContextInjection = typeof stored.vaultContextInjection === 'boolean'
        ? stored.vaultContextInjection
        : DEFAULT_SETTINGS.vaultContextInjection;

    // P2.8 已启用技能：只保留非空字符串并去除首尾空白，缺失回落到空列表
    const enabledSkills = Array.isArray(stored.enabledSkills)
        ? (stored.enabledSkills as unknown[])
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
        : [];

    // P1 传输方式：只认 'print' | 'acp' 两值，其余回落到默认 print
    const transportMode = stored.transportMode === 'acp' ? 'acp' : 'print';
    // 权限模式：空串/缺失回落到默认（nullish 会放过空串，须用 || 兜底）
    const acpPermissionMode = getString(stored, 'acpPermissionMode')
        || DEFAULT_SETTINGS.acpPermissionMode;
    // P1 默认模型：非空字符串保留，否则回落 'auto'（跟随 CLI 默认）
    const defaultModel = getString(stored, 'defaultModel')?.trim()
        || DEFAULT_SETTINGS.defaultModel;
    // P3 LLM Wiki：布尔开关，缺失回落关闭
    const llmWikiEnabled = typeof stored.llmWikiEnabled === 'boolean'
        ? stored.llmWikiEnabled
        : DEFAULT_SETTINGS.llmWikiEnabled;

    return {
        codebuddyPath: getString(stored, 'codebuddyPath') ?? DEFAULT_SETTINGS.codebuddyPath,
        maxConversations: typeof maxConversations === 'number' && maxConversations > 0
            ? maxConversations
            : DEFAULT_SETTINGS.maxConversations,
        primaryColor: primaryColor ?? DEFAULT_SETTINGS.primaryColor,
        fontSize: typeof fontSize === 'number' && fontSize >= FONT_SIZE_MIN && fontSize <= FONT_SIZE_MAX
            ? fontSize
            : DEFAULT_SETTINGS.fontSize,
        contextWindowSize: typeof contextWindowSize === 'number'
            && contextWindowSize >= CONTEXT_WINDOW_MIN
            && contextWindowSize <= CONTEXT_WINDOW_MAX
            ? contextWindowSize
            : DEFAULT_SETTINGS.contextWindowSize,
        timeoutSeconds: typeof timeoutSeconds === 'number' && timeoutSeconds > 0
            ? timeoutSeconds
            : DEFAULT_SETTINGS.timeoutSeconds,
        nodePath: nodePath ?? DEFAULT_SETTINGS.nodePath,
        noteLinkInjection,
        vaultContextInjection,
        enabledSkills,
        transportMode,
        acpPermissionMode,
        defaultModel,
        llmWikiEnabled,
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
    // P2.4 附加文件：缺失/非法项补齐默认（旧数据无此字段 → []）
    const attachedFiles = Array.isArray(raw.attachedFiles)
        ? (raw.attachedFiles as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];
    return { id, title, sessionId, messages, createdAt, updatedAt, attachedFiles };
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
