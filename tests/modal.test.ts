import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { parseYaml, type EditorPosition, type MarkdownView } from 'obsidian';
import BasesViewExtractPlugin from '../src/main';
import { ExtractModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const SOURCE = 'filters:\n  and: [x]\nviews:\n  - name: A\n    type: table\n  - name: B\n    type: table\n';
const modals: ExtractModal[] = [];
afterEach(() => { for (const m of modals.splice(0)) m.close(); resetPro(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(source = SOURCE, initial = 'Before\nREPLACE\nAfter') {
	const app = App.createConfigured__({ files: { 'a.md': initial, 'Example.base': source, 'Other.base': 'views:\n  - name: Other\n' } });
	let value = initial;
	let anchor = { line: 1, ch: 0 }; let head = { line: 1, ch: 7 };
	const editor = {
		getValue: () => value,
		getCursor: (side: string) => side === 'anchor' || side === 'from' ? anchor : head,
		listSelections: () => [{ anchor, head }],
		replaceSelection: vi.fn((replacement: string) => { const lines = value.split('\n'); lines[1] = lines[1]!.slice(0, anchor.ch) + replacement + lines[1]!.slice(head.ch); value = lines.join('\n'); }),
	};
	const target = { editor, file: app.vault.getFileByPath('a.md') } as unknown as MarkdownView;
	vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(target as never);
	const p = new BasesViewExtractPlugin(app as never, manifest as never);
	const m = new ExtractModal(p, target); modals.push(m); m.open();
	const select = (name: string) => { const el = m.contentEl.querySelector<HTMLSelectElement>('[data-bve="view"]')!; el.value = name; el.dispatchEvent(new Event('change')); };
	const preview = () => m.contentEl.querySelector<HTMLTextAreaElement>('[data-bve="preview"]')!.value;
	const status = () => m.contentEl.querySelector('[data-bve="status"]')!.textContent;
	return { app, p, m, editor, select, preview, status, value: () => value, setValue: (v: string) => { value = v; }, setSelection: (a: EditorPosition, h: EditorPosition) => { anchor = a; head = h; } };
}

describe('preview and editor safety', () => {
	it('replaces only the editor selection and does not write the source', async () => {
		const s = setup(); const modify = vi.spyOn(s.app.vault, 'modify'); await s.m.loadFile('Example.base'); s.select('B');
		const preview = s.preview(); expect(preview).toContain('name: B'); expect(preview).not.toContain('name: A'); s.m.insert();
		expect(s.value()).toBe(`Before\n${preview}\nAfter`); expect(modify).not.toHaveBeenCalled(); expect(s.p.modals.size).toBe(0);
	});
	it('shows invalid YAML and does not call replaceSelection', async () => {
		const s = setup('views: ['); await s.m.loadFile('Example.base');
		expect(s.status()).toContain('line'); s.m.insert();
		expect(s.preview()).toBe(''); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
	it('blocks a duplicate selected name', async () => {
		const s = setup('views:\n  - name: B\n  - name: B\n'); await s.m.loadFile('Example.base'); s.m.insert();
		expect(s.status()).toContain('ambiguous'); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
	it('blocks changed text', async () => {
		const s = setup(); await s.m.loadFile('Example.base'); s.setValue('Changed'); s.m.insert();
		expect(s.status()).toContain('changed'); expect(s.value()).toBe('Changed'); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
	it('blocks changed selection', async () => {
		const s = setup(); await s.m.loadFile('Example.base'); s.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 1 }); s.m.insert();
		expect(s.status()).toContain('changed'); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
	it('blocks another active note', async () => {
		const s = setup(); await s.m.loadFile('Example.base'); vi.mocked(s.app.workspace.getActiveViewOfType).mockReturnValue(null); s.m.insert();
		expect(s.status()).toContain('changed'); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
	it('shows the context warning before insertion', async () => {
		const s = setup('filters: this.file.name\nviews:\n  - name: B\n'); await s.m.loadFile('Example.base');
		expect(s.status()).toContain('Context warning'); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
	it('an older file read cannot replace a newer preview', async () => {
		const s = setup(); let resolve!: (value: string) => void;
		vi.spyOn(s.app.vault, 'read').mockImplementation((file) => file.path === 'Example.base' ? new Promise((r) => { resolve = r; }) : Promise.resolve('views:\n  - name: Other\n'));
		const old = s.m.loadFile('Example.base'); await s.m.loadFile('Other.base'); resolve(SOURCE); await old;
		expect(s.preview()).toContain('name: Other'); expect(s.preview()).not.toContain('name: A');
	});
	it('closing the modal cancels a pending file read', async () => {
		const s = setup(); let resolve!: (value: string) => void;
		vi.spyOn(s.app.vault, 'read').mockImplementation(() => new Promise((r) => { resolve = r; }));
		const pending = s.m.loadFile('Example.base'); s.m.close(); resolve(SOURCE); await pending;
		expect(s.m.contentEl.textContent).toBe(''); expect(s.p.modals.size).toBe(0);
	});
	it('starts a fence on its own line for an inline selection', async () => {
		const s = setup(); s.m.close(); s.setSelection({ line: 1, ch: 2 }, { line: 1, ch: 5 });
		const target = { editor: s.editor, file: s.app.vault.getFileByPath('a.md') } as unknown as MarkdownView;
		vi.mocked(s.app.workspace.getActiveViewOfType).mockReturnValue(target as never);
		const m = new ExtractModal(s.p, target); modals.push(m); m.open(); await m.loadFile('Example.base'); m.insert();
		expect(s.value()).toContain('RE\n```base\n'); expect(s.value()).toContain('```\nCE');
	});
	it('Pro turning off clears the batch preview', async () => {
		let pro = true; let changed: () => void = () => {};
		bindPro({ isPro: () => pro, onChange: (cb: () => void) => { changed = cb; return () => {}; } } as never);
		const s = setup(); await s.m.loadFile('Example.base');
		const toggle = s.m.contentEl.querySelector<HTMLInputElement>('[data-bve="batch"]')!; toggle.checked = true; toggle.dispatchEvent(new Event('change'));
		const b = s.m.contentEl.querySelector<HTMLInputElement>('[data-bve-view="B"]')!; b.checked = true; b.dispatchEvent(new Event('change'));
		expect(s.preview()).toContain('## B'); pro = false; changed(); s.m.insert();
		expect(s.preview()).toBe(''); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
	});
});

describe('copy the complete query', () => {
	function clipboard(writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()) {
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		return writeText;
	}
	function copyButton(m: ExtractModal) { return m.contentEl.querySelector<HTMLButtonElement>('[data-bve="copy"]')!; }
	it('copies the selected view and shared fields for free without changing files or closing', async () => {
		const write = clipboard();
		const s = setup('formulas:\n  cost: hours * rate\nfilters:\n  and: [x]\nviews:\n  - name: A\n  - name: B\n    groupOrder: [B, null, A]\n');
		const modify = vi.spyOn(s.app.vault, 'modify');
		await s.m.loadFile('Example.base'); s.select('B');
		const preview = s.preview(); await s.m.copy();
		expect(write).toHaveBeenCalledExactlyOnceWith(preview);
		expect(parseYaml(preview.slice('```base\n'.length, -'```\n'.length))).toEqual({ formulas: { cost: 'hours * rate' }, filters: { and: ['x'] }, views: [{ name: 'B', groupOrder: ['B', null, 'A'] }] });
		expect(s.value()).toBe('Before\nREPLACE\nAfter'); expect(modify).not.toHaveBeenCalled(); expect(s.editor.replaceSelection).not.toHaveBeenCalled();
		expect(s.p.modals.has(s.m)).toBe(true); expect(s.status()).toContain('Copied to clipboard');
	});
	it('disables copy until a valid view is selected and rejects invalid or ambiguous YAML', async () => {
		const write = clipboard(); const s = setup();
		expect(copyButton(s.m).disabled).toBe(true); await s.m.copy();
		for (const source of ['views: [', 'views:\n  - name: B\n  - name: B\n']) {
			const invalid = setup(source); await invalid.m.loadFile('Example.base');
			expect(copyButton(invalid.m).disabled).toBe(true); await invalid.m.copy();
		}
		expect(write).not.toHaveBeenCalled();
	});
	it('keeps the preview and insertion available after a failed write, then retries', async () => {
		const write = clipboard(vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValue());
		const s = setup(); await s.m.loadFile('Example.base'); const preview = s.preview(); await s.m.copy();
		expect(s.preview()).toBe(preview); expect(s.status()).toContain('copy it manually'); expect(copyButton(s.m).disabled).toBe(false);
		expect(s.m.contentEl.querySelector<HTMLButtonElement>('[data-bve="insert"]')!.disabled).toBe(false);
		await s.m.copy(); expect(write).toHaveBeenCalledTimes(2); expect(s.status()).toContain('Copied to clipboard');
		expect(s.m.contentEl.querySelector('[data-bve="status"]')!.classList.contains('bve-error')).toBe(false);
	});
	it('offers manual copy if the clipboard API is not available', async () => {
		vi.stubGlobal('navigator', {}); const s = setup(); await s.m.loadFile('Example.base'); const preview = s.preview();
		await s.m.copy(); expect(s.status()).toContain('Clipboard write failed'); expect(s.preview()).toBe(preview);
	});
	it('keeps the context warning visible after copy succeeds or fails', async () => {
		const write = clipboard(); const s = setup('filters: this.file.name\nviews:\n  - name: B\n'); await s.m.loadFile('Example.base');
		await s.m.copy(); expect(s.status()).toContain('Context warning'); expect(s.status()).toContain('Copied');
		write.mockRejectedValueOnce(new Error('Blocked')); await s.m.copy();
		expect(s.status()).toContain('Context warning'); expect(s.status()).toContain('failed');
	});
	it('blocks a second copy while a write is pending', async () => {
		let resolve!: () => void; const write = clipboard(vi.fn(() => new Promise<void>((r) => { resolve = r; })));
		const s = setup(); await s.m.loadFile('Example.base'); const pending = s.m.copy();
		expect(copyButton(s.m).disabled).toBe(true); await s.m.copy(); expect(write).toHaveBeenCalledOnce();
		resolve(); await pending; expect(copyButton(s.m).disabled).toBe(false);
	});
	it.each([false, true])('does not overwrite a newer preview when the old copy fails=%s', async (fail) => {
		let resolve!: () => void; let reject!: () => void;
		clipboard(vi.fn(() => new Promise<void>((ok, bad) => { resolve = ok; reject = () => bad(new Error('Blocked')); })));
		const s = setup(); await s.m.loadFile('Example.base'); const pending = s.m.copy();
		s.select('B'); const message = s.status();
		if (fail) reject(); else resolve(); await pending;
		expect(s.preview()).toContain('name: B'); expect(s.status()).toBe(message); expect(copyButton(s.m).disabled).toBe(false);
	});
	it('does not update a closed modal after a pending copy completes', async () => {
		let resolve!: () => void; clipboard(vi.fn(() => new Promise<void>((r) => { resolve = r; })));
		const s = setup(); await s.m.loadFile('Example.base'); const pending = s.m.copy(); s.m.close(); resolve(); await pending;
		expect(s.m.contentEl.textContent).toBe(''); expect(s.p.modals.size).toBe(0);
	});
	it('copies Pro sections but blocks a new copy after Pro turns off', async () => {
		const write = clipboard(); let pro = true; let changed: () => void = () => {};
		bindPro({ isPro: () => pro, onChange: (cb: () => void) => { changed = cb; return () => {}; } } as never);
		const s = setup(); await s.m.loadFile('Example.base');
		const toggle = s.m.contentEl.querySelector<HTMLInputElement>('[data-bve="batch"]')!; toggle.checked = true; toggle.dispatchEvent(new Event('change'));
		const b = s.m.contentEl.querySelector<HTMLInputElement>('[data-bve-view="B"]')!; b.checked = true; b.dispatchEvent(new Event('change'));
		await s.m.copy(); expect(write).toHaveBeenCalledExactlyOnceWith(s.preview()); expect(s.preview()).toContain('## B');
		pro = false; changed(); await s.m.copy(); expect(write).toHaveBeenCalledOnce(); expect(copyButton(s.m).disabled).toBe(true);
	});
});

describe('copy text does not depend on the cursor', () => {
	it('copies the block without the insertion newline when the cursor is in the middle of a line', async () => {
		const write = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(); vi.stubGlobal('navigator', { clipboard: { writeText: write } });
		const s = setup(); s.setSelection({ line: 1, ch: 3 }, { line: 1, ch: 3 }); await s.m.loadFile('Example.base');
		expect(s.preview().startsWith('\n```base\n')).toBe(true); await s.m.copy();
		expect(write).toHaveBeenCalledExactlyOnceWith(s.preview().slice(1));
	});
});
