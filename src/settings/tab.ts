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

        containerEl.createEl('h2', { text: 'BuddyBridge 设置' });

        new Setting(containerEl)
            .setName('Gateway URL')
            .setDesc('本地 WorkBuddy/CodeBuddy Gateway 地址')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:55808')
                .setValue(this.plugin.settings.gatewayUrl)
                .onChange(async (value) => {
                    this.plugin.settings.gatewayUrl = value;
                    this.plugin.api.setGatewayUrl(value);
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
