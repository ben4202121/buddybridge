import { mapAcpEvent, parseToolCall, extractUsage } from '../../src/acp/events';

// fixture 形状来自真实抓包 .repro/acp_stream.jsonl（2026-09-07，codebuddy --acp default 模式）
const msgChunk = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '目录里只有一个文件' } };
const thoughtChunk = {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: '我先列出目录，再读取文件' },
    _meta: { 'codebuddy.ai/messageId': 'm1', 'codebuddy.ai/sourceEvent': { facets: ['reasoning'] } },
};
const usageEvt = {
    sessionUpdate: 'usage_update',
    used: 0,
    size: 1000000,
    _meta: { 'codebuddy.ai/usageByCategory': { systemPrompt: 0, conversation: 0, tools: 0, mcp: 0, skills: 0, version: 1 } },
};
const bashInProgress = {
    sessionUpdate: 'tool_call',
    toolCallId: 'chatcmpl-tool-b89d',
    title: 'Bash',
    kind: 'other',
    status: 'in_progress',
    input: {},
    rawInput: {},
    _meta: { 'codebuddy.ai/toolName': 'Bash', 'codebuddy.ai/requestId': 'r1' },
};
const bashArgsComplete = {
    sessionUpdate: 'tool_call',
    toolCallId: 'chatcmpl-tool-b89d',
    status: 'pending',
    rawInput: { command: 'ls -la', description: 'List files in current directory' },
    title: '`ls -la`',
    kind: 'execute',
    _meta: { 'codebuddy.ai/toolName': 'Bash', 'codebuddy.ai/toolArgumentsComplete': true },
};
const readArgsComplete = {
    sessionUpdate: 'tool_call',
    toolCallId: 'chatcmpl-tool-b592',
    status: 'pending',
    rawInput: { file_path: 'c:\\Temp\\sample.txt' },
    title: 'Read c:\\Temp\\sample.txt',
    kind: 'read',
    content: [] as unknown[],
    _meta: { 'codebuddy.ai/toolName': 'Read' },
};
const toolResult = {
    sessionUpdate: 'tool_call',
    toolCallId: 'chatcmpl-tool-b89d',
    status: 'pending',
    rawInput: { command: 'ls -la' },
    title: '`ls -la`',
    kind: 'execute',
    content: [{ type: 'content', content: { type: 'text', text: 'List files in current directory' } }],
    _meta: { 'codebuddy.ai/toolName': 'Bash', 'codebuddy.ai/toolArgumentsComplete': true },
};
const sessionEnd = { sessionUpdate: 'session_end' };

describe('mapAcpEvent 事件→StreamChunk 主映射', () => {
    it('agent_message_chunk → text chunk', () => {
        expect(mapAcpEvent(msgChunk)).toEqual({ type: 'text', content: '目录里只有一个文件' });
    });

    it('agent_thought_chunk → thinking chunk', () => {
        expect(mapAcpEvent(thoughtChunk)).toEqual({ type: 'thinking', content: '我先列出目录，再读取文件' });
    });

    it('usage_update → usage-only placeholder chunk（供 P2.5 用量条刷新）', () => {
        const chunk = mapAcpEvent(usageEvt);
        expect(chunk).toEqual({ type: 'text', content: '', usage: { inputTokens: 0, outputTokens: 0 } });
    });

    it('tool_call 参数完整 → tool chunk', () => {
        const chunk = mapAcpEvent(bashArgsComplete);
        expect(chunk).toEqual({ type: 'tool', content: '', toolName: 'Bash', toolDetail: '`ls -la`' });
    });

    it('tool_call 带工具名 title（Read）→ tool chunk', () => {
        const chunk = mapAcpEvent(readArgsComplete);
        expect(chunk).toEqual({ type: 'tool', content: '', toolName: 'Read', toolDetail: 'Read c:\\Temp\\sample.txt' });
    });

    it('session_end → done chunk', () => {
        expect(mapAcpEvent(sessionEnd)).toEqual({ type: 'done', content: '' });
    });

    it('tool_call_update（参数流式过程）→ 静默 null', () => {
        expect(mapAcpEvent({ sessionUpdate: 'tool_call_update', '0': { type: 'content', content: { type: 'text', text: '{"comm' } } })).toBeNull();
    });

    it('session_info_update（agentPhase）→ 静默 null', () => {
        expect(mapAcpEvent({ sessionUpdate: 'session_info_update', _meta: { 'codebuddy.ai/agentPhase': { phase: 'idle' } } })).toBeNull();
    });

    it('config_option_update / available_commands_update → 静默 null', () => {
        expect(mapAcpEvent({ sessionUpdate: 'config_option_update' })).toBeNull();
        expect(mapAcpEvent({ sessionUpdate: 'available_commands_update' })).toBeNull();
    });

    it('未知 sessionUpdate → 静默 null（不打 unknown 刷屏）', () => {
        expect(mapAcpEvent({ sessionUpdate: 'something_new' })).toBeNull();
    });

    it('非对象 / 空 → null', () => {
        expect(mapAcpEvent(null)).toBeNull();
        expect(mapAcpEvent('x')).toBeNull();
        expect(mapAcpEvent({})).toBeNull();
    });
});

describe('parseToolCall 工具卡解析', () => {
    it('参数完整（toolArgumentsComplete）→ 可展示', () => {
        const info = parseToolCall(bashArgsComplete as any);
        expect(info).toEqual({ toolName: 'Bash', detail: '`ls -la`', toolCallId: 'chatcmpl-tool-b89d' });
    });

    it('title 有信息（≠ 裸工具名）即使无 toolArgumentsComplete 也展示（Read）', () => {
        const info = parseToolCall(readArgsComplete as any);
        expect(info).toEqual({ toolName: 'Read', detail: 'Read c:\\Temp\\sample.txt', toolCallId: 'chatcmpl-tool-b592' });
    });

    it('in_progress 无参数（rawInput={}、title=工具名）→ null（等参数流完再出卡）', () => {
        expect(parseToolCall(bashInProgress as any)).toBeNull();
    });

    it('无 toolName → null', () => {
        expect(parseToolCall({ sessionUpdate: 'tool_call', toolCallId: 'x', rawInput: { a: 1 } } as any)).toBeNull();
    });

    it('无 toolCallId → null', () => {
        expect(parseToolCall({ sessionUpdate: 'tool_call', _meta: { 'codebuddy.ai/toolName': 'Bash' } } as any)).toBeNull();
    });

    it('detail 回退 rawInput JSON', () => {
        const info = parseToolCall({
            sessionUpdate: 'tool_call',
            toolCallId: 'c3',
            rawInput: { command: 'pwd' },
            title: 'Bash',
            _meta: { 'codebuddy.ai/toolName': 'Bash', 'codebuddy.ai/toolArgumentsComplete': true },
        } as any);
        expect(info && info.detail).toBe(JSON.stringify({ command: 'pwd' }));
    });
});

describe('extractUsage 用量提取', () => {
    it('used → inputTokens；usageByCategory.outputTokens → outputTokens', () => {
        const u = extractUsage({
            sessionUpdate: 'usage_update',
            used: 1234,
            size: 1000000,
            _meta: { 'codebuddy.ai/usageByCategory': { outputTokens: 56 } },
        } as any);
        expect(u).toEqual({ inputTokens: 1234, outputTokens: 56 });
    });

    it('无 usageByCategory → outputTokens 0', () => {
        expect(extractUsage({ sessionUpdate: 'usage_update', used: 5 } as any)).toEqual({ inputTokens: 5, outputTokens: 0 });
    });

    it('used 非法 → undefined', () => {
        expect(extractUsage({ sessionUpdate: 'usage_update' } as any)).toBeUndefined();
    });
});

