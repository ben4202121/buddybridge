import { FuzzySuggestModal, TFile, App } from 'obsidian';
import { type AttachedFile } from '../types';

const ALLOWED_EXTENSIONS = new Set(['txt', 'md', 'docx', 'doc', 'pdf', 'xls', 'xlsx']);

export class VaultFilePickerModal extends FuzzySuggestModal<TFile> {
    private onSelect: (file: AttachedFile) => void;
    private files: TFile[];

    constructor(app: App, onSelect: (file: AttachedFile) => void) {
        super(app);
        this.onSelect = onSelect;
        this.files = app.vault.getFiles().filter(f => ALLOWED_EXTENSIONS.has(f.extension.toLowerCase()));
        this.setPlaceholder('搜索文件...');
        this.setInstructions([{ command: '', purpose: '选择要附加的文件（按 Enter 确认）' }]);
        this.limit = 50;
    }

    getItems(): TFile[] {
        return this.files;
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onSelect({
            name: file.name,
            path: file.path,
            extension: file.extension,
        });
    }
}