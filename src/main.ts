import { Menu, Notice, Plugin, TFile } from 'obsidian';
import { BuddyBridgeAPI } from './api';
import { BuddyBridgeChatView, VIEW_TYPE_CHAT } from './views/chat';
import { migrateSettings, normalizePersistedData, getErrorMessage, type BuddyBridgeSettings, type PersistedData } from './types';
import { BuddyBridgeSettingTab } from './settings/tab';
import { buildExportPayload, serializeExport, parseExport, downloadJSONFile, pickAndReadJSONFile, type BuddyBridgeExport } from './io';
import { ConfirmModal } from './settings/confirm';
import { t, tF } from './i18n';

export default class BuddyBridgePlugin extends Plugin {
    settings: BuddyBridgeSettings;
    api: BuddyBridgeAPI;
    chatView: BuddyBridgeChatView | null = null;

    async onload() {
        try {
            await this.loadSettings();

            this.api = new BuddyBridgeAPI();
            this.api.setCodebuddyPath(this.settings.codebuddyPath);
            this.api.setNodePath(this.settings.nodePath);
            this.api.setTimeoutMs(this.settings.timeoutSeconds * 1000);

            // 注册聊天视图
            this.registerView(
                VIEW_TYPE_CHAT,
                (leaf) => {
                    const view = new BuddyBridgeChatView(leaf, this.api, async () => {
                        const data = normalizePersistedData(await this.loadData());
                        return data.conversations || [];
                    });
                    this.chatView = view;

                    // 持久化回调
                    view.getManager().setPersistCallback(async (conversations) => {
                        const data = normalizePersistedData(await this.loadData());
                        data.conversations = conversations;
                        await this.saveData(data);
                    });

                    return view;
                }
            );

            // Ribbon 按钮
            this.addRibbonIcon('bot', 'BuddyBridge 聊天', async () => {
                await this.activateView();
            });

            // 命令面板
            this.addCommand({
                id: 'open-chat',
                name: '打开聊天面板',
                callback: async () => {
                    await this.activateView();
                }
            });

            // P2.4 命令：附加当前笔记到当前会话
            this.addCommand({
                id: 'attach-current-note',
                name: t('cmd.attachCurrentNote'),
                callback: async () => {
                    const file = this.app.workspace.getActiveFile();
                    if (file) {
                        await this.attachToChat([file.path]);
                    } else {
                        new Notice(t('attach.noActiveNote'));
                    }
                }
            });

            // P2.4 右键菜单：笔记文件 → 附加到 BuddyBridge 会话
            this.registerEvent(
                this.app.workspace.on('file-menu', (menu: Menu, file) => {
                    if (!(file instanceof TFile)) return;
                    menu.addItem((item) => {
                        item
                            .setTitle(tF('attach.menu'))
                            .setIcon('paperclip')
                            .onClick(() => void this.attachToChat([file.path]));
                    });
                })
            );

            this.addSettingTab(new BuddyBridgeSettingTab(this.app, this));
            this.applyPrimaryColor();
            this.applyFontSize();
        } catch (e) {
            console.error('[BB] 插件加载失败:', e);
            new Notice('BuddyBridge 加载失败，请查看 Console');
        }
    }

    onunload() {
        this.api.cancel();
    }

    async activateView() {
        try {
            const { workspace } = this.app;
            let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];

            if (!leaf) {
                // 全新 Obsidian 环境下右侧边栏可能还没有 leaf，先尝试创建右侧 leaf
                leaf = workspace.getRightLeaf(true);

                if (!leaf) {
                    // 右侧边栏也创建失败时，回退到创建普通 root leaf
                    leaf = workspace.getLeaf(true);
                }

                if (leaf) {
                    await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
                }
            }

            if (leaf) {
                await workspace.revealLeaf(leaf);
                workspace.setActiveLeaf(leaf, { focus: true });
            } else {
                new Notice('BuddyBridge：无法创建聊天面板');
            }
        } catch (e) {
            console.error('[BB] 打开聊天面板失败:', e);
            new Notice('BuddyBridge：打开面板失败，请查看 Console');
        }
    }

    /** P2.4 附加文件到当前聊天会话（右键菜单 / 命令共用）：面板未打开时先激活。 */
    private async attachToChat(paths: string[]): Promise<void> {
        if (!this.chatView) {
            await this.activateView();
        }
        if (!this.chatView) {
            new Notice('BuddyBridge：请先打开聊天面板');
            return;
        }
        this.chatView.attachFiles(paths);
    }

    async loadSettings() {
        const data = normalizePersistedData(await this.loadData());
        this.settings = migrateSettings(data.settings);
    }

    async saveSettings() {
        const existingData = normalizePersistedData(await this.loadData());
        const merged: PersistedData = { ...existingData, settings: this.settings };
        await this.saveData(merged);
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        this.api.setNodePath(this.settings.nodePath);
        this.api.setTimeoutMs(this.settings.timeoutSeconds * 1000);
        // 同步已打开的聊天面板（如最大对话数等即时生效的设置）
        if (this.chatView) {
            this.chatView.getManager().setMaxConversations(this.settings.maxConversations);
        }
        this.applyPrimaryColor();
        this.applyFontSize();
    }

    // ==================== 导出 / 导入（P2.6）====================

    /** 导出设置 + 聊天记录为带版本号的 JSON 文件。 */
    async exportData(): Promise<void> {
        try {
            const data = normalizePersistedData(await this.loadData());
            const payload = buildExportPayload(data.settings ?? {}, data.conversations ?? []);
            const json = serializeExport(payload);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            downloadJSONFile(`buddybridge-backup-${stamp}.json`, json);
            new Notice('已导出设置与聊天记录');
        } catch (e) {
            console.error('[BB] 导出失败:', e);
            new Notice(`导出失败：${getErrorMessage(e)}`);
        }
    }

    /** 弹出文件选择框 → 解析校验 → 二次确认后导入。 */
    async importDataFromFile(): Promise<void> {
        try {
            const json = await pickAndReadJSONFile();
            if (!json) return;
            const payload = parseExport(json);
            if (!payload) {
                new Notice('导入失败：文件格式不正确，或导出版本与本插件不兼容');
                return;
            }
            new ConfirmModal(
                this.app,
                `导入将覆盖当前设置与 ${payload.conversations.length} 条聊天记录，是否继续？`,
                async () => {
                    await this.importData(payload);
                    new Notice('导入成功');
                }
            ).open();
        } catch (e) {
            console.error('[BB] 导入失败:', e);
            new Notice(`导入失败：${getErrorMessage(e)}`);
        }
    }

    /** 应用已校验的导出数据：覆盖设置与聊天记录，并刷新 API 与聊天视图。 */
    async importData(payload: BuddyBridgeExport): Promise<void> {
        const data = normalizePersistedData(await this.loadData());
        data.settings = payload.settings;
        data.conversations = payload.conversations;
        await this.saveData(data);

        this.settings = migrateSettings(payload.settings);
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        this.api.setNodePath(this.settings.nodePath);
        this.api.setTimeoutMs(this.settings.timeoutSeconds * 1000);
        this.applyPrimaryColor();
        this.applyFontSize();

        if (this.chatView) {
            await this.chatView.loadConversations(payload.conversations);
        }
    }

    applyPrimaryColor() {
        try {
            // setCssProps 的 key 原样透传（不自动补 --），CSS 变量必须带前缀
            const value = this.settings.primaryColor || 'var(--interactive-accent)';
            const containers = document.querySelectorAll('.buddybridge-chat-container');
            containers.forEach((container) => {
                if (container instanceof HTMLElement) {
                    container.setCssProps({ '--buddybridge-primary': value });
                }
            });
        } catch (e) {
            console.error('[BB] 应用主色调失败:', e);
        }
    }

    /** 应用聊天区字体大小（气泡 + Markdown 内容 + 输入框，经 --buddybridge-font-size 变量）。 */
    applyFontSize() {
        try {
            const value = `${this.settings.fontSize}px`;
            const containers = document.querySelectorAll('.buddybridge-chat-container');
            containers.forEach((container) => {
                if (container instanceof HTMLElement) {
                    container.setCssProps({ '--buddybridge-font-size': value });
                }
            });
        } catch (e) {
            console.error('[BB] 应用字体大小失败:', e);
        }
    }
}
