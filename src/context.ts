// ==================== 当前文档感知 / 上下文注入 ====================

export interface PromptContextInput {
    userText: string;
    /** 当前活动笔记路径（可为空） */
    notePath?: string | null;
    /** Vault 根路径（可为空） */
    vaultPath?: string | null;
    /** 是否注入当前笔记路径（设置项 noteLinkInjection） */
    noteLinkInjection: boolean;
    /** 是否注入 Vault 上下文（设置项 vaultContextInjection） */
    vaultContextInjection: boolean;
}

/**
 * 构建发送给 CLI 的提示文本（ROADMAP 1.1「当前文档感知」+ P2.6 注入开关）。
 *
 * 设计要点：
 * - 只注入**路径**，不注入正文（避免撑爆上下文；CodeBuddy 有读文件能力，知道路径即可自行读取）。
 * - 注入文本只进入发送给 CLI 的 `contextText`，**不写入对话历史**，聊天记录仍显示用户原文。
 * - 未打开笔记/Vault 时跳过对应注入行；全部开关关闭时原样返回用户文本。
 */
export function buildPromptContext(input: PromptContextInput): string {
    const lines: string[] = [];
    if (input.noteLinkInjection && input.notePath) {
        lines.push(`[当前笔记: ${input.notePath}]`);
    }
    if (input.vaultContextInjection && input.vaultPath) {
        lines.push(`[Vault: ${input.vaultPath}]`);
    }
    if (lines.length === 0) {
        return input.userText;
    }
    return lines.join('\n') + '\n\n' + input.userText;
}

/**
 * 默认行为包装：只注入当前笔记路径（等价于 buildPromptContext 打开「注入当前笔记链接」）。
 * @param userText  用户在聊天框输入的原文
 * @param activeFile 当前活动笔记（或其 path 字段）；null 表示没有打开笔记
 */
export function buildPromptWithCurrentFile(
    userText: string,
    activeFile: { path: string } | null,
): string {
    return buildPromptContext({
        userText,
        notePath: activeFile?.path ?? null,
        noteLinkInjection: true,
        vaultContextInjection: false,
    });
}

// ==================== 会话内上下文去重 ====================

/** 一轮消息实际生效的上下文签名（开关关闭或路径缺失时对应字段为 null）。 */
export interface PromptContextState {
    notePath: string | null;
    vaultPath: string | null;
}

/**
 * 会话内上下文去重：同一会话中，笔记 / Vault 上下文「没变化」就不再重复注入，
 * 只在变化时注入 → CLI 历史里的路径行只出现一次，根除「N 行重复」误判。
 *
 * - prev 为 null（本会话第一条消息）：始终注入完整当前上下文。
 * - 上下文与 prev 相同：原样返回用户文本（不注入）。
 * - 上下文变化（切换笔记 / 关闭笔记 / 开关变化）：注入当前完整上下文。
 * - 笔记由非空变为空：前置 `[当前笔记: 无]`，告知 agent 不再沿用旧笔记。
 *
 * @returns 实际发送的文本 + 本轮应记录的最新 state（供调用方回写缓存）。
 */
export function buildDedupedPrompt(
    prev: PromptContextState | null,
    current: PromptContextState,
    userText: string,
    flags: { noteLinkInjection: boolean; vaultContextInjection: boolean },
): { text: string; state: PromptContextState } {
    if (prev && prev.notePath === current.notePath && prev.vaultPath === current.vaultPath) {
        return { text: userText, state: current };
    }

    let text = buildPromptContext({
        userText,
        notePath: current.notePath,
        vaultPath: current.vaultPath,
        noteLinkInjection: flags.noteLinkInjection,
        vaultContextInjection: flags.vaultContextInjection,
    });

    // 笔记由非空变为空：显式告知「无笔记」，防止 agent 继续按旧笔记行动
    if (flags.noteLinkInjection && prev?.notePath && !current.notePath) {
        text = `[当前笔记: 无]\n\n${text}`;
    }

    return { text, state: current };
}
