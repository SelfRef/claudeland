import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import type { VibecheckErrorCode } from '../services/errors.js';

export function localizedError(code: VibecheckErrorCode): string {
	switch (code) {
		case 'claude-cli-missing':
			return _('Install Claude Code to authenticate.');
		case 'claude-cli-failed':
			return _('Claude Code could not report usage. Retrying later.');
		case 'terminal-missing':
			return _('No compatible terminal was found to start Claude sign-in.');
		case 'not-authenticated':
			return _('Sign in to Claude Code to view usage.');
		case 'credentials-missing':
			return _('Claude Code credentials were not found. Sign in to continue.');
		case 'credentials-invalid':
			return _('The Claude Code credentials file is invalid.');
		case 'credentials-expired':
			return _('The Claude session has expired. Sign in again.');
		case 'renewal-failed':
			return _('The Claude session could not be renewed automatically. Retrying later.');
		case 'unauthorized':
			return _('The Claude session is no longer valid. Sign in again.');
		case 'rate-limited':
			return _('Too many requests. Retrying later.');
		case 'server-error':
			return _('Anthropic is currently unavailable.');
		case 'network-error':
			return _('Could not reach Anthropic. Check your connection.');
		case 'invalid-response':
			return _('Anthropic returned an invalid response.');
	}
}

/** Time of day in the 12h or 24h format the GNOME clock is set to. */
export function formatClockTime(isoTime: string): string {
	const clockFormat = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' }).get_string(
		'clock-format',
	);
	const time = GLib.DateTime.new_from_unix_local(Math.floor(Date.parse(isoTime) / 1000));
	return time?.format(clockFormat === '12h' ? '%l:%M %p' : '%H:%M')?.trim() ?? '--';
}
