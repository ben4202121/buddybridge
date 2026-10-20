import { BUILTIN_INIT_PROMPT, BUILTIN_PROMPT_VERSION, INIT_READY_KEYWORDS, shouldShowInitBanner } from '../src/init-prompt';

describe('init-prompt（档 1 无感初始化内置提示词）', () => {
    it('BUILTIN_PROMPT_VERSION 为稳定版本字符串', () => {
        expect(BUILTIN_PROMPT_VERSION).toMatch(/^\d+$/);
    });

    it('内置提示词非空且指向 CodeBuddy CLI 配置', () => {
        expect(BUILTIN_INIT_PROMPT.length).toBeGreaterThan(200);
        expect(BUILTIN_INIT_PROMPT).toContain('BuddyBridge');
        expect(BUILTIN_INIT_PROMPT).toMatch(/为.*Obsidian BuddyBridge 插件完成.*环境初始化/);
    });

    it('内置提示词：走独立 CLI + WorkBuddy 自带 node 安装，引导登录', () => {
        expect(BUILTIN_INIT_PROMPT).toContain('/login');
        expect(BUILTIN_INIT_PROMPT).toContain('@tencent-ai/codebuddy-code');
        expect(BUILTIN_INIT_PROMPT).toContain('codebuddy.cmd');
        expect(BUILTIN_INIT_PROMPT).toMatch(/\.workbuddy\\binaries\\node/);
        expect(BUILTIN_INIT_PROMPT).toMatch(/第 1 步.*第 7 步/s);
    });

    it('v2：回报「两个地址」（CodeBuddy 路径=JS 入口 + Node 路径=node.exe），而非仅 .cmd', () => {
        // 关键收尾：WorkBuddy 替用户算好两条绝对路径，避免用户自己找
        expect(BUILTIN_INIT_PROMPT).toContain('CodeBuddy 路径');
        expect(BUILTIN_INIT_PROMPT).toContain('Node 路径');
        expect(BUILTIN_INIT_PROMPT).toContain('@tencent-ai\\codebuddy-code\\bin\\codebuddy');
        expect(BUILTIN_INIT_PROMPT).toMatch(/CodeBuddy 路径.*CLI_JS.*Node 路径.*NODE/s);
        // 明确不要填 codebuddy.cmd（依赖系统 PATH 的 node，WorkBuddy 自带 node 不在 PATH）
        expect(BUILTIN_INIT_PROMPT).toMatch(/不要填 codebuddy\.cmd/);
        expect(BUILTIN_INIT_PROMPT).toMatch(/node 不是内部或外部命令/);
    });

    it('v2：第 2 步排除 npm 假阳性检测法（require npm/package.json），改用文件存在性', () => {
        // WorkBuddy 实测：require('npm/package.json') 在内置 node 下路径解析失败 → 假阴性
        expect(BUILTIN_INIT_PROMPT).toMatch(/不要用.*require\('npm\/package\.json'\)/);
        expect(BUILTIN_INIT_PROMPT).toContain('node_modules\\npm\\bin\\npm-cli.js');
    });

    it('v2：预警 WorkBuddy 内置 CLI 是残缺 lite 构建，不可用', () => {
        expect(BUILTIN_INIT_PROMPT).toContain('lite 构建');
        expect(BUILTIN_INIT_PROMPT).toMatch(/Cannot find module '\.\.\/dist\/codebuddy'/);
        expect(BUILTIN_INIT_PROMPT).toContain('app.asar.unpacked\\cli\\bin\\codebuddy');
    });

    it('v2/v3：说明登录不能代劳，但 API Key 可委托（setx 方式）', () => {
        // v3 把「登录不能代劳」并入「不要越权」执行原则，措辞为「/login 必须用户本人」
        expect(BUILTIN_INIT_PROMPT).toMatch(/login/);
        expect(BUILTIN_INIT_PROMPT).toMatch(/必须用户本人/);
        expect(BUILTIN_INIT_PROMPT).toMatch(/CODEBUDDY_API_KEY/);
        expect(BUILTIN_INIT_PROMPT).toMatch(/此方式你能代劳/);
    });

    it('v3：模板体内的内联反引号正确渲染为单反引号，无转义残留', () => {
        // 曾踩坑：模板字面量里误写裸 ` 或同被双重转义 \\`，导致要么编译失败要么运行时出现脏反斜杠。
        // 期望：内联代码（如 `userId changed`、`CODEBUDDY_CONFIG_DIR`）渲染后是干净的单个反引号。
        expect(BUILTIN_INIT_PROMPT).toContain('`userId changed`');
        expect(BUILTIN_INIT_PROMPT).toContain('`CODEBUDDY_CONFIG_DIR`');
        // 不要出现「反斜杠 + 反引号」的脏序列（说明被双重转义残留在运行时字符串里）。
        expect(BUILTIN_INIT_PROMPT).not.toMatch(/\\\\`/);
        expect(BUILTIN_INIT_PROMPT).not.toMatch(/\\`\w/);
    });

    it('v2：权限参考 JSON 含 Bash（匹配 LLM Wiki 核心用途）', () => {
        // 用户确认用 LLM Wiki → LLM_WIKI_PERMISSIONS 含 Bash，参考 JSON 须一致，否则 isVaultAuthorized 判未授权
        expect(BUILTIN_INIT_PROMPT).toMatch(/一键授权写入的权限集包含 Bash/);
        expect(BUILTIN_INIT_PROMPT).toMatch(/\"allow\": \[\"Read\", \"Write\", \"Edit\", \"Glob\", \"Grep\", \"Bash\"\]/);
    });

    it('INIT_READY_KEYWORDS 覆盖最常见根因报错（能驱动引导条触发）', () => {
        // 纯逻辑判定：这是 getErrorHint → showInitBanner 触发链的判据
        const realErrors = [
            "Cannot find module '../dist/codebuddy'",
            'Error: Cannot find module "../dist/codebuddy"',
            'MODULE_NOT_FOUND',
            'Authentication required. Please use /login command to sign in to your account',
            'Some error mentioning AuthenticationRequired',
        ];
        for (const err of realErrors) {
            expect(INIT_READY_KEYWORDS.some((k) => err.includes(k))).toBe(true);
        }
    });

    it('INIT_READY_KEYWORDS 不会误命中普通错误', () => {
        const unrelated = ['Request timed out', 'ENOENT: no such file', 'exec: node not found'];
        for (const err of unrelated) {
            expect(INIT_READY_KEYWORDS.some((k) => err.includes(k))).toBe(false);
        }
    });

    it('shouldShowInitBanner：命中 INIT_READY_KEYWORDS（CLI 未就绪）', () => {
        const gen = ["Cannot find module '../dist/codebuddy'", 'MODULE_NOT_FOUND', 'Authentication required. Please use /login', 'Some error mentioning AuthenticationRequired'];
        for (const err of gen) expect(shouldShowInitBanner(err)).toBe(true);
    });

    it('shouldShowInitBanner：命中「找不到 codebuddy CLI」（全新未配置环境）', () => {
        // resolveCodebuddyPath 返回兜底 'codebuddy' → spawn ENOENT → 报这条；正是该引导初始化的信号
        const msgs = ['找不到 codebuddy CLI。请确认已安装 WorkBuddy 桌面版，或在插件设置中指定 codebuddy 路径。'];
        for (const err of msgs) expect(shouldShowInitBanner(err)).toBe(true);
    });

    it('shouldShowInitBanner：命中 .cmd shim 找不到 node（中文 / 英文 / 乱码残余锚点）', () => {
        // 这些是 style="GET_SHOW">codebuddy.cmd 调 node 时系统 PATH 无 node 的典型报错，
        // 均属「未配独立 node 路径」而非「没装 Node」，应引导去做独立 CLI 初始化
        const cmds = [
            "'node' 不是内部或外部命令，也不是可运行的程序",
            '"node" 不是内部或外部命令',
            "'node' is not recognized as an internal or external command",
            "'node' is not recognized",
        ];
        for (const err of cmds) expect(shouldShowInitBanner(err)).toBe(true);
    });

    it('shouldShowInitBanner：node + GBK 乱码（U+FFFD 替换符）也命中', () => {
        // 中文 Windows 下 cmd 输出 GBK，经 UTF-8 解码出 U+FFFD；node 字样仍可识别
        const gbk = '\'node\' ��������';
        expect(shouldShowInitBanner(gbk)).toBe(true);
    });

    it('shouldShowInitBanner：node 但非 shim 类错误不误触发', () => {
        const unrelated = ['exec: node not found', 'Node.js is not configured', 'Requires node >= 18', 'node_modules is missing'];
        for (const err of unrelated) expect(shouldShowInitBanner(err)).toBe(false);
    });
});