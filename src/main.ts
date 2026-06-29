import { Notice, Plugin } from 'obsidian';
import { BuddyBridgeAPI } from './api';
import { BuddyBridgeChatView, VIEW_TYPE_CHAT } from './views/chat';
import { migrateSettings, normalizePersistedData, type BuddyBridgeSettings, type PersistedData } from './types';
import { BuddyBridgeSettingTab } from './settings/tab';

export default class BuddyBridgePlugin extends Plugin {
    settings: BuddyBridgeSettings;
    api: BuddyBridgeAPI;
    chatView: BuddyBridgeChatView | null = null;

    async onload() {
        try {
            await this.loadSettings();

            this.api = new BuddyBridgeAPI();
            this.api.setCodebuddyPath(this.settings.codebuddyPath);

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

            this.addSettingTab(new BuddyBridgeSettingTab(this.app, this));
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

    async loadPersistedConversations() {
        const data = normalizePersistedData(await this.loadData());
        if (this.chatView) {
            await this.chatView.loadConversations(data.conversations || []);
        }
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
    }
}
