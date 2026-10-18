import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import type { Translator } from '../domain/usage.js';
import type { VibecheckErrorCode } from '../services/errors.js';

const ERROR_MESSAGES: Partial<Record<VibecheckErrorCode, string>> = {
	'claude-cli-missing': 'Install Claude Code to authenticate.',
	'not-authenticated': 'Sign in to Claude Code to view usage.',
	'credentials-missing': 'Claude Code credentials were not found. Sign in to continue.',
	'credentials-invalid': 'The Claude Code credentials file is invalid.',
	'credentials-expired': 'The Claude session has expired. Sign in again.',
	'renewal-failed': 'The Claude session could not be renewed automatically. Retrying later.',
	unauthorized: 'The Claude session is no longer valid. Sign in again.',
	'rate-limited': 'Too many requests. Retrying later.',
	'server-error': 'Anthropic is currently unavailable.',
	'network-error': 'Could not reach Anthropic. Check your connection.',
	'invalid-response': 'Anthropic returned an invalid response.',
};

export const translate: Translator = _;

export function localizedError(code: VibecheckErrorCode | null, fallback: string | null): string {
	const message = code ? ERROR_MESSAGES[code] : null;
	return _(message ?? fallback ?? 'Unknown error');
}

export function formatMessage(template: string, ...values: Array<string | number>): string {
	let index = 0;
	return template.replace(/%[sd]/g, () => String(values[index++] ?? ''));
}

/** Time of day in the 12h or 24h format the GNOME clock is set to. */
export function formatClockTime(isoTime: string): string {
	const clockFormat = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' }).get_string(
		'clock-format',
	);
	const time = GLib.DateTime.new_from_unix_local(Math.floor(Date.parse(isoTime) / 1000));
	return time?.format(clockFormat === '12h' ? '%l:%M %p' : '%H:%M')?.trim() ?? '--';
}
