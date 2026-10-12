import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type BasesViewExtractPlugin from '../../src/main';
import { pluginId } from './load';

const SOURCE = 'filters:\n  and:\n    - file.ext == "md"\nformulas:\n  cost: "hours * rate"\nsummaries:\n  custom: "values.reduce(sum)"\nproperties:\n  formula.cost:\n    displayName: Cost\nfuture:\n  flag: false\n  keys: [1, null, 3]\nviews:\n  - name: A\n    type: table\n  - name: B\n    type: table\n    filters:\n      and:\n        - status == "open"\n    order: [file.name, formula.cost]\n    summaries:\n      formula.cost: custom\n    groupOrder: [B, null, A]\n    futureOption:\n      x: 7\n';

let nextTarget = 0;
async function prepare(source = SOURCE): Promise<void> {
	const targetPath = `Target-${++nextTarget}.md`;
	await browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesViewExtractPlugin> } }).plugins.plugins[id]!;
		for (const m of p.modals) m.close();
		p.pro?.signOut();
	}, pluginId);
	await obsidianPage.write('Example.base', source);
	await obsidianPage.write(targetPath, 'Before\nREPLACE\nAfter');
	await obsidianPage.openFile(targetPath);
	await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }, path) => {
		const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return v?.file?.path === path && v.editor.getValue() === 'Before\nREPLACE\nAfter';
	}, targetPath), { timeout: 15000, timeoutMsg: 'Target editor is ready' });
	await browser.executeObsidian(({ app, obsidian }) => {
		const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		v.editor.setSelection({ line: 1, ch: 0 }, { line: 1, ch: 7 });
		v.editor.focus();
	});
	await browser.executeObsidianCommand(`${pluginId}:extract-view`);
	await browser.$('[data-bve="file"]').waitForExist();
	await browser.$('[data-bve="file"]').selectByAttribute('value', 'Example.base');
}
async function ready(): Promise<void> {
	await browser.waitUntil(async () => browser.$('[data-bve="insert"]').isEnabled(), { timeout: 10000, timeoutMsg: 'Query preview is ready' });
}
async function selectB(): Promise<void> {
	await ready(); await browser.$('[data-bve="view"]').selectByAttribute('value', 'B'); await ready();
}
async function text(): Promise<string> { return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue()); }
async function setPro(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesViewExtractPlugin> } }).plugins.plugins[id]!;
		const pro = p.pro! as unknown as { opts: { http: unknown }; refreshNow(): Promise<unknown> };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await pro.refreshNow();
	}, pluginId);
}

describe('view extraction in the real app', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, BasesViewExtractPlugin> } }).plugins.plugins[id]!;
			for (const m of p.modals) m.close(); p.pro?.signOut();
		}, pluginId);
	});
	it('selects B, previews shared fields and replaces only the selection', async () => {
		await prepare(); await selectB();
		const preview = await browser.$('[data-bve="preview"]').getValue();
		expect(preview).toContain('name: B'); expect(preview).not.toContain('name: A');
		await browser.$('[data-bve="insert"]').click();
		const output = await text(); expect(output).toBe(`Before\n${preview}\nAfter`);
		const result = await browser.executeObsidian(async ({ app, obsidian }, output) => ({
			config: obsidian.parseYaml(output.split('```base\n')[1]!.split('\n```')[0]!),
			source: await app.vault.read(app.vault.getFileByPath('Example.base')!),
		}), output);
		expect(result.source).toBe(SOURCE);
		expect(result.config).toMatchObject({ filters: { and: ['file.ext == "md"'] }, formulas: { cost: 'hours * rate' }, summaries: { custom: 'values.reduce(sum)' }, properties: { 'formula.cost': { displayName: 'Cost' } }, future: { flag: false, keys: [1, null, 3] }, views: [{ name: 'B', filters: { and: ['status == "open"'] }, groupOrder: ['B', null, 'A'], futureOption: { x: 7 } }] });
	});
	it('reports an ambiguous view and leaves source and editor unchanged', async () => {
		const source = 'views:\n  - name: B\n  - name: B\n'; await prepare(source);
		await browser.waitUntil(async () => (await browser.$('[data-bve="status"]').getText()).includes('ambiguous'), { timeout: 10000 });
		expect(await browser.$('[data-bve="insert"]').isEnabled()).toBe(false); expect(await text()).toBe('Before\nREPLACE\nAfter');
		expect(await browser.executeObsidian(({ app }) => app.vault.read(app.vault.getFileByPath('Example.base')!))).toBe(source);
	});
	it('keeps trailing blank lines in a provider value after insertion', async () => {
		await prepare('views:\n  - name: B\n    type: table\n    providerText: |+\n      Keep these lines\n\n\n');
		await ready();
		await browser.$('[data-bve="insert"]').click();
		const output = await text();
		const config = await browser.executeObsidian(({ obsidian }, value) => obsidian.parseYaml(value.split('```base\n')[1]!.split('```\n')[0]!), output);
		expect(config.views[0].providerText).toBe('Keep these lines\n\n\n');
	});
	it('shows a YAML parse error with no insertion', async () => {
		await prepare('views: [');
		await browser.waitUntil(async () => (await browser.$('[data-bve="status"]').getText()).includes('line'), { timeout: 10000 });
		expect(await browser.$('[data-bve="preview"]').getValue()).toBe(''); expect(await text()).toBe('Before\nREPLACE\nAfter');
	});
	it('shows the context warning before insertion', async () => {
		await prepare('filters: "file.name == this.file.name"\nformulas:\n  relative: "[[../Plan]]"\nviews:\n  - name: B\n    type: table\n'); await ready();
		expect(await browser.$('[data-bve="status"]').getText()).toContain('Context warning'); expect(await text()).toBe('Before\nREPLACE\nAfter');
	});
	it('rejects a changed target editor', async () => {
		await prepare(); await selectB();
		await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setValue('New text'));
		await browser.$('[data-bve="insert"]').click();
		expect(await browser.$('[data-bve="status"]').getText()).toContain('changed'); expect(await text()).toBe('New text');
	});
	it('keeps batch and presets behind the sponsorship check', async () => {
		await prepare(); await selectB(); await browser.$('[data-bve="batch"]').click();
		expect(await browser.$('[data-bve="status"]').getText()).toContain('need Pro'); expect(await text()).toBe('Before\nREPLACE\nAfter');
		await browser.$('[data-bve="preset-name"]').setValue('Free denied'); await browser.$('[data-bve="save"]').click();
		expect(await browser.$('[data-bve="status"]').getText()).toContain('query');
	});
	it('Pro inserts complete queries in separate sections', async () => {
		await prepare(); await ready(); await setPro(); await browser.$('[data-bve="batch"]').click();
		await browser.$('[data-bve-view="B"]').click(); await ready();
		const preview = await browser.$('[data-bve="preview"]').getValue(); expect(preview).toContain('## A'); expect(preview).toContain('## B'); expect(preview.match(/filters:/g)?.length).toBe(3);
		await browser.$('[data-bve="insert"]').click(); expect(await text()).toBe(`Before\n${preview}\nAfter`);
	});
	it('Pro stores and loads a snapshot after the source changes', async () => {
		await prepare(); await selectB(); await setPro();
		await browser.$('[data-bve="preset-name"]').setValue('Review'); await browser.$('[data-bve="save"]').click();
		await browser.waitUntil(async () => (await browser.$('[data-bve="status"]').getText()).includes('saved'), { timeout: 10000 });
		const original = await browser.$('[data-bve="preview"]').getValue();
		await obsidianPage.write('Example.base', 'views:\n  - name: Different\n');
		await browser.$('[data-bve="presets"]').selectByAttribute('value', 'Review'); await browser.$('[data-bve="load"]').click(); await ready();
		expect(await browser.$('[data-bve="preview"]').getValue()).toBe(original);
		await browser.$('[data-bve="delete"]').click();
		await browser.waitUntil(async () => (await browser.$('[data-bve="status"]').getText()).includes('deleted'), { timeout: 10000 });
	});
	it('turning Pro off stops an open batch preview', async () => {
		await prepare(); await ready(); await setPro(); await browser.$('[data-bve="batch"]').click(); await browser.$('[data-bve-view="B"]').click(); await ready();
		await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, BasesViewExtractPlugin> } }).plugins.plugins[id]!.pro!.signOut(), pluginId);
		expect(await browser.$('[data-bve="insert"]').isEnabled()).toBe(false); expect(await text()).toBe('Before\nREPLACE\nAfter');
	});
});
