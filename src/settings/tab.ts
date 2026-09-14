import { App, PluginSettingTab, Setting, Notice, DropdownComponent } from 'obsidian';
import type BuddyBridgePlugin from '../main';
import { DEFAULT_SETTINGS, FONT_SIZE_MIN, FONT_SIZE_MAX, CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX, getErrorMessage } from '../types';
import { parseExport, downloadJSONFile, pickAndReadJSONFile } from '../io';
import { ConfirmModal } from './confirm';
import { t, tF } from '../i18n';
import { detectInstalledSkills, readOfficialMarketplace, type OfficialPlugin, type InstalledSkill } from '../skills';
import { getModelCatalog, type ModelInfo } from '../models';

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

        // ==================== 传输（P1 ACP）====================
        new Setting(containerEl).setName(t('tab.heading.transport')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.transportName'))
            .setDesc(t('settings.transportDesc'))
            .addDropdown((dd) => {
                dd.addOption('print', t('settings.transportPrint'));
                dd.addOption('acp', t('settings.transportAcp'));
                dd.setValue(plugin.settings.transportMode)
                    .onChange(async (value) => {
                        plugin.settings.transportMode = value as 'print' | 'acp';
                        await plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(t('settings.permissionName'))
            .setDesc(t('settings.permissionDesc'))
            .addDropdown((dd) => {
                dd.addOption('default', t('settings.permissionDefault'));
                dd.addOption('acceptEdits', t('settings.permissionAcceptEdits'));
                dd.addOption('dontAsk', t('settings.permissionDontAsk'));
                dd.addOption('bypassPermissions', t('settings.permissionBypass'));
                dd.setValue(plugin.settings.acpPermissionMode)
                    .onChange(async (value) => {
                        plugin.settings.acpPermissionMode = value;
                        await plugin.saveSettings();
                    });
            });

        // 默认模型（v2.6.0 模型切换）：选项异步填充（免费模型自动识别）
        new Setting(containerEl)
            .setName(t('settings.modelName'))
            .setDesc(t('settings.modelDesc'))
            .addDropdown((dd) => {
                dd.addOption('auto', t('settings.modelAuto'));
                dd.setValue(plugin.settings.defaultModel || 'auto')
                    .onChange(async (value) => {
                        plugin.settings.defaultModel = value;
                        await plugin.saveSettings();
                    });
                void this.renderModelOptions(dd, plugin);
            });

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

    /**
     * 默认模型下拉：异步填充模型目录（免费模型加「免费」标注）。
     * getModelCatalog 内部已保证不抛（读取失败回退静态清单），故无需 try/catch。
     */
    private async renderModelOptions(dd: DropdownComponent, plugin: BuddyBridgePlugin): Promise<void> {
        const models = await getModelCatalog();
        for (const m of models) {
            const label = m.free ? `${m.name} · ${t('settings.modelFree')}` : m.name;
            dd.addOption(m.id, label);
        }
        // 已保存值可能落在延迟填充的选项上（如默认即某个模型 id）：
        // 异步填充完成后重设选中，避免下拉显示空白。若保存值不在目录中
        // （例如手改 data.json / 导入的旧值），下拉保持当前选中不变、设置不被动。
        const saved = plugin.settings.defaultModel || 'auto';
        if (models.some((m) => m.id === saved) || saved === 'auto') {
            dd.setValue(saved);
        }
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
