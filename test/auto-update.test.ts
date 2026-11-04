import { describe, expect, it } from 'vitest';

import { addChangelogEntry, bumpPatch, selectUpdate } from '../scripts/auto-update.mjs';

const now = new Date('2026-11-01T00:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('selectUpdate', () => {
	it('selects the newest version of the same major', () => {
		const time = { '6.2.0': daysAgo(90), '6.3.0': daysAgo(30), '6.5.1': daysAgo(10) };

		expect(selectUpdate('6.2.0', time, now)).toBe('6.5.1');
	});

	it('never moves to a new major version', () => {
		const time = { '6.2.0': daysAgo(90), '7.0.0': daysAgo(30) };

		expect(selectUpdate('6.2.0', time, now)).toBeUndefined();
	});

	it('holds back versions that were published in the last seven days', () => {
		const time = { '6.2.0': daysAgo(90), '6.3.0': daysAgo(30), '6.4.0': daysAgo(2) };

		expect(selectUpdate('6.2.0', time, now)).toBe('6.3.0');
	});

	it('ignores prereleases and the registry bookkeeping keys', () => {
		const time = {
			created: daysAgo(900),
			modified: daysAgo(1),
			'6.2.0': daysAgo(90),
			'6.3.0-beta.1': daysAgo(30),
		};

		expect(selectUpdate('6.2.0', time, now)).toBeUndefined();
	});

	it('compares version numbers numerically', () => {
		const time = { '0.9.0': daysAgo(90), '0.10.0': daysAgo(30) };

		expect(selectUpdate('0.9.0', time, now)).toBe('0.10.0');
	});
});

describe('release helpers', () => {
	it('bumps the patch version', () => {
		expect(bumpPatch('1.1.9')).toBe('1.1.10');
	});

	it('adds a changelog entry above the latest release', () => {
		const changelog = '# Changelog\n\n## 1.1.0\n\n- Previous.\n';

		expect(addChangelogEntry(changelog, '1.1.1', ['Update pdfjs-dist from 1 to 2.'])).toBe(
			'# Changelog\n\n## 1.1.1\n\n- Update pdfjs-dist from 1 to 2.\n\n## 1.1.0\n\n- Previous.\n',
		);
	});
});
