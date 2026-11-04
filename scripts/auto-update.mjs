// Monthly dependency update, run by .github/workflows/auto-update.yml.
// Only the packages below are touched, always within their current major version.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MANAGED_PACKAGES = [
	{ name: 'pdfjs-dist', group: 'dependencies', shipsToUsers: true },
	{ name: '@n8n/node-cli', group: 'devDependencies', shipsToUsers: false },
	{ name: 'prettier', group: 'devDependencies', shipsToUsers: false },
];

const MINIMUM_AGE_DAYS = 7;

function parseStable(version) {
	return /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : undefined;
}

function isNewer(a, b) {
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] > b[index];
	}
	return false;
}

/** Picks the newest stable version in the same major that has been public for a week. */
export function selectUpdate(current, publishTimes, now = new Date()) {
	const latestAllowed = now.getTime() - MINIMUM_AGE_DAYS * 86_400_000;
	let best = parseStable(current);
	let selected;

	for (const [version, publishedAt] of Object.entries(publishTimes)) {
		const parsed = parseStable(version);
		if (!parsed || parsed[0] !== best[0]) continue;
		if (new Date(publishedAt).getTime() > latestAllowed) continue;
		if (isNewer(parsed, best)) {
			best = parsed;
			selected = version;
		}
	}

	return selected;
}

export function bumpPatch(version) {
	const [major, minor, patch] = version.split('.').map(Number);
	return `${major}.${minor}.${patch + 1}`;
}

export function addChangelogEntry(changelog, version, lines) {
	const entry = `## ${version}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n`;
	const firstRelease = changelog.indexOf('## ');
	return changelog.slice(0, firstRelease) + entry + changelog.slice(firstRelease);
}

function main() {
	const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
	const shipped = [];
	const tooling = [];

	for (const { name, group, shipsToUsers } of MANAGED_PACKAGES) {
		const current = manifest[group][name];
		const publishTimes = JSON.parse(
			execFileSync('npm', ['view', name, 'time', '--json'], { encoding: 'utf8' }),
		);
		const update = selectUpdate(current, publishTimes);
		if (!update) continue;

		manifest[group][name] = update;
		(shipsToUsers ? shipped : tooling).push(`Update ${name} from ${current} to ${update}.`);
	}

	const release = shipped.length > 0;
	if (release) {
		manifest.version = bumpPatch(manifest.version);
		const changelog = readFileSync('CHANGELOG.md', 'utf8');
		writeFileSync('CHANGELOG.md', addChangelogEntry(changelog, manifest.version, shipped));
	}
	writeFileSync('package.json', `${JSON.stringify(manifest, null, '\t')}\n`);

	const changes = [...shipped, ...tooling];
	console.log(changes.length > 0 ? changes.join('\n') : 'Everything is up to date.');

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`changed=${changes.length > 0}\nrelease=${release}\nversion=${manifest.version}\n` +
				`message=${changes.join(' ')}\n`,
		);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
