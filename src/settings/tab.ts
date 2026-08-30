import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type BuddyBridgePlugin from '../main';
import { DEFAULT_SETTINGS, FONT_SIZE_MIN, FONT_SIZE_MAX } from '../types';
import { parseExport, downloadJSONFile, pickAndReadJSONFile } from '../io';
import { ConfirmModal } from './confirm';

export class BuddyBridgeSettingTab extends PluginSettingTab {
    plugin: BuddyBridgePlugin;

    constructor(app: App, plugin: BuddyBridgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const plugin = this.plugin;

        // ==================== 连接配置 ====================
        new Setting(containerEl).setName('连接配置').setHeading();

        new Setting(containerEl)
            .setName('CodeBuddy 路径')
            .setDesc('codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）')
            .addText(text => text
                .setPlaceholder('WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy')
                .setValue(plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    plugin.settings.codebuddyPath = value;
                    plugin.api.setCodebuddyPath(value);
                    await plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Node 路径（可选）')
            .setDesc('留空自动检测。仅当以纯脚本方式启动 codebuddy（非 .exe/.cmd）时使用。')
            .addText(text => text
                .setPlaceholder('自动检测')
                .setValue(plugin.settings.nodePath)
                .onChange(async (value) => {
                    plugin.settings.nodePath = value;
                    plugin.api.setNodePath(value);
                    await plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('CLI 超时时长（秒）')
            .setDesc('请求超过该时长未收到完整回复时自动终止并提示（默认 300 秒）')
            .addText(text => text
                .setPlaceholder('300')
                .setValue(String(plugin.settings.timeoutSeconds))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        plugin.settings.timeoutSeconds = num;
                        await plugin.saveSettings();
                    }
                }));

        // ==================== 上下文注入 ====================
        new Setting(containerEl).setName('上下文注入').setHeading();

        new Setting(containerEl)
            .setName('注入当前笔记链接')
            .setDesc('发送消息时自动在消息前附加 [系统注入·当前笔记: 路径]，让 AI 知道你在看哪个笔记（默认开启）')
            .addToggle(toggle => toggle
                .setValue(plugin.settings.noteLinkInjection)
                .onChange(async (value) => {
                    plugin.settings.noteLinkInjection = value;
                    await plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('注入 Vault 上下文')
            .setDesc('额外附加 [系统注入·Vault: 仓库根路径]，帮助 AI 理解笔记所在的仓库（默认关闭）')
            .addToggle(toggle => toggle
                .setValue(plugin.settings.vaultContextInjection)
                .onChange(async (value) => {
                    plugin.settings.vaultContextInjection = value;
                    await plugin.saveSettings();
                }));

        // ==================== 外观 ====================
        new Setting(containerEl).setName('外观').setHeading();

        new Setting(containerEl)
            .setName('主色调')
            .setDesc('聊天面板的主题色。留空使用 Obsidian 默认强调色。')
            .addText(text => {
                text.inputEl.type = 'color';
                text.setValue(plugin.settings.primaryColor || '#8b5cf6');
                text.onChange(async (value) => {
                    plugin.settings.primaryColor = value;
                    await plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('字体大小')
            .setDesc('聊天面板（消息气泡、Markdown 内容与输入框）的文字大小')
            .addSlider(slider => slider
                .setLimits(FONT_SIZE_MIN, FONT_SIZE_MAX, 1)
                .setValue(plugin.settings.fontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    plugin.settings.fontSize = value;
                    await plugin.saveSettings();
                }));

        // ==================== 管理 ====================
        new Setting(containerEl).setName('管理').setHeading();

        new Setting(containerEl)
            .setName('最大对话数')
            .setDesc('最多保留多少个对话（超出部分自动删除）')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(plugin.settings.maxConversations))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        plugin.settings.maxConversations = num;
                        await plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('导出设置（含聊天记录）')
            .setDesc('将全部设置与聊天记录导出为带版本号的 JSON 文件，用于备份或迁移')
            .addButton(btn => btn
                .setButtonText('导出')
                .onClick(async () => {
                    await plugin.exportData();
                }));

        new Setting(containerEl)
            .setName('导入设置（含聊天记录）')
            .setDesc('从 JSON 文件恢复设置与聊天记录（会覆盖当前数据，需二次确认）')
            .addButton(btn => {
                btn.setButtonText('导入');
                // 直接在按钮 DOM 上挂原生 click（绕过 Obsidian 包装的异步调用），
                // 确保 DOM 回退方案的文件选择框拿到"用户激活"。
                btn.buttonEl.addEventListener('click', (evt: MouseEvent) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    void plugin.importDataFromFile();
                });
            });

        new Setting(containerEl)
            .setName('重置为默认')
            .setDesc('将所有设置恢复为默认值（不会删除聊天记录，需二次确认）')
            .addButton(btn => btn
                .setButtonText('重置')
                .onClick(() => {
                    new ConfirmModal(
                        this.app,
                        '确认将所有设置恢复为默认值？聊天记录将保留。',
                        async () => {
                            plugin.settings = { ...DEFAULT_SETTINGS };
                            plugin.api.setCodebuddyPath('');
                            plugin.api.setNodePath('');
                            await plugin.saveSettings();
                            new Notice('设置已重置为默认');
                            this.display();
                        }
                    ).open();
                }));
    }
}
