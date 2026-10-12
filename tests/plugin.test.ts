import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesViewExtractPlugin from '../src/main';
import { normalizeSettings } from '../src/settings';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { buildExtract, extractYaml } from '../src/extract';
import manifest from '../manifest.json';

const source = 'filters:\n  and:\n    - file.ext == "md"\nviews:\n  - name: A\n    type: table\n  - name: B\n    type: table\n';
function plugin() { return new BasesViewExtractPlugin(App.createConfigured__({ files: { 'a.md': '# Hello', 'Test.base': source } }) as never, manifest as never); }
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => {} } as never); }
afterEach(() => resetPro());

describe('settings and paid boundaries', () => {
	it('loads empty presets in a fresh vault', async () => { const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual({ presets: [] }); });
	it('drops invalid saved data', () => {
		for (const s of [null, [], { presets: 1 }, { presets: [null, { name: 5 }, { name: 'x', sourcePath: 'a', source, views: [] }] }]) expect(normalizeSettings(s)).toEqual({ presets: [] });
	});
	it('keeps a valid preset and drops duplicate names', () => {
		const preset = { name: 'Review', sourcePath: 'Test.base', source, views: ['B'] };
		expect(normalizeSettings({ presets: [preset, preset] })).toEqual({ presets: [preset] });
	});
	it('free user cannot save a preset and core works', async () => {
		const p = plugin(); const save = vi.spyOn(p, 'saveData');
		await expect(p.savePreset({ name: 'Review', sourcePath: 'Test.base', source, views: ['B'] })).rejects.toThrow('need Pro');
		expect(save).not.toHaveBeenCalled();
		expect(buildExtract(source, ['B']).text).toContain('name: B');
	});
	it('Pro saves a snapshot and reloads it', async () => {
		const p = plugin(); pro(true);
		const preset = { name: 'Review', sourcePath: 'Test.base', source, views: ['B'] };
		await p.savePreset(preset); await p.loadSettings(); expect(p.settings.presets).toEqual([preset]);
		await expect(p.savePreset(preset)).rejects.toThrow('exists');
	});
	it('rejects invalid queries and empty names before save', async () => {
		const p = plugin(); pro(true);
		await expect(p.savePreset({ name: ' ', sourcePath: 'a', source, views: ['B'] })).rejects.toThrow('name');
		await expect(p.savePreset({ name: 'Bad', sourcePath: 'a', source: 'views: [', views: ['B'] })).rejects.toThrow();
		expect(p.settings.presets).toHaveLength(0);
	});
	it('can delete a preset after Pro turns off', async () => {
		const p = plugin(); pro(true); await p.savePreset({ name: 'Review', sourcePath: 'a', source, views: ['B'] });
		pro(false); await p.deletePreset('Review'); expect(p.settings.presets).toEqual([]);
	});
	it('save failure does not change memory', async () => {
		const p = plugin(); pro(true); vi.spyOn(p, 'saveData').mockRejectedValue(new Error('Disk full'));
		await expect(p.savePreset({ name: 'Review', sourcePath: 'a', source, views: ['B'] })).rejects.toThrow('Disk full');
		expect(p.settings.presets).toHaveLength(0);
	});
});
describe('complete query blocks', () => {
	it('batch has one complete config in each section', () => {
		const result = buildExtract(source, ['A', 'B']);
		expect(result.text).toContain('## A\n\n```base'); expect(result.text).toContain('## B\n\n```base');
		expect(result.text.match(/filters:/g)).toHaveLength(2); expect(result.text.match(/```base/g)).toHaveLength(2);
	});
	it('rejects empty and repeated selections', () => { expect(() => buildExtract(source, [])).toThrow('Select a view'); expect(() => buildExtract(source, ['A', 'A'])).toThrow('once'); });
	it('uses the complete shared formula definitions', () => {
		const result = extractYaml('formulas:\n  a: "1"\n  b: "2"\nviews:\n  - name: B\n    order: [formula.a]\n', 'B');
		expect(result).toMatchObject({ config: { formulas: { a: '1', b: '2' } } });
	});
	it('keeps aliases and nested unknown fields as values', () => {
		const r = extractYaml('shared: &value [B, null, A]\nviews:\n  - name: B\n    groupOrder: *value\n', 'B');
		expect(r).toMatchObject({ config: { shared: ['B', null, 'A'], views: [{ name: 'B', groupOrder: ['B', null, 'A'] }] } });
	});
});
describe('Sponsors facade', () => {
	it('starts off and checks match the reference', () => { expect(isPro()).toBe(false); expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }); });
	it('calls listeners and clears them on unload', () => {
		let callback: () => void = () => {}; const off = vi.fn();
		bindPro({ isPro: () => true, onChange: (fn: () => void) => { callback = fn; return off; } } as never);
		const cb = vi.fn(); onProChange(cb); callback(); expect(cb).toHaveBeenCalledOnce(); resetPro(); expect(off).toHaveBeenCalledOnce(); expect(isPro()).toBe(false);
	});
});
