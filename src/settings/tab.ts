import { App, PluginSettingTab, Setting } from 'obsidian';
import type BuddyBridgePlugin from '../main';

export class BuddyBridgeSettingTab extends PluginSettingTab {
    plugin: BuddyBridgePlugin;

    constructor(app: App, plugin: BuddyBridgePlugin) {
        super(app, plugin as any);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('BuddyBridge 设置').setHeading();

        new Setting(containerEl)
            .setName('CodeBuddy 路径')
            .setDesc('codebuddy CLI 可执行文件路径（留空则自动查找）')
            .addText(text => text
                .setPlaceholder('自动检测')
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
