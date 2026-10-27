import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type BasesViewExtractPlugin from '../../src/main';
import { pluginId } from './load';

// A free user can select "Several views in separate sections (Pro)" and "Save preset". Each select shows the shared
// Pro notice with the "Sponsor on GitHub" button. The toggle shows off again, no preset is saved, and the free preview
// of one view stays ready. A Pro user turns the same toggle on and gets one section for each view.
type Host = { plugins: { plugins: Record<string, BasesViewExtractPlugin> } };
const SOURCE = 'filters:\n  and:\n    - file.ext == "md"\nviews:\n  - name: A\n    type: table\n  - name: B\n    type: table\n';

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as Host).plugins.plugins[id]!;
		if (!on) { p.pro?.signOut(); return; }
		// Synthetic token and HTTP answer. No network request.
		const pro = p.pro! as unknown as { opts: { http: unknown }; refreshNow(): Promise<unknown> };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await pro.refreshNow();
	}, pluginId, on);
}

async function openWindow(): Promise<void> {
	await obsidianPage.write('Example.base', SOURCE);
	await obsidianPage.write('Pro target.md', 'Before\nREPLACE\nAfter');
	await obsidianPage.openFile('Pro target.md');
	await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.file?.path === 'Pro target.md'), { timeout: 15000, timeoutMsg: 'Target editor is ready' });
	await browser.executeObsidianCommand(`${pluginId}:extract-view`);
	await browser.$('[data-bve="file"]').waitForExist();
	await browser.$('[data-bve="file"]').selectByAttribute('value', 'Example.base');
	await browser.waitUntil(async () => browser.$('[data-bve="insert"]').isEnabled(), { timeout: 10000, timeoutMsg: 'Query preview is ready' });
}

/** Selects the control, then returns the notices, the window state and the saved presets. */
async function select(key: string) {
	return browser.executeObsidian(async ({ app }, id, key) => {
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
		const root = activeDocument.querySelector('.bve-modal')!;
		const q = <T extends HTMLElement>(k: string) => root.querySelector<T>(`[data-bve="${k}"]`)!;
		if (key === 'save') q<HTMLInputElement>('preset-name').value = 'Free try';
		q(key).click();
		await new Promise((r) => setTimeout(r, 500));
		const p = (app as unknown as Host).plugins.plugins[id]!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			batch: q<HTMLInputElement>('batch').checked,
			views: root.querySelectorAll('[data-bve-view]').length,
			preview: q<HTMLTextAreaElement>('preview').value,
			insert: !q<HTMLButtonElement>('insert').disabled,
			presets: JSON.stringify(((await p.loadData()) as { presets?: unknown[] } | null)?.presets ?? []),
		};
	}, pluginId, key);
}

describe('Pro controls of the extraction window', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }, id) => { for (const m of (app as unknown as Host).plugins.plugins[id]!.modals) m.close(); }, pluginId);
		await setPro(false);
	});

	it('a free user who selects Several views or Save preset gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		await setPro(false);
		await openWindow();
		const before = await browser.$('[data-bve="preview"]').getValue();
		const batch = await select('batch');
		if (!batch.notices.some((n) => n.text.includes('Several views need Pro.') && n.sponsor === 1)) throw new Error(`No Pro notice after Several views: ${JSON.stringify(batch.notices)}`);
		expect(batch.batch).toBe(false);
		expect(batch.views).toBe(0);
		expect(batch.preview).toBe(before);
		expect(batch.insert).toBe(true);
		const save = await select('save');
		if (!save.notices.some((n) => n.text.includes('Named query presets need Pro.') && n.sponsor === 1)) throw new Error(`No Pro notice after Save preset: ${JSON.stringify(save.notices)}`);
		expect(save.presets).toBe('[]');
		expect(save.preview).toBe(before);
	});

	it('a Pro user who selects Several views turns it on and gets no Pro notice', async () => {
		await setPro(true);
		await openWindow();
		const batch = await select('batch');
		expect(batch.batch).toBe(true);
		expect(batch.views).toBe(2);
		expect(batch.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
