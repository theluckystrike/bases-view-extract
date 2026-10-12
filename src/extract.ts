import { parseYaml, stringifyYaml } from 'obsidian';

export type BaseObject = Record<string, unknown>;
export type ExtractResult = { config: BaseObject; contextWarning: boolean } | { error: string };

export function isObject(value: unknown): value is BaseObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function viewNames(config: unknown): string[] {
	if (!isObject(config) || !Array.isArray(config.views)) throw new Error('The Base must have a views array.');
	return config.views.map((view: unknown) => {
		if (!isObject(view) || typeof view.name !== 'string' || !view.name.trim()) throw new Error('Each view must have a non-empty name.');
		return view.name;
	});
}

/** Keep the parsed fields. Do not change the source object. */
export function extractConfig(config: unknown, name: string): BaseObject {
	const names = viewNames(config);
	const count = names.filter((n) => n === name).length;
	if (count > 1) throw new Error(`The view name is ambiguous: ${name}`);
	if (count === 0) throw new Error(`The view was not found: ${name}`);
	const base = config as BaseObject & { views: BaseObject[] };
	return { ...base, views: base.views.filter((view) => view.name === name) };
}

export function extractYaml(source: string, name: string): ExtractResult {
	try {
		const config = extractConfig(parseYaml(source) as unknown, name);
		const yaml = stringifyYaml(config);
		return { config, contextWarning: /\bthis\b|\[\[|\b(?:link|file)\s*\(|\.\.\//i.test(yaml) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function fenceYaml(yaml: string): string {
	let longest = 0;
	for (const match of yaml.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
	const fence = '`'.repeat(Math.max(3, longest + 1));
	return `${fence}base\n${yaml}${yaml.endsWith('\n') ? '' : '\n'}${fence}\n`;
}

export function sectionTitle(name: string): string {
	return name.replace(/[\r\n\u2028\u2029]/g, ' ').replace(/[\\`*_{}[\]<>#!|]/g, (c) => `\\${c}`);
}

export function buildExtract(source: string, names: string[]): { text: string; warning: boolean } {
	if (!names.length) throw new Error('Select a view.');
	if (new Set(names).size !== names.length) throw new Error('Select each view once.');
	let warning = false;
	const blocks = names.map((name) => {
		const result = extractYaml(source, name);
		if ('error' in result) throw new Error(result.error);
		warning ||= result.contextWarning;
		const block = fenceYaml(stringifyYaml(result.config));
		return names.length > 1 ? `## ${sectionTitle(name)}\n\n${block}` : block;
	});
	return { text: blocks.join('\n'), warning };
}
