// ==================== i18n（P2.7 界面国际化） ====================
//
// 范围铁律（用户明确约定）：
// - 只作用于「插件 UI 表面」与「系统注入标记」（方案 A：标记跟随界面语言）；
// - 用户发出的消息文本永远原样转发（中发中、英发英），绝不翻译；
// - 聊天记录中的既有内容、CLI 输出、日志保持原样。
//
// 语言检测跟随 Obsidian（localStorage['language']，如 'zh-CN' / 'en-US'），
// 以 zh 开头 → 中文，否则英文。

export type Lang = 'zh' | 'en';

/** 当前界面语言：localStorage['language'] 以 zh 开头 → 中文，缺省按 navigator.language 兜底。 */
export function detectLanguage(): Lang {
    try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('language') : null;
        const raw = stored || (typeof navigator !== 'undefined' ? navigator.language : '') || '';
        return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    } catch {
        return 'zh';
    }
}

// ==================== 词典 ====================

const ZH: Record<string, string> = {
    // 视图标题
    'view.title': 'BuddyBridge 聊天',

    // 命令描述（/command 下拉）
    'cmd.clear': '清空对话，重新开始',
    'cmd.help': '显示 CodeBuddy 帮助信息',
    'cmd.status': '显示当前仓库和会话状态',
    'cmd.doctor': '检查 CodeBuddy 环境状态',
    'cmd.compact': '压缩上下文以节省空间',
    'cmd.summarize': '总结并压缩对话上下文',
    'cmd.context': '计算当前会话 token 分布',
    'cmd.cost': '显示会话成本和 token 用量',
    'cmd.model': '查看或切换 AI 模型',
    'cmd.permissions': '管理工具和目录访问权限',
    'cmd.config': '查看或修改本地配置',
    'cmd.export': '导出当前对话',
    'cmd.resume': '恢复之前的会话',
    'cmd.rewind': '回退到之前的消息点',
    'cmd.init': '初始化 CodeBuddy 仓库',
    'cmd.plan': '预览计划模式下的计划文件',
    'cmd.fork': '在当前对话位置创建分支',
    'cmd.memory': '管理长期记忆',
    'cmd.mcp': '管理 MCP 连接',
    'cmd.todos': '显示待办事项列表',
    'cmd.stats': '显示使用统计信息',
    'cmd.cr': '审查代码质量',
    'cmd.fix': '自动修复代码问题',
    'cmd.tests': '生成单元测试',
    'cmd.explain': '解释代码工作原理',
    'cmd.rules': '生成代码规范规则',

    // 标签页 / 新建对话
    'tab.close': '关闭对话',
    'tab.branch': '从这里继续新对话',
    'conv.new': '新建对话',
    'conv.branchSuffix': '（分支）',

    // 输入区
    'input.placeholder': '输入消息... (Shift+Enter 换行，Enter 发送)',
    'input.send': '发送',
    'input.stop': '停止',

    // 空态
    'empty.title': '开始新对话',
    'empty.subtitle': '输入消息开始聊天，或点击 + 新建对话',
    'empty.tips': '💡 提示',
    'tip.enter': 'Shift+Enter 换行，Enter 发送',
    'tip.commands': '输入 / 查看可用命令',
    'tip.context': '多轮对话自动保持上下文',

    // 思考 / 工具 / 错误卡
    'thinking.label': '思考中',
    'thinking.done': '已思考',
    'thinking.inline': '思考中...',
    'tool.title': '工具调用',
    'error.title': '请求失败',
    'error.retry': '重试',
    'error.retryAria': '重试上次发送',
    'error.hintPath': '请在设置中指定正确的 CodeBuddy 路径，或确认已安装 WorkBuddy 桌面版。',
    'error.hintNode': '请确认 Node.js 已正确安装，或运行环境初始化提示词。',
    'error.hintTimeout': '请求超时，请重试。',

    // 消息占位 / 前缀
    'msg.stopped': '（已停止）',
    'msg.noResponse': '（无响应，请重试）',
    'msg.errorPrefix': '错误: ',
    'role.user': '用户',
    'role.assistant': '助手',

    // 通知
    'notice.convFull': '对话已满（最多 {max} 个），请先删除旧对话再新建',
    'notice.requestFail': '请求失败: {msg}',
    'notice.gatewayEmpty': '上游网关无输出（Empty stream），已重置会话，请重试',

    // 队列
    'queue.delete': '删除该条',

    // 用量条（P2.5）
    'usage.label': '上下文 {tokens} / {window} ({pct}%)',

    // 系统注入标记（方案 A：跟随界面语言）
    'marker.currentNote': '[系统注入·当前笔记: {path}]',
    'marker.noNote': '[系统注入·当前笔记: 无]',
    'marker.vault': '[系统注入·Vault: {path}]',
    'marker.forkTranscript': '[系统注入·分支上下文] 以下是你与此用户此前的对话（截至分支点），仅作背景参考：',
    'marker.sessionReset': '[系统注入·会话重置] 以下是你与此用户此前的对话（会话已因网关故障重置），仅作背景参考：',

    // 设置页
    'tab.heading.connection': '连接配置',
    'settings.pathName': 'CodeBuddy 路径',
    'settings.pathDesc': 'codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）',
    'settings.pathPlaceholder': 'WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy',
    'settings.nodeName': 'Node 路径（可选）',
    'settings.nodeDesc': '留空自动检测。仅当以纯脚本方式启动 codebuddy（非 .exe/.cmd）时使用。',
    'settings.autoDetect': '自动检测',
    'settings.timeoutName': 'CLI 超时时长（秒）',
    'settings.timeoutDesc': '请求超过该时长未收到完整回复时自动终止并提示（默认 300 秒）',
    'tab.heading.injection': '上下文注入',
    'settings.noteLinkName': '注入当前笔记链接',
    'settings.noteLinkDesc': '发送消息时自动在消息前附加 {marker}，让 AI 知道你在看哪个笔记（默认开启）',
    'settings.vaultName': '注入 Vault 上下文',
    'settings.vaultDesc': '额外附加 {marker}，帮助 AI 理解笔记所在的仓库（默认关闭）',
    'settings.pathExample': '路径',
    'tab.heading.appearance': '外观',
    'settings.colorName': '主色调',
    'settings.colorDesc': '聊天面板的主题色。留空使用 Obsidian 默认强调色。',
    'settings.fontName': '字体大小',
    'settings.fontDesc': '聊天面板（消息气泡、Markdown 内容与输入框）的文字大小',
    'tab.heading.usage': '上下文用量',
    'settings.windowName': '上下文窗口大小',
    'settings.windowDesc': '用量显示的分母（token）。当对话消耗接近该值时会给出预警。默认 {default}',
    'tab.heading.manage': '管理',
    'settings.maxConvName': '最大对话数',
    'settings.maxConvDesc': '最多保留多少个对话（超出部分自动删除）',
    'settings.exportName': '导出设置（含聊天记录）',
    'settings.exportDesc': '将全部设置与聊天记录导出为带版本号的 JSON 文件，用于备份或迁移',
    'settings.exportBtn': '导出',
    'settings.importName': '导入设置（含聊天记录）',
    'settings.importDesc': '从 JSON 文件恢复设置与聊天记录（会覆盖当前数据，需二次确认）',
    'settings.importBtn': '导入',
    'settings.resetName': '重置为默认',
    'settings.resetDesc': '将所有设置恢复为默认值（不会删除聊天记录，需二次确认）',
    'settings.resetBtn': '重置',
    'settings.resetConfirm': '确认将所有设置恢复为默认值？聊天记录将保留。',
    'settings.resetDone': '设置已重置为默认'
};

const EN: Record<string, string> = {
    'view.title': 'BuddyBridge Chat',

    'cmd.clear': 'Clear conversation and start fresh',
    'cmd.help': 'Show CodeBuddy help',
    'cmd.status': 'Show current repo and session status',
    'cmd.doctor': 'Check CodeBuddy environment',
    'cmd.compact': 'Compact context to save space',
    'cmd.summarize': 'Summarize and compact conversation context',
    'cmd.context': 'Compute token distribution of current session',
    'cmd.cost': 'Show session cost and token usage',
    'cmd.model': 'View or switch AI model',
    'cmd.permissions': 'Manage tool and directory access permissions',
    'cmd.config': 'View or modify local config',
    'cmd.export': 'Export current conversation',
    'cmd.resume': 'Resume a previous session',
    'cmd.rewind': 'Rewind to an earlier message point',
    'cmd.init': 'Initialize CodeBuddy repo',
    'cmd.plan': 'Preview plan-mode plan files',
    'cmd.fork': 'Create a branch at the current position',
    'cmd.memory': 'Manage long-term memory',
    'cmd.mcp': 'Manage MCP connections',
    'cmd.todos': 'Show todo list',
    'cmd.stats': 'Show usage statistics',
    'cmd.cr': 'Review code quality',
    'cmd.fix': 'Auto-fix code issues',
    'cmd.tests': 'Generate unit tests',
    'cmd.explain': 'Explain how the code works',
    'cmd.rules': 'Generate coding rules',

    'tab.close': 'Close conversation',
    'tab.branch': 'Continue as new conversation from here',
    'conv.new': 'New conversation',
    'conv.branchSuffix': ' (branch)',

    'input.placeholder': 'Type a message... (Shift+Enter for newline, Enter to send)',
    'input.send': 'Send',
    'input.stop': 'Stop',

    'empty.title': 'Start a new conversation',
    'empty.subtitle': 'Type a message to chat, or click + to start a new conversation',
    'empty.tips': '💡 Tips',
    'tip.enter': 'Shift+Enter for newline, Enter to send',
    'tip.commands': 'Type / to see available commands',
    'tip.context': 'Context is kept automatically across turns',

    'thinking.label': 'Thinking',
    'thinking.done': 'Thought',
    'thinking.inline': 'Thinking...',
    'tool.title': 'Tool calls',
    'error.title': 'Request failed',
    'error.retry': 'Retry',
    'error.retryAria': 'Retry last send',
    'error.hintPath': 'Set the correct CodeBuddy path in settings, or confirm WorkBuddy desktop is installed.',
    'error.hintNode': 'Confirm Node.js is installed correctly, or run the environment setup prompt.',
    'error.hintTimeout': 'Request timed out, please retry.',

    'msg.stopped': ' (stopped)',
    'msg.noResponse': ' (no response, please retry)',
    'msg.errorPrefix': 'Error: ',
    'role.user': 'User',
    'role.assistant': 'Assistant',

    'notice.convFull': 'Conversation limit reached (max {max}), delete an old conversation first',
    'notice.requestFail': 'Request failed: {msg}',
    'notice.gatewayEmpty': 'Gateway returned empty stream, session has been reset, please retry',

    'queue.delete': 'Remove this item',

    'usage.label': 'Context {tokens} / {window} ({pct}%)',

    'marker.currentNote': '[System injection·Current note: {path}]',
    'marker.noNote': '[System injection·Current note: none]',
    'marker.vault': '[System injection·Vault: {path}]',
    'marker.forkTranscript': '[System injection·Fork context] This is your earlier conversation with this user (up to the fork point), provided as background reference only:',
    'marker.sessionReset': '[System injection·Session reset] This is your earlier conversation with this user (the session was reset due to a gateway failure), provided as background reference only:',

    'tab.heading.connection': 'Connection',
    'settings.pathName': 'CodeBuddy path',
    'settings.pathDesc': 'Path to the codebuddy executable. For a custom WorkBuddy install, the path is usually: install-dir\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy (right-click the WorkBuddy shortcut → Open file location to find the install dir)',
    'settings.pathPlaceholder': 'WorkBuddy install dir\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy',
    'settings.nodeName': 'Node path (optional)',
    'settings.nodeDesc': 'Leave empty for auto-detection. Only used when codebuddy is launched as a bare script (not .exe/.cmd).',
    'settings.autoDetect': 'Auto-detect',
    'settings.timeoutName': 'CLI timeout (seconds)',
    'settings.timeoutDesc': 'Automatically abort a request that receives no complete reply within this time (default 300s)',
    'tab.heading.injection': 'Context injection',
    'settings.noteLinkName': 'Inject current note link',
    'settings.noteLinkDesc': 'Prepend {marker} to messages so the AI knows which note you are viewing (default on)',
    'settings.vaultName': 'Inject Vault context',
    'settings.vaultDesc': 'Additionally append {marker} to help the AI understand the vault root (default off)',
    'settings.pathExample': 'path',
    'tab.heading.appearance': 'Appearance',
    'settings.colorName': 'Accent color',
    'settings.colorDesc': 'Theme color of the chat panel. Leave empty to use the Obsidian default accent.',
    'settings.fontName': 'Font size',
    'settings.fontDesc': 'Text size in the chat panel (message bubbles, markdown content and the input box)',
    'tab.heading.usage': 'Context usage',
    'settings.windowName': 'Context window size',
    'settings.windowDesc': 'Denominator (tokens) for the usage display. A warning appears when conversation usage approaches this value. Default {default}',
    'tab.heading.manage': 'Manage',
    'settings.maxConvName': 'Max conversations',
    'settings.maxConvDesc': 'Maximum number of conversations to keep (older ones are deleted automatically)',
    'settings.exportName': 'Export settings (incl. chats)',
    'settings.exportDesc': 'Export all settings and chat history as a versioned JSON file for backup or migration',
    'settings.exportBtn': 'Export',
    'settings.importName': 'Import settings (incl. chats)',
    'settings.importDesc': 'Restore settings and chat history from a JSON file (overwrites current data, requires confirmation)',
    'settings.importBtn': 'Import',
    'settings.resetName': 'Reset to defaults',
    'settings.resetDesc': 'Reset all settings to defaults (chat history is kept, requires confirmation)',
    'settings.resetBtn': 'Reset',
    'settings.resetConfirm': 'Reset all settings to defaults? Chat history will be kept.',
    'settings.resetDone': 'Settings reset to defaults'
};

/** 按指定语言取词（纯函数，供单测与 t() 复用）；缺词回退 key 本身。 */
export function translate(lang: Lang, key: string): string {
    const dict = lang === 'zh' ? ZH : EN;
    return dict[key] ?? key;
}

/** 当前界面语言取词。 */
export function t(key: string): string {
    return translate(detectLanguage(), key);
}

/** 取词 + {param} 插值（多次出现全部替换）。 */
export function tf(lang: Lang, key: string, params?: Record<string, string | number>): string {
    let s = translate(lang, key);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            s = s.split(`{${k}}`).join(String(v));
        }
    }
    return s;
}

/** 当前界面语言取词 + 插值。 */
export function tF(key: string, params?: Record<string, string | number>): string {
    return tf(detectLanguage(), key, params);
}
