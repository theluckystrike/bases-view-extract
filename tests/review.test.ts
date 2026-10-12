import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { parseYaml, stringifyYaml } from 'obsidian';
import BasesViewExtractPlugin from '../src/main';
import { buildExtract, fenceYaml } from '../src/extract';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const sponsors = vi.hoisted(() => ({ init: vi.fn(), refresh: vi.fn(), onChange: vi.fn(() => () => {}), isPro: () => true }));
vi.mock('../src/license/github-obsidian', () => ({ createGitHubSponsors: () => sponsors, sponsorsSettingItems: () => [] }));

const source = 'views:\n  - name: A\n    type: table\n';
const preset = (name: string) => ({ name, sourcePath: 'Example.base', source, views: ['A'] });
function plugin() {
	bindPro(sponsors as never);
	return new BasesViewExtractPlugin(App.createConfigured__({ files: {} }) as never, manifest as never);
}
afterEach(() => { resetPro(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('review regressions', () => {
	it('keeps both presets when saves overlap', async () => {
		const p = plugin();
		await Promise.all([p.savePreset(preset('First')), p.savePreset(preset('Second'))]);
		await p.loadSettings();
		expect(p.settings.presets.map((item) => item.name)).toEqual(['First', 'Second']);
	});
	it('rejects the second save when duplicate names overlap', async () => {
		const p = plugin();
		const results = await Promise.allSettled([p.savePreset(preset('Review')), p.savePreset(preset('Review'))]);
		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
		expect(p.settings.presets).toHaveLength(1);
	});
	it('keeps a new preset when a delete overlaps its save', async () => {
		const p = plugin();
		await p.savePreset(preset('Old'));
		await Promise.all([p.savePreset(preset('New')), p.deletePreset('Old')]);
		await p.loadSettings();
		expect(p.settings.presets.map((item) => item.name)).toEqual(['New']);
	});
	it('continues the write queue after a failed save', async () => {
		const p = plugin();
		vi.spyOn(p, 'saveData').mockRejectedValueOnce(new Error('Disk full'));
		const results = await Promise.allSettled([p.savePreset(preset('Failed')), p.savePreset(preset('Saved'))]);
		expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
		await p.loadSettings();
		expect(p.settings.presets.map((item) => item.name)).toEqual(['Saved']);
	});
	it('keeps a preset that sync wrote to data.json after load', async () => {
		const p = plugin();
		await p.loadSettings();
		await p.saveData({ presets: [preset('Synced')] });
		await p.savePreset(preset('Local'));
		await p.loadSettings();
		expect(p.settings.presets.map((item) => item.name)).toEqual(['Synced', 'Local']);
	});
	it('keeps a synced preset when a delete runs on stale memory', async () => {
		const p = plugin();
		await p.savePreset(preset('Old'));
		await p.saveData({ presets: [preset('Old'), preset('Synced')] });
		await p.deletePreset('Old');
		await p.loadSettings();
		expect(p.settings.presets.map((item) => item.name)).toEqual(['Synced']);
	});
	it('reloads presets when data.json changes on disk', async () => {
		const p = plugin();
		await p.loadSettings();
		await p.saveData({ presets: [preset('Synced')] });
		await p.onExternalSettingsChange();
		expect(p.settings.presets.map((item) => item.name)).toEqual(['Synced']);
	});
	it('keeps trailing blank lines in a parsed YAML value', () => {
		const config = { views: [{ name: 'A', type: 'table', providerText: 'Keep these lines\n\n\n' }] };
		const result = buildExtract(stringifyYaml(config), ['A']);
		const yaml = result.text.slice('```base\n'.length, -'```\n'.length);
		expect(parseYaml(yaml)).toEqual(config);
	});
	it('fences a large query with many backtick runs', () => {
		const yaml = `future: '${'` '.repeat(200_000)}'\nviews:\n  - name: A\n`;
		expect(fenceYaml(yaml)).toBe(`\`\`\`base\n${yaml}\`\`\`\n`);
	});
	it('does not start a refresh or interval after unload before layout ready', async () => {
		const p = plugin();
		let ready: () => unknown = () => {};
		vi.spyOn(p.app.workspace, 'onLayoutReady').mockImplementation((callback) => { ready = callback; });
		const interval = vi.spyOn(p, 'registerInterval').mockImplementation((id) => { window.clearInterval(id); return id; });
		await p.onload();
		p.onunload();
		ready();
		expect(sponsors.refresh).not.toHaveBeenCalled();
		expect(interval).not.toHaveBeenCalled();
	});
});
