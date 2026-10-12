import { MarkdownView, Modal, parseYaml, type EditorPosition } from 'obsidian';
import { buildExtract, viewNames } from './extract';
import { isPro, onProChange } from './pro';
import type BasesViewExtractPlugin from './main';

export class ExtractModal extends Modal {
	private source = '';
	private sourcePath = '';
	private names: string[] = [];
	private chosen: string[] = [];
	private batch = false;
	private fromPreset = false;
	private request = 0;
	private opened = false;
	private offPro: (() => void) | null = null;
	private text = '';
	private initialText: string;
	private anchor: EditorPosition;
	private head: EditorPosition;
	private targetPath: string;
	private viewArea!: HTMLElement;
	private preview!: HTMLTextAreaElement;
	private status!: HTMLElement;
	private insertButton!: HTMLButtonElement;
	private presetSelect!: HTMLSelectElement;
	private baseSelect!: HTMLSelectElement;

	constructor(private extractPlugin: BasesViewExtractPlugin, private target: MarkdownView) {
		super(extractPlugin.app);
		this.initialText = target.editor.getValue();
		this.anchor = target.editor.getCursor('anchor');
		this.head = target.editor.getCursor('head');
		this.targetPath = target.file?.path ?? '';
		this.shouldRestoreSelection = false;
	}

	onOpen(): void {
		this.opened = true;
		this.extractPlugin.modals.add(this);
		this.offPro = onProChange(() => this.updatePreview());
		this.setTitle('Extract a saved view');
		this.modalEl.addClass('bve-modal');
		const el = this.contentEl;
		el.createEl('p', { text: 'Choose a file and a named view. Check the complete query before you insert it.' });
		const fileLabel = el.createEl('label', { text: 'Base file', cls: 'bve-field' });
		this.baseSelect = fileLabel.createEl('select', { attr: { 'aria-label': 'Base file', 'data-bve': 'file' } });
		this.option(this.baseSelect, '', 'Select a .base file');
		for (const file of this.app.vault.getFiles().filter((f) => f.extension === 'base').sort((a, b) => a.path.localeCompare(b.path))) this.option(this.baseSelect, file.path, file.path);
		this.baseSelect.addEventListener('change', () => { void this.loadFile(this.baseSelect.value); });
		this.viewArea = el.createDiv({ cls: 'bve-views' });
		const batchLabel = el.createEl('label', { cls: 'bve-batch' });
		const batchToggle = batchLabel.createEl('input', { type: 'checkbox', attr: { 'data-bve': 'batch' } });
		batchLabel.appendText(' Several views in separate sections (Pro)');
		batchToggle.addEventListener('change', () => {
			if (batchToggle.checked && !isPro()) { batchToggle.checked = false; this.showError('Several views need Pro. Sign in in the plugin settings.'); return; }
			this.batch = batchToggle.checked;
			this.chosen = this.chosen.slice(0, 1);
			this.renderViews();
			this.updatePreview();
		});
		el.createEl('p', { text: 'The target note supplies the query context. YAML comments and original spacing are not kept. A community view type needs its provider.', cls: 'bve-hint' });
		this.status = el.createDiv({ cls: 'bve-status', attr: { role: 'status', 'aria-live': 'polite', 'data-bve': 'status' } });
		this.preview = el.createEl('textarea', { cls: 'bve-preview', attr: { 'aria-label': 'Complete query preview', readonly: '', spellcheck: 'false', 'data-bve': 'preview' } });
		const actions = el.createDiv({ cls: 'bve-actions' });
		this.insertButton = this.button(actions, 'Insert at selection', () => this.insert());
		this.insertButton.dataset.bve = 'insert';
		this.insertButton.addClass('mod-cta');
		this.button(actions, 'Cancel', () => this.close());
		const presets = el.createDiv({ cls: 'bve-presets' });
		const nameLabel = presets.createEl('label', { text: 'Preset name', cls: 'bve-field' });
		const name = nameLabel.createEl('input', { type: 'text', attr: { 'aria-label': 'Preset name', 'data-bve': 'preset-name' } });
		this.button(presets, 'Save preset', () => { void this.savePreset(name.value); }).dataset.bve = 'save';
		this.presetSelect = presets.createEl('select', { attr: { 'aria-label': 'Saved presets', 'data-bve': 'presets' } });
		this.renderPresets();
		this.button(presets, 'Load preset', () => this.loadPreset()).dataset.bve = 'load';
		this.button(presets, 'Delete preset', () => { void this.deletePreset(); }).dataset.bve = 'delete';
		this.updatePreview();
	}

	private option(select: HTMLSelectElement, value: string, text: string): void {
		select.createEl('option', { text, value });
	}
	private button(el: HTMLElement, text: string, click: () => void): HTMLButtonElement {
		const button = el.createEl('button', { text, attr: { type: 'button' } });
		button.addEventListener('click', click);
		return button;
	}
	private showError(error: unknown): void {
		this.text = '';
		this.preview.value = '';
		this.insertButton.disabled = true;
		this.status.setText(error instanceof Error ? error.message : String(error));
		this.status.addClass('bve-error');
	}
	async loadFile(path: string): Promise<void> {
		const token = ++this.request;
		this.source = '';
		this.chosen = [];
		this.names = [];
		this.fromPreset = false;
		this.sourcePath = path;
		this.renderViews();
		this.updatePreview();
		if (!path) return;
		try {
			const file = this.app.vault.getFileByPath(path);
			if (!file || file.extension !== 'base') throw new Error('The Base file was not found.');
			const source = await this.app.vault.read(file);
			if (token !== this.request || !this.opened) return;
			const names = viewNames(parseYaml(source) as unknown);
			this.source = source;
			this.names = names;
			this.chosen = names.slice(0, 1);
			this.renderViews();
			this.updatePreview();
		} catch (error) { if (token === this.request && this.opened) this.showError(error); }
	}
	private renderViews(): void {
		this.viewArea.empty();
		if (!this.names.length) return;
		if (this.batch) {
			this.viewArea.createEl('p', { text: 'Select views in source order.' });
			for (const name of this.names) {
				const label = this.viewArea.createEl('label', { cls: 'bve-view-choice' });
				const input = label.createEl('input', { type: 'checkbox', attr: { 'data-bve-view': name } });
				input.checked = this.chosen.includes(name);
				label.appendText(` ${name}`);
				input.addEventListener('change', () => {
					const selected = new Set(this.chosen);
					if (input.checked) selected.add(name); else selected.delete(name);
					this.chosen = this.names.filter((n) => selected.has(n));
					this.updatePreview();
				});
			}
		} else {
			const label = this.viewArea.createEl('label', { text: 'Named view', cls: 'bve-field' });
			const select = label.createEl('select', { attr: { 'aria-label': 'Named view', 'data-bve': 'view' } });
			for (const name of this.names) this.option(select, name, name);
			select.value = this.chosen[0] ?? '';
			select.addEventListener('change', () => { this.chosen = [select.value]; this.updatePreview(); });
		}
	}
	private updatePreview(): void {
		try {
			if ((this.chosen.length > 1 || this.fromPreset) && !isPro()) throw new Error('This extraction needs Pro. Select a Base and one view for free extraction.');
			const result = buildExtract(this.source, this.chosen);
			this.text = `${this.target.editor.getCursor('from').ch > 0 ? '\n' : ''}${result.text}`;
			this.preview.value = this.text;
			this.insertButton.disabled = false;
			this.status.removeClass('bve-error');
			this.status.setText(result.warning ? 'Context warning: this or a link can resolve differently in the target note. Check the query before insertion.' : 'Ready. Check the query before insertion.');
		} catch (error) { this.showError(error); }
	}
	insert(): void {
		this.updatePreview();
		if (!this.text) return;
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = this.target.editor;
		if (active !== this.target || active.file?.path !== this.targetPath || editor.getValue() !== this.initialText || editor.listSelections().length !== 1 || JSON.stringify(editor.getCursor('anchor')) !== JSON.stringify(this.anchor) || JSON.stringify(editor.getCursor('head')) !== JSON.stringify(this.head)) {
			this.showError('The target note or selection changed. Close this window and start again.');
			return;
		}
		editor.replaceSelection(this.text);
		this.close();
	}
	private renderPresets(): void {
		this.presetSelect.empty();
		this.option(this.presetSelect, '', 'Select a saved preset');
		for (const preset of this.extractPlugin.settings.presets) this.option(this.presetSelect, preset.name, preset.name);
	}
	private async savePreset(name: string): Promise<void> {
		try {
			if (!this.text) throw new Error('Select a valid query first.');
			await this.extractPlugin.savePreset({ name, sourcePath: this.sourcePath, source: this.source, views: [...this.chosen] });
			if (!this.opened) return;
			this.renderPresets();
			this.presetSelect.value = name.trim();
			this.status.setText('Preset saved on this vault.');
		} catch (error) { this.showError(error); }
	}
	private loadPreset(): void {
		try {
			if (!isPro()) throw new Error('Named query presets need Pro. Sign in in the plugin settings.');
			const preset = this.extractPlugin.settings.presets.find((p) => p.name === this.presetSelect.value);
			if (!preset) throw new Error('Select a saved preset.');
			++this.request;
			this.source = preset.source;
			this.sourcePath = preset.sourcePath;
			this.names = viewNames(parseYaml(preset.source) as unknown);
			this.chosen = [...preset.views];
			this.batch = preset.views.length > 1;
			this.fromPreset = true;
			this.baseSelect.value = '';
			const toggle = this.contentEl.querySelector<HTMLInputElement>('[data-bve="batch"]');
			if (toggle) toggle.checked = this.batch;
			this.renderViews();
			this.updatePreview();
		} catch (error) { this.showError(error); }
	}
	private async deletePreset(): Promise<void> {
		try {
			await this.extractPlugin.deletePreset(this.presetSelect.value);
			if (this.opened) { this.renderPresets(); this.status.setText('Preset deleted.'); }
		} catch (error) { this.showError(error); }
	}
	onClose(): void {
		this.opened = false;
		++this.request;
		this.offPro?.();
		this.offPro = null;
		this.extractPlugin.modals.delete(this);
		this.contentEl.empty();
	}
}
