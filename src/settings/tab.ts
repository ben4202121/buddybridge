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

        // ===== 通用 =====
        new Setting(containerEl).setName('通用').setHeading();

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

        // ===== CodeBuddy =====
        new Setting(containerEl).setName('CodeBuddy').setHeading();

        new Setting(containerEl)
            .setName('CLI 路径')
            .setDesc('codebuddy 可执行文件路径。留空自动检测。')
            .addText(text => text
                .setPlaceholder('自动检测')
                .setValue(this.plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    this.plugin.settings.codebuddyPath = value;
                    this.plugin.api.setCodebuddyPath(value);
                    await this.plugin.saveSettings();
                }));

        // ===== 外观 =====
        new Setting(containerEl).setName('外观').setHeading();

        const colorSetting = new Setting(containerEl)
            .setName('主色调')
            .setDesc('聊天面板的主题色。留空使用 Obsidian 默认强调色。');

        // 颜色选择器：用原生 color input + 文本输入 HEX
        const colorWrapper = colorSetting.controlEl.createDiv({ cls: 'buddybridge-color-wrapper' });
        const colorInput = colorWrapper.createEl('input', {
            attr: { type: 'color' }
        });
        colorInput.value = this.plugin.settings.primaryColor || '#8b5cf6';
        const hexInput = colorWrapper.createEl('input', {
            cls: 'buddybridge-hex-input',
            attr: { type: 'text', placeholder: '#8b5cf6' }
        });
        hexInput.value = this.plugin.settings.primaryColor || '';

        const applyColor = (value: string) => {
            this.plugin.settings.primaryColor = value;
            this.plugin.saveSettings();
        };

        colorInput.addEventListener('input', () => {
            const val = colorInput.value;
            hexInput.value = val;
            applyColor(val);
        });

        hexInput.addEventListener('change', () => {
            const val = hexInput.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                colorInput.value = val;
                applyColor(val);
            }
        });

        // ===== 管理 =====
        new Setting(containerEl).setName('管理').setHeading();

        new Setting(containerEl)
            .setName('重置为默认')
            .setDesc('将所有设置恢复为默认值')
            .addButton(btn => {
                btn.setButtonText('重置').onClick(async () => {
                    this.plugin.settings = { ...DEFAULT_SETTINGS };
                    this.plugin.api.setCodebuddyPath('');
                    await this.plugin.saveSettings();
                    this.plugin.applyPrimaryColor();
                    this.display();
                });
            });
    }
}