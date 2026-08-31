// ==================== 当前文档感知 / 上下文注入 ====================

import { tF } from './i18n';

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
        lines.push(tF('marker.currentNote', { path: input.notePath }));
    }
    if (input.vaultContextInjection && input.vaultPath) {
        lines.push(tF('marker.vault', { path: input.vaultPath }));
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
 * - 笔记由非空变为空：前置 `[系统注入·当前笔记: 无]`，告知 agent 不再沿用旧笔记。
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
        text = `${tF('marker.noNote')}\n\n${text}`;
    }

    return { text, state: current };
}

/**
 * 传输层换行编码（Windows cmd 截断修复）：
 *
 * 解析出的 codebuddy 路径为 .cmd/.bat 时（本机为 `%APPDATA%\npm\codebuddy.cmd`），
 * api.ts 用 `shell: true` 进入 cmd.exe。cmd 的命令行解析在第一个真实换行（\n）处
 * 结束整条命令，导致多行注入文本（分支转写、当前笔记、问题正文）在第一个换行处被
 * 截断，模型只收到第一行（实测截成只剩标签，如 `[系统注入·分支上下文] ...`）。
 *
 * 方案：发送前把换行替换为 U+2028（LINE SEPARATOR）——
 * - cmd 不把 U+2028 当行结束符，命令行参数完整传输（实测通过）；
 * - 模型按行分隔语义理解 U+2028（实测 hy4-preview 能正确读取多行结构与内容）。
 *
 * 编码只作用于发送给 CLI 的 contextText（不入插件聊天历史，UI 仍显示用户原文）。
 */
export function encodeLineSeparators(text: string): string {
    return text.replace(/\r\n|\r|\n/g, '\u2028');
}
