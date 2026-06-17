# BuddyBridge

> Connect Obsidian to WorkBuddy/CodeBuddy CLI for AI chat

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **⚠️ 目前仅支持 Windows 系统。** macOS / Linux 暂未适配。

---

## 前置条件

1. 已安装 **WorkBuddy 桌面版**（≥ 5.0.5）
2. 已安装 **Obsidian**（≥ 0.15.0）

## 首次使用：环境初始化

将以下提示词**完整复制**到 WorkBuddy 的对话中执行一次即可：

---

请帮我配置 BuddyBridge 插件的运行环境，步骤如下：

1. 搜索 WorkBuddy 安装目录下的 `vendor/node.zip`（常见位置：`C:\Program Files\WorkBuddy`、`D:\Program Files\WorkBuddy`、`%LOCALAPPDATA%\Programs\WorkBuddy`）

2. 如果 `~/.workbuddy/binaries/node/versions/` 下还没有可用的 node.exe，将 node.zip 里的 `node-v*-win-x64/` 目录解压，把其中的文件复制到 `~/.workbuddy/binaries/node/versions/{版本号}/`（版本号从目录名提取，如 `22.22.2`）

3. 执行 `~/.workbuddy/binaries/node/versions/{版本号}/node.exe --version` 确认可用

4. 可选：同样处理 `vendor/PortableGit.zip`

完成后告诉我环境是否就绪。

---

执行完毕后，重启 Obsidian，BuddyBridge 即可正常使用。

---

## 功能

- Obsidian 侧边栏聊天面板，支持多轮对话
- 流式输出，实时显示文字
- 思考过程可视化
- 工具调用展示（文件读取、搜索等）
- Vault 感知的上下文注入
- 会话管理，对话连续性
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

## 权限授权

插件需要 CodeBuddy 对 Vault 有读写权限才能正常工作。如果使用时提示权限不足，将 `提示词-发给workbuddy让它给buddybridge授权.md` 的完整内容发送给 WorkBuddy/CodeBuddy 执行一次即可。

完成后**完全退出** WorkBuddy/CodeBuddy（系统托盘右键退出），重新打开即可生效。

## 安装

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `.obsidian/plugins/buddybridge/`
3. 重启 Obsidian
4. 设置 → 第三方插件 → 关闭安全模式 → 开启 BuddyBridge

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
