export type UsageSeverity = 'ok' | 'warning' | 'critical';

export interface UsageLimit {
	id: string;
	label: string;
	consumedPercent: number;
	remainingPercent: number;
	resetsAt: string | null;
	scopeModel: string | null;
	severity: UsageSeverity;
}

export interface UsageSnapshot {
	fetchedAt: string;
	limits: UsageLimit[];
}

export interface NormalizeOptions {
	warningRemaining?: number;
	criticalRemaining?: number;
	now?: Date;
}

export type Translator = (message: string) => string;

export class InvalidUsagePayloadError extends Error {
	constructor(message = 'Claude returned no supported usage limits') {
		super(message);
		this.name = 'InvalidUsagePayloadError';
	}
}

type UnknownRecord = Record<string, unknown>;

const PRIORITY: Record<string, number> = {
	five_hour: 0,
	seven_day: 1,
	extra_usage: 3,
};

export function normalizeUsage(payload: unknown, options: NormalizeOptions = {}): UsageSnapshot {
	if (!isRecord(payload)) {
		throw new InvalidUsagePayloadError('Claude usage response is not an object');
	}

	const warningRemaining = clamp(options.warningRemaining ?? 25, 0, 100);
	const criticalRemaining = clamp(options.criticalRemaining ?? 10, 0, warningRemaining);
	const candidates = collectCandidates(payload);
	const limits = new Map<string, UsageLimit>();

	for (const [sourceKey, candidate] of candidates) {
		// A switched-off feature such as extra usage still reports 0% used.
		if (candidate.enabled === false || candidate.is_enabled === false) {
			continue;
		}

		const utilization = firstNumber(candidate.utilization, candidate.percent);
		if (utilization === null) {
			continue;
		}

		const scopeModel = readScopeModel(candidate);
		const id = canonicalId(sourceKey, scopeModel);
		if (!id || limits.has(id)) {
			continue;
		}

		const consumedPercent = round(clamp(utilization, 0, 100), 1);
		const remainingPercent = round(100 - consumedPercent, 1);
		limits.set(id, {
			id,
			label: limitLabel(id, scopeModel),
			consumedPercent,
			remainingPercent,
			resetsAt: readReset(candidate),
			scopeModel,
			severity: severityFor(remainingPercent, warningRemaining, criticalRemaining),
		});
	}

	if (limits.size === 0) {
		throw new InvalidUsagePayloadError();
	}

	return {
		fetchedAt: (options.now ?? new Date()).toISOString(),
		limits: [...limits.values()].sort(compareLimits),
	};
}

export function severityFor(
	remainingPercent: number,
	warningRemaining = 25,
	criticalRemaining = 10,
): UsageSeverity {
	if (remainingPercent <= criticalRemaining) {
		return 'critical';
	}
	if (remainingPercent <= warningRemaining) {
		return 'warning';
	}
	return 'ok';
}

export function formatPercent(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

export function formatTimeRemaining(
	resetsAt: string | null,
	now = new Date(),
	translate: Translator = identity,
): string {
	const remaining = splitRemaining(resetsAt, now);
	if (!remaining) {
		return translate('reset unavailable');
	}

	const [days, hours, minutes] = remaining;
	if (days === 0 && hours === 0 && minutes === 0) {
		return translate('reset imminent');
	}
	if (days > 0) {
		return formatMessage(translate('resets in %dd %dh'), days, hours);
	}
	if (hours > 0) {
		return formatMessage(translate('resets in %dh %dm'), hours, minutes);
	}
	return formatMessage(translate('resets in %dm'), minutes);
}

/** Compact countdown for the top bar, or an empty string without a reset. */
export function formatPanelReset(
	limits: readonly UsageLimit[],
	choice: string,
	now = new Date(),
	translate: Translator = identity,
): string {
	const remaining = splitRemaining(selectPanelLimit(limits, choice)?.resetsAt ?? null, now);
	if (!remaining) {
		return '';
	}

	const [days, hours, minutes] = remaining;
	if (days > 0) {
		return formatMessage(translate('%dd %dh'), days, hours);
	}
	if (hours > 0) {
		return formatMessage(translate('%dh %dm'), hours, minutes);
	}
	return formatMessage(translate('%dm'), minutes);
}

export function localizedLimitLabel(
	limit: Pick<UsageLimit, 'id' | 'label' | 'scopeModel'>,
	translate: Translator = identity,
): string {
	if (limit.id === 'five_hour') {
		return translate('Current session');
	}
	if (limit.id === 'seven_day') {
		return translate('Weekly · all models');
	}
	if (limit.scopeModel) {
		return formatMessage(translate('Weekly · %s'), limit.scopeModel);
	}
	if (limit.id === 'extra_usage') {
		return translate('Extra usage');
	}
	// A limit kind this version does not know yet, labelled from its API key.
	return limit.label;
}

export function selectPanelLimit(limits: readonly UsageLimit[], choice: string): UsageLimit | null {
	const candidates =
		choice === 'lowest'
			? limits
			: choice === 'model'
				? limits.filter((limit) => limit.scopeModel)
				: limits.filter((limit) => limit.id === choice);
	return candidates.reduce<UsageLimit | null>(
		(lowest, limit) =>
			!lowest || limit.remainingPercent < lowest.remainingPercent ? limit : lowest,
		null,
	);
}

export function formatPanelPercents(
	limits: readonly UsageLimit[],
	choices: readonly string[],
): string {
	return choices
		.filter((choice) => choice && choice !== 'none')
		.map((choice) => {
			const limit = selectPanelLimit(limits, choice);
			return limit ? formatPercent(limit.remainingPercent) : '--';
		})
		.join('/');
}

export function formatPlanLabel(
	subscriptionType: string | null,
	rateLimitTier: string | null,
): string {
	const subscription = subscriptionType?.trim().toLowerCase() ?? '';
	const tier = rateLimitTier?.trim().toLowerCase() ?? '';

	if (subscription === 'max' || tier.includes('claude_max')) {
		if (tier.includes('20x')) {
			return 'Max (20x)';
		}
		if (tier.includes('5x')) {
			return 'Max (5x)';
		}
		return 'Max';
	}

	const knownPlans: Record<string, string> = {
		free: 'Free',
		pro: 'Pro',
		team: 'Team',
		enterprise: 'Enterprise',
	};
	if (knownPlans[subscription]) {
		return knownPlans[subscription];
	}

	return subscriptionType?.trim() || 'Claude';
}

function collectCandidates(payload: UnknownRecord): Array<[string, UnknownRecord]> {
	const candidates: Array<[string, UnknownRecord]> = [];

	// The legacy shape keys each limit at the top level; the newer one lists
	// them in a `limits` array, identified by `kind`.
	for (const [key, value] of Object.entries(payload)) {
		if (isRecord(value)) {
			candidates.push([key, value]);
		}
	}
	if (Array.isArray(payload.limits)) {
		for (const entry of payload.limits) {
			if (isRecord(entry)) {
				candidates.push([firstString(entry.kind) ?? 'unknown', entry]);
			}
		}
	}
	return candidates;
}

function canonicalId(sourceKey: string, scopeModel: string | null): string | null {
	if (scopeModel) {
		return `seven_day_${slugify(scopeModel)}`;
	}
	if (sourceKey === 'session') {
		return 'five_hour';
	}
	if (sourceKey === 'weekly_all') {
		return 'seven_day';
	}
	if (sourceKey === 'spend') {
		return 'extra_usage';
	}
	return slugify(sourceKey) || null;
}

function limitLabel(id: string, scopeModel: string | null): string {
	if (id === 'five_hour') {
		return 'Current session';
	}
	if (id === 'seven_day') {
		return 'Weekly · all models';
	}
	if (scopeModel) {
		return `Weekly · ${scopeModel}`;
	}
	if (id === 'extra_usage') {
		return 'Extra usage';
	}

	return id
		.split('_')
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(' ');
}

function readScopeModel(candidate: UnknownRecord): string | null {
	if (!isRecord(candidate.scope) || !isRecord(candidate.scope.model)) {
		return null;
	}

	return firstString(candidate.scope.model.display_name, candidate.scope.model.id);
}

function readReset(candidate: UnknownRecord): string | null {
	const reset = firstString(candidate.resets_at);
	return reset && Number.isFinite(Date.parse(reset)) ? reset : null;
}

function splitRemaining(resetsAt: string | null, now: Date): [number, number, number] | null {
	const resetTime = resetsAt ? Date.parse(resetsAt) : NaN;
	if (!Number.isFinite(resetTime)) {
		return null;
	}

	const totalMinutes = Math.ceil(Math.max(0, resetTime - now.getTime()) / 60_000);
	return [
		Math.floor(totalMinutes / 1_440),
		Math.floor((totalMinutes % 1_440) / 60),
		totalMinutes % 60,
	];
}

function compareLimits(left: UsageLimit, right: UsageLimit): number {
	const leftPriority = PRIORITY[left.id] ?? (left.scopeModel ? 2 : 4);
	const rightPriority = PRIORITY[right.id] ?? (right.scopeModel ? 2 : 4);
	return leftPriority - rightPriority || left.label.localeCompare(right.label);
}

function firstNumber(...values: unknown[]): number | null {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}
	return null;
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

export function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals: number): number {
	const multiplier = 10 ** decimals;
	return Math.round(value * multiplier) / multiplier;
}

export function formatMessage(template: string, ...values: Array<string | number>): string {
	let index = 0;
	return template.replace(/%[sd]/g, () => String(values[index++] ?? ''));
}

function identity(message: string): string {
	return message;
}
