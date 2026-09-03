// ==================== 当前文档感知 / 上下文注入 ====================

import { tF } from './i18n';

/** P2.4 附加文件：vault 相对路径 + 可选全文（md 发送时读入，非 md 不读只给路径）。 */
export interface AttachedFile {
    path: string;
    /** 全文内容（仅文本类文件读取；非 md 传 undefined 只注入路径，由 CLI 自行读取） */
    content?: string;
}

/**
 * 把附加文件渲染为系统注入块（P2.4）：
 * - 单文件 → `[系统注入·附加文件: path]` + 换行 + 全文（保证深度分析这一篇）；
 * - 无全文 → 只给 `[系统注入·附加文件: path]`（非 md 由 CLI 自行读取，避免无谓撑爆上下文）；
 * - **多文件 → 只给路径清单 + 逐一阅读指令，不塞全文**：cmd.exe 8191 字符硬限制下
 *   多篇全文不可扩展，且模型有 Read 工具可自行读取（路径明确即范围明确）。
 */
export function buildAttachedFilesText(files: AttachedFile[]): string {
    if (files.length === 0) return '';
    if (files.length > 1) {
        const paths = files.map((f) => tF('marker.attachedFile', { path: f.path }));
        return `${tF('marker.attachedCount', { n: files.length })}\n\n${paths.join('\n')}`;
    }
    const f = files[0];
    if (f.content && f.content.trim()) {
        return `${tF('marker.attachedFile', { path: f.path })}\n${f.content}`;
    }
    return tF('marker.attachedFile', { path: f.path });
}

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
    /** P2.4 附加文件（可选） */
    attachedFiles?: AttachedFile[];
}

/**
 * 构建发送给 CLI 的提示文本（ROADMAP 1.1「当前文档感知」+ P2.6 注入开关 + P2.4 附加文件）。
 *
 * 设计要点：
 * - 当前笔记 / Vault 只注入**路径**，不注入正文（避免撑爆上下文；CodeBuddy 有读文件能力，知道路径即可自行读取）。
 * - P2.4 附加文件是**用户显式附加**的，与「当前笔记」不同：md 注入全文，非 md 只给路径。
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
    const attachedText = buildAttachedFilesText(input.attachedFiles ?? []);
    let prefix = lines.join('\n');
    if (attachedText) {
        prefix = prefix ? `${prefix}\n\n${attachedText}` : attachedText;
    }
    if (!prefix) {
        return input.userText;
    }
    return prefix + '\n\n' + input.userText;
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
 * - 上下文与 prev 相同且无附加文件/技能：原样返回用户文本（不注入）。
 * - 上下文变化（切换笔记 / 关闭笔记 / 开关变化）：注入当前完整上下文。
 * - 笔记由非空变为空：前置 `[系统注入·当前笔记: 无]`，告知 agent 不再沿用旧笔记。
 * - P2.4 附加文件 / P2.8 已启用技能**每轮都注入**（用户显式选定的会话级上下文），
 *   不受笔记/Vault 去重影响。
 *
 * @returns 实际发送的文本 + 本轮应记录的最新 state（供调用方回写缓存）。
 */
export function buildDedupedPrompt(
    prev: PromptContextState | null,
    current: PromptContextState,
    userText: string,
    flags: { noteLinkInjection: boolean; vaultContextInjection: boolean },
    attachedFiles: AttachedFile[] = [],
    skillHint: string = '',
): { text: string; state: PromptContextState } {
    const hasExtra = attachedFiles.length > 0 || skillHint.length > 0;
    const noteVaultUnchanged = !!prev && prev.notePath === current.notePath && prev.vaultPath === current.vaultPath;

    // 无附加文件/技能时保持原去重行为（笔记/Vault 没变就不重复注入）；
    // 有附加内容时必须重进注入——附加/技能每轮都要发，不受去重影响。
    if (noteVaultUnchanged && !hasExtra) {
        return { text: userText, state: current };
    }

    let text = userText;
    if (!noteVaultUnchanged) {
        text = buildPromptContext({
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
    }

    if (hasExtra) {
        const extra: string[] = [];
        if (skillHint) {
            extra.push(skillHint);
        }
        const attachedText = buildAttachedFilesText(attachedFiles);
        if (attachedText) {
            extra.push(attachedText);
        }
        text = `${extra.join('\n\n')}\n\n${text}`;
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
