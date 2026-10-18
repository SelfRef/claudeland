import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
	formatMessage,
	formatPanelPercents,
	formatPanelReset,
	formatPercent,
	formatTimeRemaining,
	localizedLimitLabel,
	type UsageLimit,
} from '../domain/usage.js';
import { VibecheckError } from '../services/errors.js';
import type { UsageController, UsageState } from '../services/usage-controller.js';
import { formatClockTime, localizedError } from './localization.js';

class UsageIndicatorImpl extends PanelMenu.Button {
	private readonly panelIcon: St.Icon;
	private readonly panelLabel: St.Label;
	private readonly statusItem: PopupMenu.PopupMenuItem;
	private readonly limitsSection: PopupMenu.PopupMenuSection;
	private readonly loginItem: PopupMenu.PopupMenuItem;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly controller: UsageController,
		private readonly settings: Gio.Settings,
		private readonly extensionPath: string,
		openPreferences: () => void,
	) {
		super(0, 'Vibecheck', false);
		const menu = this.menu as PopupMenu.PopupMenu;
		const box = new St.BoxLayout({
			style_class: 'panel-status-menu-box vibecheck-panel',
			y_align: Clutter.ActorAlign.CENTER,
		});
		this.panelIcon = new St.Icon({ style_class: 'system-status-icon vibecheck-panel-icon' });
		box.add_child(this.panelIcon);
		this.panelLabel = new St.Label({
			text: formatMessage(_('Claude %s'), '--'),
			y_align: Clutter.ActorAlign.CENTER,
		});
		box.add_child(this.panelLabel);
		this.add_child(box);

		this.statusItem = new PopupMenu.PopupMenuItem(_('Loading…'), {
			reactive: false,
			can_focus: false,
		});
		this.statusItem.add_style_class_name('vibecheck-status');
		menu.addMenuItem(this.statusItem);
		menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		this.limitsSection = new PopupMenu.PopupMenuSection();
		menu.addMenuItem(this.limitsSection);
		menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		this.loginItem = new PopupMenu.PopupMenuItem(_('Sign in / renew session'));
		this.loginItem.connectObject(
			'activate',
			() => {
				try {
					this.controller.launchLogin();
				} catch (error) {
					if (!(error instanceof VibecheckError)) {
						throw error;
					}
					Main.notifyError(_('Vibecheck'), localizedError(error.code));
				}
			},
			this,
		);
		menu.addMenuItem(this.loginItem);

		const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh now'));
		refreshItem.connectObject('activate', () => void this.controller.refresh(), this);
		menu.addMenuItem(refreshItem);

		const settingsItem = new PopupMenu.PopupMenuItem(_('Preferences'));
		settingsItem.connectObject('activate', openPreferences, this);
		menu.addMenuItem(settingsItem);

		this.unsubscribe = controller.subscribe((state) => this.render(state));
	}

	override destroy(): void {
		this.unsubscribe();
		super.destroy();
	}

	private render(state: Readonly<UsageState>): void {
		this.renderPanel(state);
		this.renderMenu(state);
	}

	private renderPanel(state: Readonly<UsageState>): void {
		const icon = this.settings.get_string('panel-icon');
		this.panelIcon.visible = icon !== 'none';
		if (this.panelIcon.visible) {
			// St recolors file icons whose name ends in -symbolic with the panel foreground.
			const name = icon === 'symbolic' ? 'vibecheck-symbolic.svg' : 'vibecheck.svg';
			this.panelIcon.gicon = Gio.icon_new_for_string(`${this.extensionPath}/icons/${name}`);
		}

		if (!state.snapshot) {
			this.panelLabel.text = formatMessage(_('Claude %s'), state.loading ? '…' : '--');
			return;
		}

		const primary = this.settings.get_string('panel-primary');
		// The countdown advances with each poll rather than every minute.
		const reset = this.settings.get_boolean('show-panel-reset')
			? formatPanelReset(state.snapshot.limits, primary, new Date(), _)
			: '';
		const suffix = state.stale ? ' *' : '';
		this.panelLabel.text =
			formatPanelPercents(state.snapshot.limits, [
				primary,
				this.settings.get_string('panel-secondary'),
			]) +
			(reset ? ` · ${reset}` : '') +
			suffix;
	}

	private renderMenu(state: Readonly<UsageState>): void {
		this.limitsSection.removeAll();

		if (state.renewing) {
			this.statusItem.label.text = _('Renewing the Claude session…');
		} else if (state.loading && !state.snapshot) {
			this.statusItem.label.text = _('Loading Claude usage…');
		} else if (state.errorCode) {
			const error = localizedError(state.errorCode);
			this.statusItem.label.text = state.stale ? formatMessage(_('Stale data · %s'), error) : error;
		} else if (state.snapshot) {
			const updated = formatClockTime(state.snapshot.fetchedAt);
			const title = formatMessage(
				_('%s · updated %s'),
				state.planLabel ?? _('Claude plan'),
				updated,
			);
			this.statusItem.label.text = state.stale ? formatMessage(_('%s · stale'), title) : title;
		}

		if (state.snapshot) {
			for (const limit of state.snapshot.limits) {
				this.limitsSection.addMenuItem(createLimitRow(limit));
			}
		}

		const needsLogin =
			state.errorCode === 'not-authenticated' ||
			state.errorCode === 'credentials-missing' ||
			state.errorCode === 'credentials-expired' ||
			state.errorCode === 'renewal-failed' ||
			state.errorCode === 'unauthorized';
		this.loginItem.visible = needsLogin;
	}
}

export const UsageIndicator = GObject.registerClass(
	UsageIndicatorImpl as any,
) as unknown as typeof UsageIndicatorImpl;

function createLimitRow(limit: UsageLimit): PopupMenu.PopupBaseMenuItem {
	const item = new PopupMenu.PopupBaseMenuItem({
		reactive: false,
		can_focus: false,
	});
	item.add_style_class_name('vibecheck-limit-item');

	const content = new St.BoxLayout({
		x_expand: true,
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'vibecheck-limit-content',
	});
	const header = new St.BoxLayout({ x_expand: true });
	header.add_child(
		new St.Label({
			text: localizedLimitLabel(limit, _),
			x_expand: true,
			style_class: 'vibecheck-limit-label',
		}),
	);
	const value = new St.Label({
		text: formatMessage(_('%s remaining'), formatPercent(limit.remainingPercent)),
		style_class: `vibecheck-limit-value vibecheck-${limit.severity}`,
	});
	header.add_child(value);
	content.add_child(header);

	const track = new St.BoxLayout({ style_class: 'vibecheck-progress-track' });
	const fill = new St.Widget({
		style_class: `vibecheck-progress-fill vibecheck-${limit.severity}`,
	});
	track.add_child(fill);
	const fraction = Math.min(100, Math.max(0, limit.remainingPercent)) / 100;
	const updateFillWidth = () => {
		fill.width = Math.max(2, Math.round(track.width * fraction));
	};
	// A vertical BoxLayout stretches the track across the row. Derive the fill
	// from that allocated width instead of assuming the track stayed at its CSS
	// preferred width. This signal disappears with the track actor itself.
	track.connectObject('notify::width', updateFillWidth, fill);
	updateFillWidth();
	content.add_child(track);
	content.add_child(
		new St.Label({
			text: formatTimeRemaining(limit.resetsAt, new Date(), _),
			style_class: 'vibecheck-reset-label',
			// Dimmed rather than recolored, so it follows a light or dark menu.
			opacity: 180,
		}),
	);

	item.add_child(content);
	return item;
}
