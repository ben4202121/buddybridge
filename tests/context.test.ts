import { buildPromptWithCurrentFile, buildPromptContext, buildDedupedPrompt, buildAttachedFilesText, encodeLineSeparators, type PromptContextState } from '../src/context';

// \u56fa\u5b9a\u6d4b\u8bd5\u8bed\u8a00\u4e3a\u4e2d\u6587\uff1a\u751f\u4ea7\u73af\u5883\u8bed\u8a00\u7531 Obsidian \u7684 localStorage['language'] \u51b3\u5b9a\uff0c
// node \u6d4b\u8bd5\u73af\u5883\u65e0 localStorage/navigator\uff08i18n \u9ed8\u8ba4\u56de\u843d\u82f1\u6587\uff09\uff0c\u663e\u5f0f mock \u4fdd\u8bc1\u65ad\u8a00\u786e\u5b9a\u6027\u3002
(global as any).localStorage = { getItem: (key: string) => (key === 'language' ? 'zh-CN' : null) };

const LS = '\u2028';

describe('buildPromptWithCurrentFile (当前文档感知)', () => {
    it('injects current note path above the user text', () => {
        const result = buildPromptWithCurrentFile('帮我总结', { path: '笔记/工作/周报.md' });
        expect(result).toBe('[系统注入·当前笔记: 笔记/工作/周报.md]\n\n帮我总结');
    });

    it('returns user text unchanged when no file is open', () => {
        expect(buildPromptWithCurrentFile('你好', null)).toBe('你好');
    });

    it('returns user text unchanged when path is empty', () => {
        expect(buildPromptWithCurrentFile('你好', { path: '' })).toBe('你好');
    });

    it('still wraps empty user text when a file is open', () => {
        expect(buildPromptWithCurrentFile('', { path: 'a.md' })).toBe('[系统注入·当前笔记: a.md]\n\n');
    });
});

describe('buildPromptContext (带开关的上下文注入, P2.6)', () => {
    it('injects nothing when both toggles are off', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: false, vaultContextInjection: false })).toBe('hi');
    });

    it('injects note path only when note toggle is on', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: true, vaultContextInjection: false })).toBe('[系统注入·当前笔记: a.md]\n\nhi');
    });

    it('injects vault context only when vault toggle is on', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: false, vaultContextInjection: true })).toBe('[系统注入·Vault: /vault]\n\nhi');
    });

    it('injects both lines in order', () => {
        expect(buildPromptContext({ userText: 'hi', notePath: 'a.md', vaultPath: '/vault', noteLinkInjection: true, vaultContextInjection: true })).toBe('[系统注入·当前笔记: a.md]\n[系统注入·Vault: /vault]\n\nhi');
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
        expect(r.text).toBe('[系统注入·当前笔记: a.md]\n\n你好');
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
        expect(r.text).toBe('[系统注入·当前笔记: b.md]\n\n总结');
    });

    it('does not re-inject unchanged vault across turns', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: '/vault' };
        const r = buildDedupedPrompt(state, state, 'hi', allOn);
        expect(r.text).toBe('hi');
    });

    it('injects vault change when vault path changes', () => {
        const r = buildDedupedPrompt({ notePath: null, vaultPath: '/old' }, { notePath: null, vaultPath: '/new' }, 'hi', allOn);
        expect(r.text).toBe('[系统注入·Vault: /new]\n\nhi');
    });

    it('prepends marker when the note is closed (non-null -> null)', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: null, vaultPath: null }, '继续', noteOnly);
        expect(r.text).toBe('[系统注入·当前笔记: 无]\n\n继续');
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

describe('P2.4 附加文件注入 (attached files)', () => {
    const marker = (p: string) => `[系统注入·附加文件: ${p}]`;
    const countMarker = (n: number) => `[系统注入·已附加 ${n} 个文件，请逐一阅读并全部纳入参考]`;
    const noteOnly = { noteLinkInjection: true, vaultContextInjection: false };
    const allOff = { noteLinkInjection: false, vaultContextInjection: false };

    it('buildAttachedFilesText: with content → marker + full text', () => {
        expect(buildAttachedFilesText([{ path: 'a.md', content: '正文' }])).toBe(`${marker('a.md')}\n正文`);
    });

    it('buildAttachedFilesText: without content (non-md) → marker only', () => {
        expect(buildAttachedFilesText([{ path: 'data.pdf' }])).toBe(marker('data.pdf'));
    });

    it('buildAttachedFilesText: blank content is treated as path-only', () => {
        expect(buildAttachedFilesText([{ path: 'a.md', content: '  ' }])).toBe(marker('a.md'));
    });

    it('buildAttachedFilesText: multiple files → path list only, content not stuffed (P2.4 多文件)', () => {
        const out = buildAttachedFilesText([
            { path: 'a.md', content: 'AA' },
            { path: 'b.md', content: 'BB' },
        ]);
        // 多文件：数量标记 + 逐一阅读指令 + 每个文件的路径标记；全文不注入
        expect(out).toBe(`${countMarker(2)}\n\n${marker('a.md')}\n${marker('b.md')}`);
        expect(out).not.toContain('AA');
        expect(out).not.toContain('BB');
    });

    it('buildAttachedFilesText: count hint with read-each instruction when >1 file (P2.4)', () => {
        const two = buildAttachedFilesText([
            { path: 'a.md' },
            { path: 'b.md' },
        ]);
        expect(two.startsWith('[系统注入·已附加 2 个文件，请逐一阅读并全部纳入参考]')).toBe(true);
        // 单文件不加数量提示，保留全文
        const one = buildAttachedFilesText([{ path: 'a.md', content: 'AA' }]);
        expect(one.startsWith('[系统注入·已附加')).toBe(false);
        expect(one).toBe(`${marker('a.md')}\nAA`);
    });

    it('buildAttachedFilesText: single file keeps full content, multi ignores it (P2.4)', () => {
        const single = buildAttachedFilesText([{ path: 'a.md', content: 'FULL' }]);
        expect(single).toBe(`${marker('a.md')}\nFULL`);
        // 同一个文件在多文件清单里只出现路径
        const multi = buildAttachedFilesText([
            { path: 'a.md', content: 'FULL' },
            { path: 'b.md', content: 'FULL2' },
        ]);
        expect(multi).not.toContain('FULL');
    });

    it('buildAttachedFilesText: no files → empty string', () => {
        expect(buildAttachedFilesText([])).toBe('');
    });

    it('buildPromptContext appends attached blocks after note/vault', () => {
        const out = buildPromptContext({
            userText: 'hi',
            notePath: 'a.md',
            noteLinkInjection: true,
            vaultContextInjection: false,
            attachedFiles: [{ path: 'b.md', content: 'BODY' }],
        });
        expect(out).toBe(`[系统注入·当前笔记: a.md]\n\n${marker('b.md')}\nBODY\n\nhi`);
    });

    it('buildDedupedPrompt injects attached even when note/vault unchanged', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: null };
        const r = buildDedupedPrompt(state, state, '继续', noteOnly, [{ path: 'b.md', content: 'B' }]);
        expect(r.text).toBe(`${marker('b.md')}\nB\n\n继续`);
    });

    it('buildDedupedPrompt re-injects attached on every turn (not deduped)', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: null };
        const attached = [{ path: 'b.md', content: 'B' }];
        const first = buildDedupedPrompt(null, state, '你好', noteOnly, attached);
        const second = buildDedupedPrompt(state, state, '继续', noteOnly, attached);
        expect(first.text).toContain(marker('b.md'));
        expect(second.text).toContain(marker('b.md'));
        expect(second.text).toContain('继续');
    });

    it('buildDedupedPrompt injects attached regardless of note/vault toggles', () => {
        const r = buildDedupedPrompt({ notePath: null, vaultPath: null }, { notePath: null, vaultPath: null }, 'hi', allOff, [{ path: 'x.bin' }]);
        expect(r.text).toBe(`${marker('x.bin')}\n\nhi`);
    });

    it('buildDedupedPrompt note change + attached → both injected', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: 'b.md', vaultPath: null }, 'hi', noteOnly, [{ path: 'c.md', content: 'C' }]);
        expect(r.text).toBe(`${marker('c.md')}\nC\n\n[系统注入·当前笔记: b.md]\n\nhi`);
    });
});

describe('P2.8 技能注入 (skillHint)', () => {
    const noteOnly = { noteLinkInjection: true, vaultContextInjection: false };
    const allOff = { noteLinkInjection: false, vaultContextInjection: false };
    const SKILL = '[系统注入·技能: pdf]';

    it('injects skillHint on every turn even when note/vault unchanged', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: null };
        const r = buildDedupedPrompt(state, state, '继续', noteOnly, [], SKILL);
        expect(r.text).toBe(`${SKILL}\n\n继续`);
    });

    it('skillHint prepended before attached files', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: null };
        const r = buildDedupedPrompt(state, state, 'hi', noteOnly, [{ path: 'f.md', content: 'F' }], SKILL);
        expect(r.text).toBe(`${SKILL}\n\n[系统注入·附加文件: f.md]\nF\n\nhi`);
    });

    it('empty skillHint does not change plain dedup behavior', () => {
        const state: PromptContextState = { notePath: 'a.md', vaultPath: null };
        const r = buildDedupedPrompt(state, state, 'hi', noteOnly, [], '');
        expect(r.text).toBe('hi');
    });

    it('first message (prev=null) injects skillHint above note context', () => {
        const r = buildDedupedPrompt(null, { notePath: 'a.md', vaultPath: null }, '你好', noteOnly, [], SKILL);
        expect(r.text).toBe(`${SKILL}\n\n[系统注入·当前笔记: a.md]\n\n你好`);
    });

    it('skillHint alone (no note) still injects regardless of toggles', () => {
        const r = buildDedupedPrompt(null, { notePath: null, vaultPath: null }, 'hi', allOff, [], SKILL);
        expect(r.text).toBe(`${SKILL}\n\nhi`);
    });

    it('skillHint + note change + attached all compose in order', () => {
        const r = buildDedupedPrompt({ notePath: 'a.md', vaultPath: null }, { notePath: 'b.md', vaultPath: null }, 'hi', noteOnly, [{ path: 'c.md', content: 'C' }], SKILL);
        expect(r.text).toBe(`${SKILL}\n\n[系统注入·附加文件: c.md]\nC\n\n[系统注入·当前笔记: b.md]\n\nhi`);
    });
});

describe('encodeLineSeparators (Windows cmd 换行编码, 传输截断修复)', () => {
    it('replaces LF with U+2028 line separator', () => {
        expect(encodeLineSeparators('第一行\n第二行')).toBe(`第一行${LS}第二行`);
    });

    it('replaces CRLF with a single U+2028', () => {
        expect(encodeLineSeparators('第一行\r\n第二行')).toBe(`第一行${LS}第二行`);
    });

    it('replaces CR with U+2028', () => {
        expect(encodeLineSeparators('第一行\r第二行')).toBe(`第一行${LS}第二行`);
    });

    it('leaves single-line text unchanged', () => {
        expect(encodeLineSeparators('帮我总结')).toBe('帮我总结');
    });

    it('leaves empty string unchanged', () => {
        expect(encodeLineSeparators('')).toBe('');
    });

    it('removes every real newline (transport-invariant: cmd truncates on LF)', () => {
        const out = encodeLineSeparators('[系统注入·当前笔记: a.md]\n\n问题\n多行');
        expect(out).not.toContain('\n');
        expect(out).not.toContain('\r');
        expect(out).toBe(`[系统注入·当前笔记: a.md]${LS}${LS}问题${LS}多行`);
    });

    it('preserves multi-line structure (N lines → N-1 separators)', () => {
        expect(encodeLineSeparators('a\nb\nc\nd').split(LS).length).toBe(4);
    });
});
