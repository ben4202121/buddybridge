// ==================== 档 1「无感初始化」内置提示词（P 2026-10-15） ====================
//
// 目标：用户从 Obsidian 市场装 BuddyBridge 后，不被「读文档 / 学命令行 / 理解两个账户关联」
// 拦在门外。插件在「未就绪」时弹引导条，用户点「复制初始化提示词」→ 粘到 WorkBuddy 执行。
//
// 两份内容严格分离：
// - 本文件的 BUILTIN_INIT_PROMPT = 给 WorkBuddy 的纯执行指令（用户不看内容，只点复制）；
// - 给用户的操作指引（复制、粘到哪、重启…）放在引导 UI（src/views/chat.ts 的 initBanner），
//   绝不同段混写——否则 WorkBuddy 读到用户引导会跑偏、用户打开提示词看到一堆无关执行说明。
//
// 边界（不对用户承诺零操作）：
// - 交互式登录 /login 一步 WorkBuddy 无法代替用户完成（需用户本人腾讯云账号在浏览器授权）；
// - 可委托替代路径：用户若已有 API Key，WorkBuddy 可代跑 setx CODEBUDDY_API_KEY，跳过交互登录。
//
// v3 修订（2026-10-16，依据 WorkBuddy「BuddyBridge初始化复盘与提示词v2」逐条采纳）：
// 核心收敛目标 = 让 WorkBuddy 少做无用功、把验证做真、第一时间交付两条路径。
// 1. 顶部加「执行原则」：交付物前置（两条路径一算出来就贴用户）、验证要真不要假、
//   不越权（登录不能代劳）——三句话兜住执行风格。
// 2. 「已知陷阱」前置到步骤之前（尤其环境变量污染 CODEBUDDY_CONFIG_DIR → 验证登录假阴性）：
//   告诉 WorkBuddy「验证登录一律读日志 userId changed，别反复跑 CLI 会被污染骗」——这是本次
//   卡很久、做多余的根因。
// 3. 第 3 步改用 `prefix -g` 动态取全局前缀(复盘#1)：机器可能没有系统 npm，CLI 落在
//   `.workbuddy` 下，硬编码 %APPDATA%\npm 会取错。取到即立刻交付两个地址，不等最后。
// 4. 登录加 5 分钟授权窗口警告 + 独立终端要求 + 端口占用 --port 说明（复盘坑2/3）。
// 5. 明确「不要预填插件 data.json」——运行中的插件会用内存空值覆写（复盘坑4）。
// 6. %VAR% 路径给出 Git Bash 转换提示（复盘#9）。

/** 内置提示词版本号：随改随 +1，便于区分不同版本插件用的提示词（进诊断/设置显示）。 */
export const BUILTIN_PROMPT_VERSION = '3';

/**
 * 内置初始化提示词全文（复制给 WorkBuddy 执行）。
 * 只保留 WorkBuddy 可自主执行的指令序列，去掉「给作者/调试」段落与「对用户交代」旁白。
 */
export const BUILTIN_INIT_PROMPT = `请为这台电脑的 Obsidian BuddyBridge 插件完成环境初始化。BuddyBridge 依赖官方独立的 CodeBuddy CLI。请按以下步骤执行并实际验证，不要跳过验证。

## ⚠️ 执行原则（先读这条，全流程都要遵守）

1. **交付物前置。** 你的首要交付物是**两条绝对路径**：CodeBuddy 路径（真实 JS 入口）与 Node 路径。每完成一步，**立刻把该步产出贴给用户**，不要憋到最后才给。用户要的是能直接复制粘贴的东西。
2. **验证要真、不要假。** 下方的「已知陷阱」列了几个会让你**得出错误结论**的坑，尤其是 \`CODEBUDDY_CONFIG_DIR\` 环境变量污染。在判断"登录失败了/被阻塞了"之前，先确认自己不是被环境污染骗了。**验证登录优先读日志，别反复跑 CLI 实测。**
3. **不要越权。** \`/login\` 必须用户本人在浏览器完成，你无法代劳，也不要尝试绕开。

## 已知陷阱（会导致错误结论，先读完再动手）

- **陷阱 A（最致命）：环境变量污染 → 验证登录假阴性。** WorkBuddy 给自己派生的**所有**进程注入 \`CODEBUDDY_CONFIG_DIR=C:\\Users\\<用户>\\.workbuddy\`。你通过工具启动 CLI 会继承它，于是 CLI 去 \`.workbuddy\` 读登录态，而用户实际登录写在 \`.codebuddy\` —— **恒定报 "Authentication required"，这是假阴性，不是真失败**。**对策：验证登录一律读日志（见第 4 步），不要因 CLI 报没登录就以为是失败。**
- **陷阱 B：不要用 grep 找 token 判断登录。** CLI 不把 accessToken 以明文落盘在 \`.codebuddy\`，\`grep token\`/\`grep eyJ\` 必然是空（又一次假阴性）。**认日志里的 \`userId changed\`。**
- **陷阱 C：残留 CLI 进程占默认端口 51773。** 旧 CLI 窗口不关就一直占着，报 \`EADDRINUSE\`。所有 CLI 命令显式带 \`--port <空闲端口>\`。
- **陷阱 D：\`/login\` 浏览器授权有 5 分钟窗口。** 用户慢一点就超时，登录作废得重来。务必提醒用户尽快完成授权。
- **陷阱 E：不要预填插件 \`data.json\`。** 运行中的插件会用内存空值覆写回文件，你预填会被冲掉。**引导用户在 UI 手工粘贴**最可靠。

---

第 1 步：定位 WorkBuddy 自带的 Node.js
依次检查（找到即停）：
- %USERPROFILE%\\.workbuddy\\binaries\\node\\versions\\*\\node.exe
- %LOCALAPPDATA%\\Programs\\WorkBuddy\\..\\..\\binaries\\node\\versions\\*\\node.exe
- C:\\Program Files\\WorkBuddy\\..\\..\\binaries\\node\\versions\\*\\node.exe
记下刚找到的 node.exe 绝对路径为 <NODE>（插件可直接用，无需进系统 PATH）。运行 "<NODE>" --version 确认 ≥ 18.20.8。
> Git Bash 下 \`%VAR%\` 要写成 \`$VAR\`，注意转换。
> ➡️ **立刻回报 <NODE> 完整路径给用户。** 这是要填进插件的两个地址之一。

第 2 步：确认 npm 可用
检查 <NODE> 所在目录下是否有 node_modules\\npm\\bin\\npm-cli.js：
- 存在 → 记 <NPM_CLI>，运行 "<NODE>" "<NPM_CLI>" --version 确认版本号；
- 不存在 → 找系统 npm：%APPDATA%\\npm\\npm.cmd 或 C:\\Program Files\\nodejs\\npm.cmd，找到记 <NPM_CMD> 并运行 "<NPM_CMD>" --version 验证。
⚠️ 不要用 "<NODE>" -e "console.log(require('npm/package.json').version)" —— 会因模块路径解析失败误报 npm 不可用（假阴性）。

第 3 步：安装官方独立 CodeBuddy CLI，并定位真实 JS 入口
用上一步的 npm 全局安装：
- 有 <NPM_CMD> → "<NPM_CMD>" install -g @tencent-ai/codebuddy-code
- 只有 <NPM_CLI> → "<NODE>" "<NPM_CLI>" install -g @tencent-ai/codebuddy-code
安装耗时可能几分钟，建议后台执行并把日志写到临时文件。
**然后，不要假设路径——动态取全局前缀：**
"<NODE>" "<NPM_CLI>" prefix -g   (有 <NPM_CMD> 则用 "<NPM_CMD>" prefix -g)
记输出为 <PREFIX>，则 <CLI_JS> = <PREFIX>\\node_modules\\@tencent-ai\\codebuddy-code\\bin\\codebuddy
⚠️ 不要硬编码 %APPDATA%\\npm：本机可能没有系统 npm，全局前缀会落在 WorkBuddy 自带 node 目录下（如 C:\\Users\\<用户>\\.workbuddy\\binaries\\node\\versions\\<ver>）。用 prefix -g 拿到的才是真实路径。
⚠️ <CLI_JS> 是**无扩展名的 JS 脚本**，不是 codebuddy.cmd，也不是 .exe。
验证："<NODE>" "<CLI_JS>" --version，应输出版本号（如 2.167.x）。
⚠️ 不要用 C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy —— 那是残缺的 lite 构建（缺 dist/codebuddy），在 Obsidian 里无法独立启动，会报 Cannot find module '../dist/codebuddy'。只认独立安装的那份。
> ➡️ **立刻把 <CLI_JS> 完整路径贴给用户。到这一刻，最终要填的两个地址都已齐备，请明确告诉用户现在就可以去 Obsidian 填了。**

第 4 步：完成 CLI 登录（必须用户本人）
运行 "<NODE>" "<CLI_JS>" /login，引导用户用腾讯云账号完成登录（会弹浏览器或给设备码）。**必须在独立终端里跑**（PowerShell / Windows Terminal），不要用 WorkBuddy 内置终端（那里面注入了沙箱代理和 CODEBUDDY_CONFIG_DIR，会干扰认证）。
⚠️ 关键约束，原样告知用户：
1. 浏览器授权必须在 **5 分钟**内完成，否则 CLI 报 TimeoutError 并作废本次登录；
2. 授权后**不要关终端**，等它自己打印成功；
3. 若报 EADDRINUSE ... 51773，改用 /login --port <空闲端口>。
（若用户已有 API Key，可改用 setx CODEBUDDY_API_KEY "<key>"，此方式你能代劳。）
**验证登录（重要）：优先用日志，比跑 CLI 可靠。** 查看 %USERPROFILE%\\.codebuddy\\logs\\<日期>\\<用户>__*.log，搜 \`userId changed:  -> <uuid>\`。出现有效 uuid = 登录成功。**不要跑 CLI 实测去验证登录（会被环境污染骗成假阴性）。**

第 5 步：给 Vault 配置读写权限（优先用插件自带「一键授权」）
优先提示用户：Obsidian → 设置 → BuddyBridge → 文件访问授权 → 一键授权 → 确认（插件会把 Vault 写入 %USERPROFILE%\\.codebuddy\\settings.json 的 trustedDirectories 与 permissions.allow，只补充不覆盖）。
BuddyBridge 以「LLM Wiki」技能为核心用途，该技能需要 Bash 权限，因此一键授权写入的权限集包含 Bash 是正常且必需的——请放心授权，不要收紧。
仅当插件按钮不可用时才手工写入，要求：编码无 BOM 的 UTF-8；保留已有字段只补缺失；只信任 Vault 路径。参考 JSON（allow 须含 Bash 以匹配 LLM Wiki 需求）：{ "trustedDirectories": ["<VAULT_PATH>"], "permissions": { "allow": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"] } }，其中 <VAULT_PATH> 用正斜杠。不要把整个用户家目录加入 trustedDirectories。
> 注：若用户曾在家目录手动跑过 CLI，trustedDirectories 里会被 CLI 自动加上家目录（cwd 自动信任）。那是 CLI 加的，不是插件，清理掉即可。

第 6 步：协助用户把两个地址填进插件设置
**明确回报这两条，引导填入 Obsidian → 设置 → BuddyBridge：**
- CodeBuddy 路径 → <CLI_JS>
- Node 路径（可选，推荐填）→ <NODE>
⚠️ 不要填 codebuddy.cmd：它依赖系统 PATH 里的 node，而 WorkBuddy 自带 node 不在 PATH，填它一启动就报 "node 不是内部或外部命令"。
⚠️ 不要尝试写插件 data.json 预填：运行中的插件会用内存空值覆写，预填会被冲掉。**引导用户在 UI 手工粘贴**最可靠。
填好后让用户完全退出并重启 Obsidian。

第 7 步：回报
- 环境就绪 → 「环境初始化完成，BuddyBridge 已可正常使用。请在 Obsidian → 设置 → BuddyBridge 填入 CodeBuddy 路径与 Node 路径，然后完全重启 Obsidian。」
- 需用户操作 → 「还需要你在 <具体步骤> 完成 <某操作>（例如完成一次登录）。」
- 无法自动解决的报错 → 原样回报报错文本，并提示可联系 BuddyBridge 作者协助排查。`;

/**
 * 判定「未就绪」的错误关键词。当 CLI 会话失败消息命中任一关键词，即判定插件「未就绪」，
 * 驱动引导条显隐（被动触发：不做主动 spawn 探测，只在失败时上引导条）。
 */
export const INIT_READY_KEYWORDS: string[] = [
    'dist/codebuddy',
    'MODULE_NOT_FOUND',
    'Authentication required',
    'AuthenticationRequired',
    'Please use /login',
    // 全新环境 / 未配置时 resolveCodebuddyPath 返回兜底 'codebuddy'，spawn ENOENT → 「找不到 codebuddy CLI」
    // 这正是「环境未就绪、该引导初始化」的最典型信号，必须弹引导条让用户走 WorkBuddy 初始化。
    '找不到 codebuddy',
];

/**
 * 判定某条 CLI 会话失败消息是否属于「未就绪」类，应弹初始化引导条。
 * 除 INIT_READY_KEYWORDS 外，还覆盖 `.cmd` shim 找不到 node 的场景：
 * codebuddy.cmd 内部靠系统 PATH 执行 `node …`，而 WorkBuddy 自带 node 不在 PATH → 报
 * "'node' 不是内部或外部命令"（中文 GBK 解码后可能乱码，但 `node` 与「内部或外部命令」锚点仍在）。
 * 这类错误不是「没装 Node」，而是插件用了 .cmd 却没配独立 node 路径，正该引导去做独立 CLI 初始化。
 */
export function shouldShowInitBanner(errorMsg: string): boolean {
    if (INIT_READY_KEYWORDS.some((k) => errorMsg.includes(k))) return true;
    // `.cmd` shim 找不到 node 的场景：codebuddy.cmd 内部靠系统 PATH 执行 `node …`，而
    // WorkBuddy 自带 node 不在 PATH → 报 "'node' 不是内部或外部命令"。
    // 中文 Windows 下该文本是 GBK，经插件 base 层按 UTF-8 解码成乱码（含 U+FFFD 替换符），
    // 英文系统则是 "not recognized"。判定条件：错误里出现 node 字样 + 明确的「命令找不到」语义。
    if (/(?:['"]node["']|node(?:\.exe)?\s*)/.test(errorMsg)
        && /(?:不是内部或外部命令|not recognized|isn't recognized|�)/i.test(errorMsg)) {
        return true;
    }
    return false;
}