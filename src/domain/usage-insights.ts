/**
 * One period of Claude Code's "What's contributing to your limits usage?"
 * report, such as the last 24 hours: a title line and its findings.
 */
export interface UsageInsightPeriod {
	title: string;
	lines: string[];
}

/** Bounds on untrusted CLI output, so a runaway report cannot flood the menu. */
const MAX_PERIODS = 4;
const MAX_LINES = 8;
const MAX_LENGTH = 160;

const SECTION_MARKER = "What's contributing";

/**
 * Extracts the contributing-usage periods from the text of Claude Code's
 * `/usage` command. Claude Code computes them from local transcripts and only
 * prints them, so this reads the layout rather than the wording: after the
 * section heading, each period is a title line followed by indented lines, and
 * periods are separated by blank lines. Paragraphs without indented lines, such
 * as the disclaimer under the heading, are skipped. Returns an empty list when
 * the section is missing.
 */
export function parseUsageInsights(text: string): UsageInsightPeriod[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const start = lines.findIndex((line) => line.startsWith(SECTION_MARKER));
	if (start < 0) {
		return [];
	}

	const periods: UsageInsightPeriod[] = [];
	for (const block of splitBlocks(lines.slice(start + 1))) {
		const [title, ...rest] = block;
		const findings = rest.filter((line) => /^\s/.test(line)).map(clean);
		if (!title || /^\s/.test(title) || findings.length === 0) {
			continue;
		}
		periods.push({ title: clean(title), lines: findings.slice(0, MAX_LINES) });
		if (periods.length === MAX_PERIODS) {
			break;
		}
	}
	return periods;
}

function splitBlocks(lines: string[]): string[][] {
	const blocks: string[][] = [[]];
	for (const line of lines) {
		if (line.trim()) {
			blocks[blocks.length - 1]!.push(line);
		} else if (blocks[blocks.length - 1]!.length > 0) {
			blocks.push([]);
		}
	}
	return blocks;
}

function clean(line: string): string {
	// Terminal styling would show up as literal escape codes in the Shell.
	// eslint-disable-next-line no-control-regex
	const text = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
	return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}
