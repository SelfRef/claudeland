import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseUsageCommandStream, parseUsageInsights } from '../src/domain/usage-insights.js';
import { normalizeUsage } from '../src/domain/usage.js';

function fixture(name: string): string {
	return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

const usageCommand = fixture('usage-command.txt');

describe('parseUsageCommandStream', () => {
	it('reads the rate limits and the contributing-usage report from one run', () => {
		const report = parseUsageCommandStream(fixture('usage-command-stream.jsonl'));

		expect(report?.insights).toEqual([
			{
				title: 'Last 24h · 387 requests · 10 sessions',
				lines: ['32% of your usage was at >150k context', 'Top subagents: general-purpose 5%'],
			},
		]);
		expect(normalizeUsage(report?.rateLimits).limits.map((limit) => limit.id)).toEqual([
			'five_hour',
			'seven_day',
			'seven_day_fable',
		]);
	});

	it('reports no limits while signed out', () => {
		const signedOut = [
			'{"type":"assistant","usage_report":null,"message":{"content":[]}}',
			'{"type":"result","is_error":false,"result":"Total cost: $0.0000"}',
		].join('\n');
		expect(parseUsageCommandStream(signedOut)).toEqual({ rateLimits: null, insights: [] });
	});

	it('rejects failed or unfinished runs', () => {
		expect(parseUsageCommandStream('{"type":"result","is_error":true,"result":"x"}')).toBeNull();
		expect(parseUsageCommandStream('{"type":"system","subtype":"init"}\nnot json')).toBeNull();
		expect(parseUsageCommandStream('')).toBeNull();
	});
});

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
