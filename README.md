# BuddyBridge

> 🔗 连接 Obsidian 与本地知识库 Gateway 的第三方桥接插件

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ⚠️ 免责声明

**BuddyBridge 是一个独立的第三方开源项目。**

- 本插件**并非**任何知识库服务的官方产品
- 本插件仅通过本地 Gateway 的公开 API 与本地服务通信
- 插件的功能、质量和安全性由本项目的维护者负责
- 使用本插件前，请确保你已阅读并同意相关服务的条款

---

## 功能

| 功能 | 触发方式 | 说明 |
|------|---------|------|
| 导入知识库 | 右键菜单 / 文件列表右键 | 将选中内容或整个文件导入知识库 |
| 查询知识库 | 右键菜单 / Ribbon 按钮 | 选中文本查询，结果插入文档 |
| Lint 检查 | 右键菜单 / 命令面板 | 全文 Lint 检查 |
| 漂移检查 | 命令面板 | 全文 drift-check，结果追加文末 |
| 批量导入 | 命令面板 / 文件列表右键 | 递归导入文件夹内所有 .md 文件 |
| 自动 Lint | 设置开启 | 文件修改后防抖延迟触发 |
| 历史面板 | Ribbon 按钮 / 命令面板 | 右侧边栏，支持筛选、导出、复制、插入 |

---

## 前置要求

- 已安装并运行支持 Gateway 的本地服务（WorkBuddy / CodeBuddy）
- Gateway 功能已开启（默认地址：`http://127.0.0.1:55808`）
- Obsidian 版本 ≥ 0.15.0

---

## 安装

### 手动安装

1. 下载最新 Release 中的 `main.js`、`manifest.json`、`styles.css`
2. 放入 vault 的 `.obsidian/plugins/buddybridge/` 目录
3. 重启 Obsidian
4. 设置 → 第三方插件 → 关闭安全模式 → 开启 BuddyBridge

### 从源码构建

```bash
cd 你的vault/.obsidian/plugins/
git clone https://github.com/你的用户名/buddybridge.git
cd buddybridge
npm install
npm run build
```

---

## 配置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| Gateway URL | Gateway 地址 | `http://127.0.0.1:55808` |
| Session ID | 会话 ID（留空自动生成） | 自动生成 |
| 自动 Lint | 文件修改后自动检查 | 关闭 |
| 批量导入文件夹 | 默认批量导入路径 | 空 |
| 最大历史条目 | 面板保留记录数 | 100 |

---

## 开发

```bash
npm run dev    # 开发模式（实时编译）
npm run build  # 生产构建
npm test       # 运行测试
```

---

## 许可证

本项目代码采用 [MIT License](LICENSE) 授权。
