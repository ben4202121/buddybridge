import { buildPromptWithCurrentFile, buildPromptContext, buildDedupedPrompt, type PromptContextState } from '../src/context';

describe('buildPromptWithCurrentFile (当前文档感知)', () => {
    it('injects current note path above the user text', () => {
        const result = buildPromptWithCurrentFile('帮我总结', { path: '笔记/工作/周报.md' });
        expect(result).toBe('[当前笔记: 笔记/工作/周报.md]\n\n帮我总结');
    });

    it('returns user text unchanged when no file is open', () => {
        expect(buildPromptWithCurrentFile('你好', null)).toBe('你好');
    });

    it('returns user text unchanged when path is empty', () => {
        expect(buildPromptWithCurrentFile('你好', { path: '' })).toBe('你好');
    });

    it('still wraps empty user text when a file is open', () => {
        expect(buildPromptWithCurrentFile('', { path: 'a.md' })).toBe('[当前笔记: a.md]\n\n');
    });
});

describe('buildPromptContext (带开关的上下文注入, P2.6)', () => {
    it('injects nothing when both toggles are off', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: false, vaultContextInjection: false })).toBe('hi');
    });

    it('injects note path only when note toggle is on', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: true, vaultContextInjection: false })).toBe('[当前笔记: a.md]\n\nhi');
    });

    it('injects vault context only when vault toggle is on', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: false, vaultContextInjection: true })).toBe('[Vault: /vault]\n\nhi');
    });

    it('injects both lines in order', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: true, vaultContextInjection: true })).toBe('[当前笔记: a.md]\n[Vault: /vault]\n\nhi');
    });

    it('ignores missing note/vault paths even when toggles are on', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: null, vaultPath: null, noteLinkInjection: true, vaultContextInjection: true })).toBe('hi');
    });

    it('wrapper buildPromptWithCurrentFile behaves like note-only injection', () => {
        expect(buildPromptWithCurrentFile('hi', { path: 'a.md' })).toBe(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: null, noteLinkInjection: true, vaultContextInjection: false }));
    });
});

describe('buildDedupedPrompt (会话内上下文去重)', () => {
    const noteOnly = { noteLinkInjection: true, vaultContextInjection: false };
    const allOn = { noteLinkInjection: true, vaultContextInjection: true };
    const allOff = { noteLinkInjection: false, vaultContextInjection: false };

    it('injects full context on first message (prev=null)', () => {
        const r = buildDedupedPrompt(null, { notePath: 'a.md', vaultPath: null }, '你好', noteOnly);
        expect(r.text).toBe('[当前笔记: a.md]\n\n你好');
        expect(r.state).toEqual({ notePath: 'a.md', vaultPath: null });
    });

    it('returns plain text when context is unchanged', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: null };
        const r = buildDedupedPrompt(state, state, '总结下这篇文章', noteOnly);
        expect(r.text).toBe('总结下这篇文章');
        expect(r.state).toEqual(state);
    });

    it('injects new note path only when the note changes', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: 'b.md', vaultPath: null }, '总结', noteOnly);
        expect(r.text).toBe('[当前笔记: b.md]\n\n总结');
    });

    it('does not re-inject unchanged vault across turns', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: '/vault' };
        const r = buildDedupedPrompt(state, state, 'hi', allOn);
        expect(r.text).toBe('hi');
    });

    it('injects vault change when vault path changes', () => {
        const r = buildDedupedPrompt({ notePath: null, vaultPath: '/old' }, { notePath: null, vaultPath: '/new' }, 'hi', allOn);
        expect(r.text).toBe('[Vault: /new]\n\nhi');
    });

    it('prepends marker when the note is closed (non-null -> null)', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: null, vaultPath: null }, '继续', noteOnly);
        expect(r.text).toBe('[当前笔记: 无]\n\n继续');
    });

    it('no marker when note was already null', () => {
        const state: PromptContextState = { notePath: null, vaultPath: null };
        const r = buildDedupedPrompt(state, state, '继续', noteOnly);
        expect(r.text).toBe('继续');
    });

    it('returns plain text when toggles are off even on context change', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: null, vaultPath: null }, 'hi', allOff);
        expect(r.text).toBe('hi');
    });

    it('does not add marker when note closes but toggle is off', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: null, vaultPath: null }, 'hi', allOff);
        expect(r.text).toBe('hi');
    });
});
