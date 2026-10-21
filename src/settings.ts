import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { isObject } from './extract';
import { PRO_UI } from './pro';
import type BasesViewExtractPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface Preset { name: string; sourcePath: string; source: string; views: string[] }
export interface ExtractSettings { presets: Preset[] }

export function normalizeSettings(saved: unknown): ExtractSettings {
	if (!isObject(saved) || !Array.isArray(saved.presets)) return { presets: [] };
	const presets: Preset[] = [];
	for (const value of saved.presets as unknown[]) {
		if (!isObject(value) || typeof value.name !== 'string' || !value.name.trim() || typeof value.sourcePath !== 'string' || typeof value.source !== 'string' || !Array.isArray(value.views)) continue;
		const views = value.views.filter((v: unknown): v is string => typeof v === 'string' && !!v.trim());
		if (!views.length || views.length !== value.views.length || new Set(views).size !== views.length || presets.some((p) => p.name === value.name)) continue;
		presets.push({ name: value.name, sourcePath: value.sourcePath, source: value.source, views });
	}
	return { presets };
}

export class ExtractSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private extractPlugin: BasesViewExtractPlugin) {
		super(app, extractPlugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.extractPlugin.pro ? sponsorsSettingItems(this.extractPlugin.pro, PRO_UI) : []),
			{ name: 'Query presets', desc: 'Save and load presets in the extraction window. A preset is a local snapshot. Delete it there to remove the saved copy.' },
			{ name: 'Query context', desc: 'An embedded query uses the target note as its context. Check expressions with this and relative links before insertion. YAML comments and spacing are not kept.' },
		];
	}
}
