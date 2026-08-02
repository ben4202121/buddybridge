import { App, PluginSettingTab, Setting } from 'obsidian';
import type BuddyBridgePlugin from '../main';
import { DEFAULT_SETTINGS } from '../types';

export class BuddyBridgeSettingTab extends PluginSettingTab {
    plugin: BuddyBridgePlugin;

    constructor(app: App, plugin: BuddyBridgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Configuration').setHeading();

        new Setting(containerEl)
            .setName('CodeBuddy 路径')
            .setDesc('codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）')
            .addText(text => text
                .setPlaceholder('WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy')
                .setValue(this.plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    this.plugin.settings.codebuddyPath = value;
                    this.plugin.api.setCodebuddyPath(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('最大对话数')
            .setDesc('最多保留多少个对话（旧对话将被自动删除）')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.maxConversations))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.maxConversations = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('主色调')
            .setDesc('聊天面板的主题色。留空使用 Obsidian 默认强调色。')
            .addText(text => {
                text.inputEl.type = 'color';
                text.setValue(this.plugin.settings.primaryColor || '#8b5cf6');
                text.onChange(async (value) => {
                    this.plugin.settings.primaryColor = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('重置为默认')
            .setDesc('将所有设置恢复为默认值')
            .addButton(btn => {
                btn.setButtonText('重置').onClick(async () => {
                    this.plugin.settings = { ...DEFAULT_SETTINGS };
                    this.plugin.api.setCodebuddyPath('');
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
    }
}
