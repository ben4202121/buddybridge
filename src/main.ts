import { Plugin, WorkspaceLeaf } from 'obsidian';
import { BuddyBridgeAPI } from './api';
import { BuddyBridgeChatView, VIEW_TYPE_CHAT } from './views/chat';
import { DEFAULT_SETTINGS, migrateSettings, type BuddyBridgeSettings } from './types';
import { BuddyBridgeSettingTab } from './settings/tab';

export default class BuddyBridgePlugin extends Plugin {
    settings: BuddyBridgeSettings;
    api: BuddyBridgeAPI;
    chatView: BuddyBridgeChatView | null = null;

    async onload() {
        await this.loadSettings();

        this.api = new BuddyBridgeAPI();
        this.api.setCodebuddyPath(this.settings.codebuddyPath);

        // 注册聊天视图
        this.registerView(
            VIEW_TYPE_CHAT,
            (leaf) => {
                const view = new BuddyBridgeChatView(leaf, this.api);

                // 持久化回调
                view.getManager().setPersistCallback(async (conversations) => {
                    const data = (await this.loadData()) || {};
                    data.conversations = conversations;
                    await this.saveData(data);
                });

                // 加载已持久化的对话
                this.loadPersistedConversations();

                return view;
            }
        );

        // Ribbon 按钮
        this.addRibbonIcon('bot', 'BuddyBridge 聊天', async () => {
            await this.activateView();
        });

        // 命令面板
        this.addCommand({
            id: 'buddybridge-open-chat',
            name: '打开聊天面板',
            callback: async () => {
                await this.activateView();
            }
        });

        this.addSettingTab(new BuddyBridgeSettingTab(this.app, this));
    }

    onunload() {
        this.api.cancel();
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];

        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf();
            if (rightLeaf) {
                await rightLeaf.setViewState({ type: VIEW_TYPE_CHAT });
                leaf = rightLeaf;
            }
        }

        if (leaf) {
            workspace.setActiveLeaf(leaf, { focus: true });
        }
    }

    async loadPersistedConversations() {
        const data = await this.loadData();
        if (this.chatView) {
            this.chatView.loadConversations(data?.conversations || []);
        }
    }

    async loadSettings() {
        const stored = await this.loadData();
        this.settings = migrateSettings(stored);
    }

    async saveSettings() {
        const existingData = (await this.loadData()) || {};
        const merged = { ...existingData, ...this.settings };
        await this.saveData(merged);
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
    }
}
