// Formats the build like the sources, because the extensions.gnome.org review
// reads the JavaScript that ships, not the TypeScript.
//
// tsc emits its own style (4-space indent, `}\ncatch`) and drops blank lines.
// Prettier restores the project style; ESLint then restores the blank lines
// between functions and classes, using the padding rules the sources follow.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import * as prettier from 'prettier';

import { PADDING_RULES } from './padding-rules.mjs';

const root = resolve(import.meta.dirname, '..');

const eslint = new ESLint({
	fix: true,
	// Generated output: use only the rules below, not the project lint config.
	overrideConfigFile: true,
	// Disable comments look unused under these rules; removing them would leave
	// their indentation behind as a whitespace-only line.
	overrideConfig: {
		rules: PADDING_RULES,
		linterOptions: { reportUnusedDisableDirectives: 'off' },
	},
	ignore: false,
});

const targets = await javascriptFiles(resolve(root, 'dist'));

for (const target of targets) {
	const options = await prettier.resolveConfig(target, { editorconfig: true });
	const source = await readFile(target, 'utf8');
	await writeFile(target, await prettier.format(source, { ...options, filepath: target }));
}

const results = await eslint.lintFiles(targets);
await ESLint.outputFixes(results);

const unfixed = results.flatMap((result) => result.messages.filter((message) => !message.fix));
if (unfixed.length > 0) {
	console.error('Could not add every required blank line:');
	for (const message of unfixed) {
		console.error(`  ${message.ruleId}: ${message.message}`);
	}
	process.exit(1);
}

console.log(`Formatted ${targets.length} generated files`);

async function javascriptFiles(directory) {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
		.map((entry) => resolve(entry.parentPath, entry.name));
}
