import { App, PluginSettingTab, Setting } from 'obsidian';
import type BuddyBridgePlugin from '../main';

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
    }
}
