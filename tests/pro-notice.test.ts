import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { MarkdownView } from 'obsidian';
import type { SponsorsManager } from '../src/license/index';
import BasesViewExtractPlugin from '../src/main';
import { ExtractModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select "Several views in separate sections (Pro)", "Save preset" and "Load preset". Each select
// shows the shared Pro notice with the "Sponsor on GitHub" button. The toggle shows off again, no preset is saved or
// loaded, and the free preview of one view stays ready.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const BATCH = 'Several views need Pro.';
const PRESETS = 'Named query presets need Pro.';
const SOURCE = 'filters:\n  and: [x]\nviews:\n  - name: A\n    type: table\n  - name: B\n    type: table\n';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'bases-view-extract' },
	} as unknown as SponsorsManager;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const modals: ExtractModal[] = [];

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'a.md': 'Before\nREPLACE\nAfter', 'Example.base': SOURCE } });
	const editor = { getValue: () => 'Before\nREPLACE\nAfter', getCursor: () => ({ line: 1, ch: 0 }), listSelections: () => [{}], replaceSelection: vi.fn() };
	const target = { editor, file: app.vault.getFileByPath('a.md') } as unknown as MarkdownView;
	const p = new BasesViewExtractPlugin(app as never, manifest as never);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	// The mock open() closes the modal after one tick, so draw it with onOpen().
	const m = new ExtractModal(p, target); modals.push(m); m.onOpen();
	await m.loadFile('Example.base');
	const q = <T extends HTMLElement>(k: string) => m.contentEl.querySelector<T>(`[data-bve="${k}"]`)!;
	return { p, m, shown, q };
}

describe('Pro controls of the extraction window', () => {
	afterEach(() => { for (const m of modals.splice(0)) m.close(); resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Several views, Save preset or Load preset gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		const { p, m, shown, q } = await setup(false);
		p.settings.presets = [{ name: 'Old', sourcePath: 'Example.base', source: SOURCE, views: ['A', 'B'] }];
		const saveData = vi.spyOn(p, 'saveData');
		const savePreset = vi.spyOn(p, 'savePreset');
		const before = q<HTMLTextAreaElement>('preview').value;
		expect(before).toContain('name: A');
		const toggle = q<HTMLInputElement>('batch');
		toggle.checked = true; toggle.dispatchEvent(new Event('change'));
		// The toggle shows its true state: off. The free preview, Insert and Copy stay ready.
		expect(toggle.checked).toBe(false);
		expect(m.contentEl.querySelectorAll('[data-bve-view]').length).toBe(0);
				q<HTMLInputElement>('preset-name').value = 'Review';
		q<HTMLButtonElement>('save').click(); await flush();
		// A lapsed sponsor with a saved preset: Load preset does not load it.
		const list = q<HTMLSelectElement>('presets');
		list.createEl('option', { text: 'Old', value: 'Old' }); list.value = 'Old';
		q<HTMLButtonElement>('load').click(); await flush();
		expect(shown).toEqual([
			{ text: `${BATCH} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRESETS} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRESETS} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(savePreset).not.toHaveBeenCalled();
		expect(saveData).not.toHaveBeenCalled();
		expect(q<HTMLTextAreaElement>('preview').value).toBe(before);
		expect(q<HTMLButtonElement>('insert').disabled).toBe(false);
		expect(q<HTMLButtonElement>('copy').disabled).toBe(false);
		expect(q('status').classList.contains('bve-error')).toBe(false);
	});

	it('a Pro user who selects Several views and Save preset gets the sections and saves the preset, with no Pro notice', async () => {
		const { p, m, shown, q } = await setup(true);
		vi.spyOn(p, 'loadData').mockResolvedValue({ presets: [] });
		const saveData = vi.spyOn(p, 'saveData').mockResolvedValue();
		const toggle = q<HTMLInputElement>('batch');
		toggle.checked = true; toggle.dispatchEvent(new Event('change'));
		expect(toggle.checked).toBe(true);
		expect(m.contentEl.querySelectorAll('[data-bve-view]').length).toBe(2);
		q<HTMLInputElement>('preset-name').value = 'Review';
		q<HTMLButtonElement>('save').click();
		await vi.waitFor(() => { expect(saveData).toHaveBeenCalled(); });
		expect(p.settings.presets.map((x) => x.name)).toEqual(['Review']);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});

