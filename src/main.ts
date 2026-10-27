import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { PRO_PRESETS, SPONSORS, bindPro, isPro, proText, resetPro } from './pro';
import { ExtractSettingTab, normalizeSettings, type ExtractSettings, type Preset } from './settings';
import { ExtractModal } from './modal';
import { buildExtract } from './extract';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class BasesViewExtractPlugin extends Plugin {
	settings: ExtractSettings = { presets: [] };
	pro: SponsorsManager | null = null;
	readonly modals = new Set<ExtractModal>();
	private presetWrites: Promise<void> = Promise.resolve();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new ExtractSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'extract-view', name: 'Extract a saved view', editorCallback: () => this.openExtract() });
		this.app.workspace.onLayoutReady(() => {
			if (this.pro !== pro) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		this.pro = null;
		for (const modal of this.modals) modal.close();
		resetPro();
	}
	openExtract(): ExtractModal | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) { new Notice('Open a Markdown note first.'); return null; }
		const modal = new ExtractModal(this, view);
		modal.open();
		return modal;
	}
	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData() as unknown);
	}
	/** Sync can write data.json while the plugin runs. Reload it in the write queue. */
	async onExternalSettingsChange(): Promise<void> {
		await this.queuePresetWrite(() => this.loadSettings());
	}
	private queuePresetWrite(write: () => Promise<void>): Promise<void> {
		const pending = this.presetWrites.then(write);
		this.presetWrites = pending.catch(() => {});
		return pending;
	}
	async saveSettings(): Promise<void> {
		await this.queuePresetWrite(() => this.saveData(this.settings));
	}
	async savePreset(preset: Preset): Promise<void> {
		const next = { ...preset, name: preset.name.trim(), views: [...preset.views] };
		await this.queuePresetWrite(async () => {
			if (!isPro()) throw new Error(proText(PRO_PRESETS));
			if (!next.name) throw new Error('Enter a preset name.');
			buildExtract(next.source, next.views);
			await this.loadSettings();
			if (this.settings.presets.some((p) => p.name === next.name)) throw new Error('That preset name exists. Delete it or use a new name.');
			const presets = [...this.settings.presets, next];
			await this.saveData({ presets });
			this.settings.presets = presets;
		});
	}
	async deletePreset(name: string): Promise<void> {
		await this.queuePresetWrite(async () => {
			await this.loadSettings();
			const presets = this.settings.presets.filter((p) => p.name !== name);
			await this.saveData({ presets });
			this.settings.presets = presets;
		});
	}
}
