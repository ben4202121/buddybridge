import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type BuddyBridgePlugin from '../main';
import { DEFAULT_SETTINGS, FONT_SIZE_MIN, FONT_SIZE_MAX, CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX, getErrorMessage } from '../types';
import { parseExport, downloadJSONFile, pickAndReadJSONFile } from '../io';
import { ConfirmModal } from './confirm';
import { t, tF } from '../i18n';
import { detectInstalledSkills, readOfficialMarketplace, type OfficialPlugin, type InstalledSkill } from '../skills';

export class BuddyBridgeSettingTab extends PluginSettingTab {
    plugin: BuddyBridgePlugin;
    /** 官方市场清单缓存（本地注册表读取，仅一次；搜索复用）。 */
    private marketCache: OfficialPlugin[] | null = null;

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

        // ==================== 技能（P2.8 官方技能调用） ====================
        new Setting(containerEl).setName(t('tab.heading.skills')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.skillsIntro'))
            .setDesc(t('settings.skillsIntroDesc'));

        // 已安装技能：刷新探测 + 勾选启用（写入 enabledSkills，发送时随消息注入）
        const installedListEl = containerEl.createDiv({ cls: 'buddybridge-skills-installed' });
        new Setting(containerEl)
            .setName(t('settings.installedTitle'))
            .setDesc(t('settings.installedDesc'))
            .addButton(btn => btn
                .setButtonText(t('settings.refreshBtn'))
                .onClick(() => void this.renderInstalledSkills(installedListEl, plugin)));
        void this.renderInstalledSkills(installedListEl, plugin);

        // 官方市场：可搜索清单 + 复制安装命令
        const marketListEl = containerEl.createDiv({ cls: 'buddybridge-skills-market' });
        const marketHeader = new Setting(containerEl)
            .setName(t('settings.marketTitle'))
            .setDesc(t('settings.restartHint'));
        new Setting(containerEl)
            .addText(text => text
                .setPlaceholder(t('settings.marketSearch'))
                .onChange((q) => void this.renderMarketList(marketListEl, q, marketHeader)));
        void this.renderMarketList(marketListEl, '', marketHeader);

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

    /** 已安装技能列表：刷新探测 + 勾选启用（P2.8）。 */
    private async renderInstalledSkills(container: HTMLElement, plugin: BuddyBridgePlugin): Promise<void> {
        container.empty();
        let skills: InstalledSkill[];
        try {
            skills = await detectInstalledSkills();
        } catch (e) {
            container.createDiv({ cls: 'buddybridge-skills-empty', text: tF('settings.installedScanFail', { msg: getErrorMessage(e) }) });
            return;
        }
        if (skills.length === 0) {
            container.createDiv({ cls: 'buddybridge-skills-empty', text: t('settings.installedEmpty') });
            return;
        }
        const enabled = new Set(plugin.settings.enabledSkills);
        for (const s of skills) {
            new Setting(container)
                .setName(s.name)
                .setDesc(s.description || undefined)
                .addToggle(toggle => toggle
                    .setValue(enabled.has(s.name))
                    .onChange(async (value) => {
                        const list = [...plugin.settings.enabledSkills];
                        const idx = list.indexOf(s.name);
                        if (value && idx < 0) {
                            list.push(s.name);
                        } else if (!value && idx >= 0) {
                            list.splice(idx, 1);
                        }
                        plugin.settings.enabledSkills = list;
                        await plugin.saveSettings();
                    }));
        }
    }

    /** 官方市场清单：本地注册表读取（缓存）+ 搜索过滤 + 复制安装命令（P2.8）。 */
    private async renderMarketList(container: HTMLElement, query: string, header: Setting): Promise<void> {
        if (!this.marketCache) {
            try {
                this.marketCache = await readOfficialMarketplace();
            } catch (e) {
                container.empty();
                container.createDiv({ cls: 'buddybridge-skills-empty', text: getErrorMessage(e) });
                header.setName(t('settings.marketTitle'));
                return;
            }
        }
        const plugins = this.marketCache;
        header.setName(tF('settings.marketTitle', { n: plugins.length }));
        const q = query.trim().toLowerCase();
        const filtered = q ? plugins.filter(p => p.name.toLowerCase().includes(q)) : plugins;
        container.empty();
        if (filtered.length === 0) {
            container.createDiv({ cls: 'buddybridge-skills-empty', text: t('settings.marketSearch') });
            return;
        }
        for (const p of filtered) {
            const row = container.createDiv({ cls: 'buddybridge-skills-item' });
            const info = row.createDiv({ cls: 'buddybridge-skills-item-text' });
            info.createDiv({ cls: 'buddybridge-skills-item-name', text: p.name });
            if (p.description) {
                info.createDiv({ cls: 'buddybridge-skills-item-desc', text: p.description });
            }
            const btn = row.createEl('button', {
                cls: 'mod-cta buddybridge-skills-install-btn',
                text: t('settings.copyInstall'),
                attr: { 'aria-label': `codebuddy plugin install ${p.name}` }
            });
            btn.onclick = () => this.copyInstallCommand(p.name);
        }
    }

    /** 复制安装命令到剪贴板（带手动执行兜底提示）。 */
    private copyInstallCommand(name: string): void {
        const cmd = `codebuddy plugin install ${name}`;
        void navigator.clipboard.writeText(cmd).then(
            () => new Notice(tF('settings.copyInstallDone', { cmd })),
            () => new Notice(tF('settings.copyInstallFail', { cmd }))
        );
    }
}
