# BuddyBridge

> Connect Obsidian to the local WorkBuddy / CodeBuddy CLI — an AI chat assistant for your vault, with multi-turn streaming and tool calls.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **⚠️ Windows only.** macOS / Linux are not supported yet.
> **Requires Obsidian 1.7.2+.**

BuddyBridge is an unofficial Obsidian plugin that connects your vault to the local WorkBuddy / CodeBuddy CLI as an AI assistant in a side panel. It streams responses in real time, shows thinking steps and tool-call cards, injects your current note as context, and restores conversation history across restarts — your notes and chat stay inside Obsidian.

---

## Requirements

- **Obsidian 1.7.2 or later** (desktop).
- **Windows** (macOS / Linux are not supported yet).
- **A CodeBuddy CLI that can sign in independently on this machine.** Recommended: install the official standalone npm package `@tencent-ai/codebuddy-code` (provides the `codebuddy` / `cbc` commands), then run `codebuddy /login` once. The CLI **bundled inside WorkBuddy** (`resources\app.asar.unpacked\cli\bin\`) keeps its credentials tied to the WorkBuddy desktop process and is a partial (lite-WB) build that generally cannot launch on its own when spawned by a third-party host such as Obsidian — always prefer the standalone npm CLI.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/ben4202121/buddybridge/releases/latest).
2. Copy the three files into `.obsidian/plugins/buddybridge/` inside your vault.
3. Restart Obsidian.
4. Go to **Settings → Community plugins → Turn off Safe Mode → Enable BuddyBridge**.

### First-time setup

BuddyBridge needs a CodeBuddy CLI that can sign in independently. If the plugin detects the CLI is unusable, it shows a **"Configure CodeBuddy CLI"** banner at the top of the chat panel — click **Copy setup prompt**, then paste it into the WorkBuddy dialog and send it once. WorkBuddy will **install the official standalone CLI** (`@tencent-ai/codebuddy-code`) using its bundled Node and guide you through signing in — all you do is paste one message and authorize once.

> **Always use the standalone CLI for the chat to work.** WorkBuddy installs it via npm (`@tencent-ai/codebuddy-code`), then you sign in once (`codebuddy /login`). The WorkBuddy-bundled CLI is a partial (lite-WB) build that can't launch on its own when spawned by a host like Obsidian and will report `Cannot find module '../dist/codebuddy'` or `Authentication required` — that is the most common cause of errors. If the banner isn't available, install manually: `npm install -g @tencent-ai/codebuddy-code`, then `codebuddy /login`, and fill the **full `codebuddy.cmd` path** (not its folder) into **Settings → BuddyBridge → CodeBuddy path**.

## Usage

1. Click the **robot ribbon icon** or run the command **"BuddyBridge: Open chat panel"** from the command palette.
2. A chat panel opens in the right sidebar.
3. Type your message and press **Enter** to send. Use **Shift + Enter** to insert a new line.
4. Switch between conversations using the tabs at the top, or click **+** to start a new one.
5. Open **Settings → BuddyBridge** to configure the CodeBuddy CLI path manually if needed.

## Features

- AI chat panel in the Obsidian sidebar, with multi-turn local-assistant conversations
- Real-time streaming responses with thinking blocks and tool-call cards
- Collapsible thinking blocks and tool-call cards
- Markdown rendering for assistant messages (code, tables, lists, quotes)
- Vault-aware context injection (current note path is injected automatically)
- Current-note awareness: the active note's path is attached to each message
- Conversation persistence across Obsidian restarts
- Automatic CodeBuddy / Node.js path discovery on Windows
- Configurable CLI path in settings

## Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| `Cannot find codebuddy CLI` | Auto-detection failed | Fill the **CodeBuddy path** in plugin settings with the full `codebuddy.cmd` path (not its folder), or use WorkBuddy to install the standalone CLI |
| `Authentication required… /login` | The CLI isn't signed in (common with the bundled CLI, whose creds are tied to the desktop app) | Use the standalone CLI: let WorkBuddy install `@tencent-ai/codebuddy-code`, or run `npm install -g @tencent-ai/codebuddy-code` then `codebuddy /login` once |
| `Cannot find Node.js` | Node.js is not configured | Run the first-time environment setup prompt (Chinese section below) |
| Stuck on "Thinking..." | Streaming ended without text chunks | Fixed in v1.0.11 |

---

# 中文说明

> 将 Obsidian 连接到 WorkBuddy/CodeBuddy CLI，实现侧边栏 AI 聊天。

一个把 **CodeBuddy / WorkBuddy 接入 Obsidian 的 AI 聊天插件**：无需离开笔记，Vault 侧边栏内即可多轮问答、实时流式输出，自动显示思考过程与工具调用，并支持当前笔记上下文注入与会话历史恢复。

## 安装

1. 从 [latest release](https://github.com/ben4202121/buddybridge/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 复制到 Vault 目录下的 `.obsidian/plugins/buddybridge/`。
3. 重启 Obsidian。
4. 进入 **设置 → 第三方插件 → 关闭安全模式 → 开启 BuddyBridge**。

## 使用方法

1. 点击左侧的 **机器人图标**，或从命令面板运行 **"BuddyBridge: 打开聊天面板"**。
2. 右侧会打开聊天面板。
3. 输入消息后按 **Enter** 发送；**Shift + Enter** 换行。
4. 顶部标签可切换对话，点击 **+** 新建对话。
5. 如需手动指定 CodeBuddy CLI 路径，进入 **设置 → BuddyBridge**。

## 前置条件

1. 已安装 **Obsidian**（≥ 1.7.2），Windows 系统
2. 已安装**可独立登录的官方 CodeBuddy CLI**：推荐使用 WorkBuddy 帮你在 Obsidian 里完成一次配置（复制引导条里的配置提示词给 WorkBuddy 执行，它会用自带 Node 安装 `@tencent-ai/codebuddy-code` 并引导你登录）；或手动 `npm install -g @tencent-ai/codebuddy-code`，再执行一次 `codebuddy /login` 登录
3. WorkBuddy 桌面版（≥ 5.0.5）为**来源与宿主**：用户本就用 WorkBuddy 时，其自带的 node 可用来装独立 CLI。注意其**内置 CLI**（`resources\app.asar.unpacked\cli\bin\`）是 lite-WB 局部构建，凭据绑定桌面端、在 Obsidian 等第三方宿主中通常无法独立启动/认证——**请始终使用独立 CLI，不要依赖内置 CLI**

## 首次使用：环境初始化

BuddyBridge 需要一个可独立登录的 CodeBuddy CLI。若插件检测到 CLI 不可用，会在聊天面板顶部显示**「配置 CodeBuddy CLI」引导条**——点「复制配置提示词」→ 把提示词粘贴到 WorkBuddy 对话框执行一次即可。WorkBuddy 会**用其自带的 Node 安装官方独立 CLI**（`@tencent-ai/codebuddy-code`）并引导你完成登录，你只需在 WorkBuddy 里粘一段话 + 授权一次。

提示词核心步骤（插件引导条会给出完整版，此处供自包含参考）：

1. 用 WorkBuddy 自带的 Node（`~/.workbuddy/binaries/node/versions/*/node.exe`）确认 npm 可用；
2. `npm install -g @tencent-ai/codebuddy-code` 安装官方独立 CodeBuddy CLI；
3. 运行 `codebuddy /login`，引导用户用腾讯云账号完成一次登录（登录态落在 `~/.codebuddy`）；
4. （可选）给 Vault 配读写权限：插件设置里「一键授权」；
5. 把 `codebuddy.cmd` 的完整路径回报给用户/插件（通常 `C:\Users\<你>\AppData\Roaming\npm\codebuddy.cmd`）。

若你不想通过 WorkBuddy 引导，也可手动完成：`npm install -g @tencent-ai/codebuddy-code` → `codebuddy /login`（登录一次）→ 在插件**设置 → CodeBuddy 路径**里填 `codebuddy.cmd` 的**完整文件路径**（注意是 `.cmd` 文件本身，不是它所在的目录）。

完成后**完全重启 Obsidian**（系统托盘退出，不是只关窗口），BuddyBridge 即可正常使用。

## 功能

- Obsidian 侧边栏聊天面板，支持多轮对话
- 流式输出，实时显示文字
- 可折叠的思考过程与工具调用卡片
- Assistant 消息 Markdown 渲染（代码块、表格、列表、引用）
- 当前笔记感知：发送消息时自动注入当前打开笔记的路径
- 会话管理，重启后恢复对话历史
- CodeBuddy CLI 和 Node.js 路径自动发现
- 设置中可配置 CLI 路径

## 自动发现

插件启动时自动搜索以下位置：

| 搜索目标 | Windows 路径 |
|----------|-------------|
| WorkBuddy 安装 | `%LocalAppData%\Programs\WorkBuddy\...`、`%ProgramFiles%\WorkBuddy\...`、C/D/E 盘全覆盖 |
| npm 全局安装 | `%AppData%\npm\codebuddy.cmd`、`%ProgramFiles%\nodejs\...` |
| 系统 PATH | 遍历 `PATH` 中每个目录查找 `codebuddy.cmd` / `codebuddy.exe` |
| WorkBuddy 自带 Node | `~/.workbuddy/binaries/node/versions/*/` |
| 多盘符 Node | `C:\Program Files\nodejs`、D 盘、E 盘 |

> 注意：自动检测可能选中 **WorkBuddy 内置 CLI**，也可能选中 npm 全局的 `codebuddy`。前者凭据绑定桌面端、在 Obsidian 中通常无法独立认证（会报 `Authentication required`）。遇到时，请在设置中把 CLI 路径指向 **npm 独立安装**的 `codebuddy`（由 `@tencent-ai/codebuddy-code` 提供）。

## 故障排查

| 现象                          | 原因                       | 解决                         |
| --------------------------- | ------------------------ | -------------------------- |
| `找不到 codebuddy CLI`         | 自动检测未找到（如自定义安装路径） | 在插件设置中手动填写 `codebuddy.cmd` 的**完整路径**（非目录），或用 WorkBuddy 引导安装独立 CLI |
| `Authentication required`（提示 /login） | CLI 未登录（常见于用内置 CLI，其凭据绑定桌面端、无法在 Obsidian 独立认证） | 用独立 CLI：让 WorkBuddy 安装 `@tencent-ai/codebuddy-code`，或手动 `npm install -g @tencent-ai/codebuddy-code`，再执行一次 `codebuddy /login` |
| `找不到 Node.js 来运行 codebuddy` | Node.js 未正确配置            | 完成上方的「环境初始化」               |
| 一直显示「思考中」              | 流式结束未清理占位元素           | 已在 v1.0.11 修复                |
| 重启后对话丢失                 | chatView 未正确持有导致无法加载历史 | 已在 v1.0.11 修复                |

## 权限授权

插件需要 CodeBuddy 对 Vault 有读写权限才能正常工作。

**推荐直接用插件自带的「一键授权」**：Obsidian → 设置 → BuddyBridge →「文件访问授权」→「一键授权」。插件会把 Vault 路径写入 `~/.codebuddy/settings.json` 的 `trustedDirectories` 与 `permissions.allow`（只补充、不覆盖现有配置）。

> 提示：以上「一键授权」配置的是独立 CodeBuddy CLI 的 `~/.codebuddy/settings.json`。若你用 WorkBuddy 桌面版，需区分 `.codebuddy`（CodeBuddy CLI）与 `.workbuddy`（WorkBuddy 桌面版）两个不同配置文件——BuddyBridge 走的是 CodeBuddy CLI，必须配置 `.codebuddy`。

仅当按钮不可用时，可将 `提示词-发给workbuddy让它给buddybridge授权.md` 的完整内容发送给 WorkBuddy/CodeBuddy 执行。完成后**完全退出** WorkBuddy/CodeBuddy（系统托盘右键退出），重新打开即可生效。

## Settings / 设置

The settings page is grouped into four sections:

- **Connection** — CodeBuddy path, optional Node path, CLI timeout (seconds, default 300)
- **Context injection** — inject current note link (default on), inject vault context (default off)
- **Appearance** — primary accent color
- **Management** — max conversations, export/import settings (including chat history, versioned JSON), reset to defaults

| Setting | Description | Default |
| --- | --- | --- |
| CodeBuddy 路径 | CLI 可执行文件路径（留空自动检测） | 自动 |
| Node 路径（可选） | 手动指定 node.exe（留空自动检测） | 自动 |
| CLI 超时时长（秒） | 请求超时后自动终止并提示 | 300 |
| 注入当前笔记链接 | 发送时附加 `[当前笔记: 路径]` | 开 |
| 注入 Vault 上下文 | 额外附加 `[Vault: 路径]` | 关 |
| 最大对话数 | 最多保留多少个对话 | 20 |
| 导出/导入设置 | 备份或迁移设置 + 聊天记录（带版本号 JSON） | — |
| 重置为默认 | 恢复默认设置（保留聊天记录，需确认） | — |

## 开发

```bash
npm run dev    # 开发构建
npm run build  # 生产构建
npm test       # 运行测试
```

## 许可证

MIT
