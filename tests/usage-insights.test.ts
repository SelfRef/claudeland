import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseUsageInsights } from '../src/domain/usage-insights.js';

const usageCommand = readFileSync(
	fileURLToPath(new URL('./fixtures/usage-command.txt', import.meta.url)),
	'utf8',
);

describe('parseUsageInsights', () => {
	it('reads each period of the contributing-usage section', () => {
		expect(parseUsageInsights(usageCommand)).toEqual([
			{
				title: 'Last 24h · 387 requests · 10 sessions',
				lines: [
					'32% of your usage was at >150k context',
					'30% of your usage came from subagent-heavy sessions',
					'Top subagents: general-purpose 5%',
				],
			},
			{
				title: 'Last 7d · 2682 requests · 27 sessions',
				lines: [
					'80% of your usage was at >150k context',
					'41% of your usage came from sessions active for 8+ hours',
					'29% of your usage came from subagent-heavy sessions',
					'Top subagents: general-purpose 2%',
					'Top MCP servers: example-browser 10%, example-docs 2%',
				],
			},
		]);
	});

	it('returns nothing without the section', () => {
		expect(parseUsageInsights('Current session: 16% used\n')).toEqual([]);
		expect(parseUsageInsights('')).toEqual([]);
	});

	it('bounds and cleans untrusted output', () => {
		const findings = Array.from(
			{ length: 20 },
			(_, index) => `  \u001b[2mfinding ${index}\u001b[0m`,
		);
		const text = [
			"What's contributing to your limits usage?",
			'',
			`Last 30d · ${'x'.repeat(300)}`,
			...findings,
		].join('\r\n');
		const [period] = parseUsageInsights(text);

		expect(period?.title.length).toBe(160);
		expect(period?.lines).toHaveLength(8);
		expect(period?.lines[0]).toBe('finding 0');
	});
});
