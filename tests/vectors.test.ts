import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-view-extract.json';
import * as extract from '../src/extract';

interface Vector { name: string; function?: string; args: unknown[]; expected: unknown }
describe('golden acceptance vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases as Vector[]) {
		it(c.name, () => {
			const before = JSON.stringify(c.args);
			const fn = extract[(c.function ?? 'extractConfig') as keyof typeof extract] as (...args: unknown[]) => unknown;
			let got: unknown;
			try { got = fn(...c.args); } catch (error) { got = { error: (error as Error).message }; }
			expect(got).toEqual(c.expected);
			expect(JSON.stringify(c.args)).toBe(before);
		});
	}
});
