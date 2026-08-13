## v1.0.17

### 新增
- 停止对话：AI 回复过程中，发送按钮变为红色「停止」按钮，点击立即终止回复并标记「（已停止）」，方便发错消息后及时修正
- 文件名可点击：回复中提到的、知识库内真实存在的文件名自动变成可点击链接，点击直接打开对应笔记

### 修复
- 自定义主色调无效：修复主色调设置不生效的问题（实际是调用了不存在的 `Plugin.setCssProps` 且 CSS 变量 key 前缀错误），现在改颜色立即生效、重启后保留、可正常重置

### New
- Stop conversation: while the AI is streaming a reply, the send button turns into a red "Stop" button — click it to instantly cancel the response, which is then marked as "(Stopped)". Handy when you sent a wrong message and want to correct it
- Clickable filenames: filenames mentioned in replies that actually exist in your vault are automatically turned into clickable links — click to open the note directly

### Fixed
- Custom primary color not applying: fixed the issue where the accent color setting had no effect (it called a non-existent `Plugin.setCssProps` and used a wrong CSS-variable key prefix). Color changes now take effect instantly, persist across restarts, and can be reset normally
