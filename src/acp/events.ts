// ==================== ACP 事件 → StreamChunk 映射（P1） ====================
//
// ACP 的 `session/update` 通知形状（真实抓包 .repro/acp_stream.jsonl 验证）：
//   { jsonrpc, method: 'session/update', params: { sessionId, update: { sessionUpdate, ... } } }
// 本模块把 `params.update`（下文称 update）逐条映射为插件既有的 StreamChunk 契约，
// 使聊天视图的 for-await 消费点零改动（缝合点在 api.sendMessage）。
//
// 映射表：
//   agent_message_chunk      → { type:'text' }       正文流（content.type='text'）
//   agent_thought_chunk      → { type:'thinking' }   思考流
//   tool_call (参数完整)      → { type:'tool' }       工具卡（title/rawInput/_meta.toolName）
//   usage_update             → { type:'text', content:'', usage }  用量占位（P2.5 用量条）
//   session_end              → { type:'done' }
//   其余（config_option_update / available_commands_update /
//        session_info_update / plan / tool_call_update / 未知）→ null 静默

import type { StreamChunk, UsageInfo } from '../api';
import { getNumber, getString, isObject } from '../types';

/** 工具调用的展示信息（tool_call 事件解析产物）。 */
export interface AcpToolCallInfo {
    toolName: string;
    /** 展示文本：优先 title（如 "`ls -la`"），回退 rawInput JSON */
    detail: string;
    toolCallId: string;
}

/** 从 update.content（{type:'text',text}）取文本。 */
function getContentText(update: Record<string, unknown>): string {
    const content = update.content;
    if (!isObject(content)) return '';
    const text = getString(content, 'text');
    return text ?? '';
}

/**
 * 解析 tool_call 事件。只有「参数已完整」的 tool_call 才产出卡片：
 * 抓包显示同一 toolCallId 会连发多次 tool_call —— 首次（in_progress）只有
 * title=工具名、rawInput={}（参数还在流式）；后续带 rawInput + title 且
 * `_meta.codebuddy.ai/toolArgumentsComplete=true` 的才是可展示的完整调用。
 * 返回 null 表示仍在流式/无展示价值（由调用方按 toolCallId 去重）。
 */
export function parseToolCall(update: Record<string, unknown>): AcpToolCallInfo | null {
    const meta = isObject(update._meta) ? update._meta : {};
    const toolCallId = getString(update, 'toolCallId') ?? '';
    const toolName = getString(meta, 'codebuddy.ai/toolName') ?? '';
    const title = getString(update, 'title') ?? '';
    const rawInput = update.rawInput;
    const rawInputObj = isObject(rawInput) ? rawInput : null;
    const argsComplete = meta['codebuddy.ai/toolArgumentsComplete'] === true;

    // 无 id 或工具名 → 不可展示
    if (!toolCallId || !toolName) return null;
    // 参数未完整且无有效载荷 → 仍在流式，跳过
    const hasInput = rawInputObj !== null && Object.keys(rawInputObj).length > 0;
    const hasDistinctTitle = title.length > 0 && title !== toolName;
    if (!argsComplete && !hasInput && !hasDistinctTitle) return null;

    // title 仅当与裸工具名不同才作 detail（否则是工具名重复，无展示价值）；
    // 回退 rawInput JSON（如 {"command":"pwd"}）
    const distinctTitle = title && title !== toolName ? title : '';
    const detail = distinctTitle || (rawInputObj ? JSON.stringify(rawInputObj) : '');
    return { toolName, detail: detail || toolName, toolCallId };
}

/** 从 usage_update 提取用量（P2.5 用量条）：used → inputTokens（context window 用量）。 */
export function extractUsage(update: Record<string, unknown>): UsageInfo | undefined {
    const used = getNumber(update, 'used');
    if (typeof used !== 'number' || used < 0) return undefined;
    const meta = isObject(update._meta) ? update._meta : {};
    const byCat = isObject(meta['codebuddy.ai/usageByCategory']) ? meta['codebuddy.ai/usageByCategory'] : null;
    const outputTokens = byCat !== null && typeof byCat.outputTokens === 'number' ? byCat.outputTokens : 0;
    return { inputTokens: used, outputTokens };
}

/**
 * ACP 通知的 `params.update` → StreamChunk 主映射。
 * 返回 null 表示该事件不产出内容（良性元数据 / 未知类型，静默不报警）。
 */
export function mapAcpEvent(update: unknown): StreamChunk | null {
    if (!isObject(update)) return null;
    const type = getString(update, 'sessionUpdate');
    switch (type) {
        case 'agent_message_chunk': {
            const text = getContentText(update);
            return text ? { type: 'text', content: text } : null;
        }
        case 'agent_thought_chunk': {
            const text = getContentText(update);
            return text ? { type: 'thinking', content: text } : null;
        }
        case 'tool_call': {
            const info = parseToolCall(update);
            if (!info) return null;
            return { type: 'tool', content: '', toolName: info.toolName, toolDetail: info.detail };
        }
        case 'tool_call_update':
            // 参数流式过程；由后续 tool_call（参数完整）出卡，这里静默
            return null;
        case 'usage_update': {
            const usage = extractUsage(update);
            return usage ? { type: 'text', content: '', usage } : null;
        }
        case 'session_end':
            return { type: 'done', content: '' };
        default:
            // config_option_update / available_commands_update / session_info_update /
            // plan / 未知类型 → 良性静默（不再打 [BB] unknown event 刷屏）
            return null;
    }
}
