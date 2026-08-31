import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type BuddyBridgePlugin from '../main';
import { DEFAULT_SETTINGS, FONT_SIZE_MIN, FONT_SIZE_MAX, CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX } from '../types';
import { parseExport, downloadJSONFile, pickAndReadJSONFile } from '../io';
import { ConfirmModal } from './confirm';
import { t, tF } from '../i18n';

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
        new Setting(containerEl).setName(t('tab.heading.connection')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.pathName'))
            .setDesc(t('settings.pathDesc'))
            .addText(text => text
                .setPlaceholder(t('settings.pathPlaceholder'))
                .setValue(plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    plugin.settings.codebuddyPath = value;
                    plugin.api.setCodebuddyPath(value);
                    await plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.nodeName'))
            .setDesc(t('settings.nodeDesc'))
            .addText(text => text
                .setPlaceholder(t('settings.autoDetect'))
                .setValue(plugin.settings.nodePath)
                .onChange(async (value) => {
                    plugin.settings.nodePath = value;
                    plugin.api.setNodePath(value);
                    await plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.timeoutName'))
            .setDesc(t('settings.timeoutDesc'))
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
        new Setting(containerEl).setName(t('tab.heading.injection')).setHeading();

        const noteMarker = tF('marker.currentNote', { path: t('settings.pathExample') });
        const vaultMarker = tF('marker.vault', { path: t('settings.pathExample') });

        new Setting(containerEl)
            .setName(t('settings.noteLinkName'))
            .setDesc(tF('settings.noteLinkDesc', { marker: noteMarker }))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.noteLinkInjection)
                .onChange(async (value) => {
                    plugin.settings.noteLinkInjection = value;
                    await plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.vaultName'))
            .setDesc(tF('settings.vaultDesc', { marker: vaultMarker }))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.vaultContextInjection)
                .onChange(async (value) => {
                    plugin.settings.vaultContextInjection = value;
                    await plugin.saveSettings();
                }));

        // ==================== 外观 ====================
        new Setting(containerEl).setName(t('tab.heading.appearance')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.colorName'))
            .setDesc(t('settings.colorDesc'))
            .addText(text => {
                text.inputEl.type = 'color';
                text.setValue(plugin.settings.primaryColor || '#8b5cf6');
                text.onChange(async (value) => {
                    plugin.settings.primaryColor = value;
                    await plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName(t('settings.fontName'))
            .setDesc(t('settings.fontDesc'))
            .addSlider(slider => slider
                .setLimits(FONT_SIZE_MIN, FONT_SIZE_MAX, 1)
                .setValue(plugin.settings.fontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    plugin.settings.fontSize = value;
                    await plugin.saveSettings();
                }));

        // ==================== 上下文用量 ====================
        new Setting(containerEl).setName(t('tab.heading.usage')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.windowName'))
            .setDesc(tF('settings.windowDesc', { default: DEFAULT_SETTINGS.contextWindowSize }))
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.contextWindowSize))
                .setValue(String(plugin.settings.contextWindowSize))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= CONTEXT_WINDOW_MIN && num <= CONTEXT_WINDOW_MAX) {
                        plugin.settings.contextWindowSize = num;
                        await plugin.saveSettings();
                    }
                }));

        // ==================== 管理 ====================
        new Setting(containerEl).setName(t('tab.heading.manage')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.maxConvName'))
            .setDesc(t('settings.maxConvDesc'))
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
            .setName(t('settings.exportName'))
            .setDesc(t('settings.exportDesc'))
            .addButton(btn => btn
                .setButtonText(t('settings.exportBtn'))
                .onClick(async () => {
                    await plugin.exportData();
                }));

        new Setting(containerEl)
            .setName(t('settings.importName'))
            .setDesc(t('settings.importDesc'))
            .addButton(btn => {
                btn.setButtonText(t('settings.importBtn'));
                // 直接在按钮 DOM 上挂原生 click（绕过 Obsidian 包装的异步调用），
                // 确保 DOM 回退方案的文件选择框拿到"用户激活"。
                btn.buttonEl.addEventListener('click', (evt: MouseEvent) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    void plugin.importDataFromFile();
                });
            });

        new Setting(containerEl)
            .setName(t('settings.resetName'))
            .setDesc(t('settings.resetDesc'))
            .addButton(btn => btn
                .setButtonText(t('settings.resetBtn'))
                .onClick(() => {
                    new ConfirmModal(
                        this.app,
                        t('settings.resetConfirm'),
                        async () => {
                            plugin.settings = { ...DEFAULT_SETTINGS };
                            plugin.api.setCodebuddyPath('');
                            plugin.api.setNodePath('');
                            await plugin.saveSettings();
                            new Notice(t('settings.resetDone'));
                            this.display();
                        }
                    ).open();
                }));
    }
}
