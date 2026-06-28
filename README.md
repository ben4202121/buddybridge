# BuddyBridge

> Connect Obsidian to WorkBuddy/CodeBuddy CLI for AI chat.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **⚠️ Windows only.** macOS / Linux are not supported yet.

BuddyBridge is an unofficial Obsidian plugin that bridges your vault with the local WorkBuddy / CodeBuddy CLI. It opens a chat panel inside Obsidian, streams AI responses, displays thinking steps and tool calls, and keeps your conversation history across sessions.

---

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/ben4202121/buddybridge/releases/latest).
2. Copy the three files into `.obsidian/plugins/buddybridge/` inside your vault.
3. Restart Obsidian.
4. Go to **Settings → Community plugins → Turn off Safe Mode → Enable BuddyBridge**.

### First-time setup

If BuddyBridge cannot find CodeBuddy or Node.js automatically, follow the environment setup prompt once (see the Chinese section below or open `提示词-发给workbuddy让它给buddybridge授权.md`).

## Usage

1. Click the **robot ribbon icon** or run the command **"BuddyBridge: Open chat panel"** from the command palette.
2. A chat panel opens in the right sidebar.
3. Type your message and press **Enter** to send. Use **Shift + Enter** to insert a new line.
4. Switch between conversations using the tabs at the top, or click **+** to start a new one.
5. Open **Settings → BuddyBridge** to configure the CodeBuddy CLI path manually if needed.

## Features

- Chat panel in Obsidian sidebar with multi-turn conversations
- Streaming responses in real time
- Collapsible thinking blocks and tool-call cards
- Markdown rendering for assistant messages (code, tables, lists, quotes)
- Vault-aware context injection
- Conversation persistence across Obsidian restarts
- Automatic CodeBuddy / Node.js path discovery on Windows
- Configurable CLI path in settings

## Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| `Cannot find codebuddy CLI` | Auto-detection failed | Fill the **CodeBuddy path** in plugin settings. Default location: `WorkBuddyInstallDir\resources\app.asar.unpacked\cli\bin\codebuddy` |
| `Cannot find Node.js` | Node.js is not configured | Run the first-time environment setup prompt (Chinese section below) |
| Stuck on "Thinking..." | Streaming ended without text chunks | Fixed in v1.0.11 |

---

# 中文说明

> 将 Obsidian 连接到 WorkBuddy/CodeBuddy CLI，实现侧边栏 AI 聊天。

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

1. 已安装 **WorkBuddy 桌面版**（≥ 5.0.5）
2. 已安装 **Obsidian**（≥ 1.5.0）

## 首次使用：环境初始化

如果插件无法自动找到 CodeBuddy 或 Node.js，将以下提示词**完整复制**到 WorkBuddy 对话中执行一次即可：

---

请帮我配置 BuddyBridge 插件的运行环境，步骤如下：

1. 搜索 WorkBuddy 安装目录下的 `vendor/node.zip`（常见位置：`C:\Program Files\WorkBuddy`、`D:\Program Files\WorkBuddy`、`%LOCALAPPDATA%\Programs\WorkBuddy`）

2. 如果 `~/.workbuddy/binaries/node/versions/` 下还没有可用的 node.exe，将 node.zip 里的 `node-v*-win-x64/` 目录解压，把其中的文件复制到 `~/.workbuddy/binaries/node/versions/{版本号}/`（版本号从目录名提取，如 `22.22.2`）

3. 执行 `~/.workbuddy/binaries/node/versions/{版本号}/node.exe --version` 确认可用

4. 可选：同样处理 `vendor/PortableGit.zip`

完成后告诉我环境是否就绪。

---

执行完毕后，重启 Obsidian，BuddyBridge 即可正常使用。

## 功能

- Obsidian 侧边栏聊天面板，支持多轮对话
- 流式输出，实时显示文字
- 可折叠的思考过程与工具调用卡片
- Assistant 消息 Markdown 渲染（代码块、表格、列表、引用）
- Vault 感知的上下文注入
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

## 故障排查

| 现象                          | 原因                       | 解决                         |
| --------------------------- | ------------------------ | -------------------------- |
| `找不到 codebuddy CLI`         | 自动检测未找到（如自定义安装路径） | 在插件设置中手动填写路径。默认路径：`WorkBuddy安装目录\resources\app.asar.unpacked\cli\bin\codebuddy`。右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录 |
| `找不到 Node.js 来运行 codebuddy` | Node.js 未正确配置            | 完成上方的「环境初始化」               |
| 一直显示「思考中」              | 流式结束未清理占位元素           | 已在 v1.0.11 修复                |
| 重启后对话丢失                 | chatView 未正确持有导致无法加载历史 | 已在 v1.0.11 修复                |

## 权限授权

插件需要 CodeBuddy 对 Vault 有读写权限才能正常工作。如果使用时提示权限不足，将 `提示词-发给workbuddy让它给buddybridge授权.md` 的完整内容发送给 WorkBuddy/CodeBuddy 执行一次即可。

完成后**完全退出** WorkBuddy/CodeBuddy（系统托盘右键退出），重新打开即可生效。

## 设置

| 设置项          | 说明                  | 默认值 |
| ------------ | ------------------- | --- |
| CodeBuddy 路径 | CLI 可执行文件路径（留空自动检测） | 自动  |
| 最大对话数        | 最多保留多少个对话           | 20  |

## 开发

```bash
npm run dev    # 开发构建
npm run build  # 生产构建
npm test       # 运行测试
```

## 许可证

MIT
