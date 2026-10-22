// Prepares a release: sets the version in package.json and metadata.json, moves
// the Unreleased changelog section under the new version, and prints its notes
// for the GitHub release.
//
//   node scripts/release.mjs 0.4.0 > notes.md
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
	fail(`Expected a version like 1.2.3, got "${version}"`);
}

const changelogPath = resolve(root, 'CHANGELOG.md');
const changelog = await readFile(changelogPath, 'utf8');
if (changelog.includes(`## [${version}]`)) {
	fail(`CHANGELOG.md already has a ${version} section`);
}
const heading = '## [Unreleased]\n';
const start = changelog.indexOf(heading);
if (start === -1) {
	fail('CHANGELOG.md has no Unreleased section');
}
const bodyStart = start + heading.length;
const next = changelog.indexOf('\n## [', bodyStart);
const bodyEnd = next === -1 ? changelog.length : next + 1;
const notes = changelog.slice(bodyStart, bodyEnd).trim();
if (!notes) {
	fail('The Unreleased section of CHANGELOG.md is empty');
}

// [Unreleased]: <repo>/compare/v1.0.0...HEAD becomes the new version's link.
const link = /^\[Unreleased\]: (\S+)\/compare\/(\S+)\.\.\.HEAD$/m;
const match = changelog.match(link);
if (!match) {
	fail('CHANGELOG.md has no [Unreleased] compare link');
}
const [, repo, previous] = match;
const links = `[Unreleased]: ${repo}/compare/v${version}...HEAD\n[${version}]: ${repo}/compare/${previous}...v${version}`;

const date = new Date().toISOString().slice(0, 10);
const rest = changelog.slice(bodyEnd).replace(link, links);
await writeFile(
	changelogPath,
	`${changelog.slice(0, bodyStart)}\n## [${version}] - ${date}\n\n${notes}\n\n${rest}`,
);
await setField('package.json', 'version', version);
await setField('metadata.json', 'version-name', version);

console.log(notes);
console.error(`Prepared release ${version}`);

// Edit the field in place so the files keep their formatting.
async function setField(file, key, value) {
	const path = resolve(root, file);
	const text = await readFile(path, 'utf8');
	const pattern = new RegExp(`("${key}": )"[^"]*"`);
	if (!pattern.test(text)) {
		fail(`${file} has no "${key}" field`);
	}
	await writeFile(path, text.replace(pattern, `$1"${value}"`));
}

function fail(message) {
	console.error(message);
	process.exit(1);
}
