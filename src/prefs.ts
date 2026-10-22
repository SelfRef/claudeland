import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
	ExtensionPreferences,
	gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { ClaudeAuth, launchLogin } from './services/claude-auth.js';
import { VibecheckError } from './services/errors.js';

const POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
const PANEL_BOXES = ['left', 'center', 'right'] as const;
const PANEL_ICONS = ['none', 'color', 'symbolic'] as const;
const PANEL_LIMITS = ['five_hour', 'seven_day', 'lowest', 'none'] as const;
const PANEL_RESETS = ['five_hour', 'seven_day', 'both', 'none'] as const;
const INSIGHT_PLACES = ['both', 'menu', 'card', 'none'] as const;

export default class VibecheckPreferences extends ExtensionPreferences {
	async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
		const settings = this.getSettings();
		const page = new Adw.PreferencesPage({
			title: _('Vibecheck'),
			icon_name: 'network-transmit-receive-symbolic',
		});
		window.add(page);

		const appearance = new Adw.PreferencesGroup({
			title: _('Appearance'),
			description: _('Choose where to show remaining Claude capacity.'),
		});
		page.add(appearance);

		appearance.add(
			boundSwitch(
				settings,
				'show-panel',
				_('Panel indicator'),
				_('Show percentages in the GNOME top bar.'),
			),
		);
		appearance.add(
			boundCombo(
				settings,
				'panel-box',
				_('Panel area'),
				_('Part of the top bar that holds the indicator.'),
				PANEL_BOXES,
				[_('Left'), _('Center'), _('Right')],
			),
		);
		appearance.add(
			boundSpin(
				settings,
				'panel-index',
				_('Panel position'),
				_('0 places it before the other icons in the area.'),
				0,
				99,
				1,
			),
		);
		const panelLimitLabels = [
			_('Current session'),
			_('Weekly · all models'),
			_('Lowest remaining'),
			_('None'),
		];
		appearance.add(
			boundCombo(
				settings,
				'panel-primary',
				_('First panel value'),
				_('Remaining capacity shown first in the top bar.'),
				PANEL_LIMITS,
				panelLimitLabels,
			),
		);
		appearance.add(
			boundCombo(
				settings,
				'panel-secondary',
				_('Second panel value'),
				_('Shown after a slash, or None for a single value.'),
				PANEL_LIMITS,
				panelLimitLabels,
			),
		);
		appearance.add(
			boundCombo(
				settings,
				'panel-reset',
				_('Time until reset'),
				_('Shown after the percentages in the top bar.'),
				PANEL_RESETS,
				[_('Current session'), _('Weekly · all models'), _('Both'), _('None')],
			),
		);
		appearance.add(
			boundCombo(
				settings,
				'panel-icon',
				_('Panel icon'),
				_('Symbolic follows the top bar color.'),
				PANEL_ICONS,
				[_('None'), _('Color'), _('Symbolic')],
			),
		);
		appearance.add(
			boundCombo(
				settings,
				'show-insights',
				_('Usage contributors'),
				_('What drove usage on this machine over the last day and week, from Claude Code.'),
				INSIGHT_PLACES,
				[_('Menu and card'), _('Menu only'), _('Card only'), _('Hidden')],
			),
		);
		appearance.add(
			boundSwitch(
				settings,
				'show-desktop-widget',
				_('Desktop card'),
				_('Show a card below application windows. Right-click it to refresh.'),
			),
		);

		const positionRow = new Adw.ComboRow({
			title: _('Card position'),
			subtitle: _('Corner of the primary monitor.'),
			model: Gtk.StringList.new([
				_('Top right'),
				_('Top left'),
				_('Bottom right'),
				_('Bottom left'),
			]),
		});
		positionRow.selected = Math.max(
			0,
			POSITIONS.indexOf(settings.get_string('desktop-position') as (typeof POSITIONS)[number]),
		);
		positionRow.connect('notify::selected', () => {
			settings.set_string('desktop-position', POSITIONS[positionRow.selected] ?? 'top-right');
		});
		appearance.add(positionRow);

		const behavior = new Adw.PreferencesGroup({
			title: _('Updates and thresholds'),
		});
		page.add(behavior);
		behavior.add(
			boundSpin(
				settings,
				'refresh-interval',
				_('Refresh interval'),
				_('Minutes between usage requests.'),
				1,
				60,
				1,
			),
		);
		behavior.add(
			boundSpin(
				settings,
				'warning-remaining',
				_('Remaining capacity warning'),
				_('Use the warning color below this percentage.'),
				1,
				99,
				1,
			),
		);
		behavior.add(
			boundSpin(
				settings,
				'critical-remaining',
				_('Critical remaining capacity'),
				_('Use the critical color below this percentage.'),
				0,
				98,
				1,
			),
		);

		const source = new Adw.PreferencesGroup({
			title: _('Data source'),
			description: _('Sign-in is handled by the official Claude Code CLI.'),
		});
		page.add(source);

		const cliRow = new Adw.ActionRow({
			title: _('Claude Code'),
			subtitle: _('Checking…'),
		});
		source.add(cliRow);

		const directRow = boundSwitch(
			settings,
			'direct-requests',
			_('Request usage directly'),
			_(
				"Query Anthropic's usage endpoint with Claude Code's credentials instead of running Claude Code.",
			),
		);
		source.add(directRow);

		const loginRow = new Adw.ActionRow({
			title: _('Sign in or renew the session'),
			subtitle: _('Open Claude browser sign-in through Claude Code.'),
			visible: false,
		});
		const loginButton = new Gtk.Button({
			label: _('Sign in'),
			valign: Gtk.Align.CENTER,
			css_classes: ['suggested-action'],
		});
		loginButton.connect('clicked', () => {
			try {
				launchLogin();
			} catch (error) {
				if (!(error instanceof VibecheckError)) {
					throw error;
				}
				window.add_toast(
					new Adw.Toast({
						title:
							error.code === 'terminal-missing'
								? _('No compatible terminal was found to start Claude sign-in.')
								: _('Install Claude Code to authenticate.'),
					}),
				);
			}
		});
		loginRow.add_suffix(loginButton);
		loginRow.activatable_widget = loginButton;
		source.add(loginRow);

		const auth = new ClaudeAuth();
		let checking = false;
		const updateStatus = async () => {
			if (checking) {
				return;
			}
			checking = true;
			try {
				const status = await auth.status();
				cliRow.subtitle = !status.installed
					? _('Not installed. Usage is requested directly.')
					: status.loggedIn
						? _('Installed and signed in.')
						: _('Installed, not signed in.');
				// Without Claude Code there is nothing to choose and no one to sign in with.
				directRow.sensitive = status.installed;
				loginRow.visible = status.installed && !status.loggedIn;
			} finally {
				checking = false;
			}
		};
		void updateStatus();
		// Sign-in happens in a terminal, so check again when the user comes back.
		window.connect('notify::is-active', () => {
			if (window.is_active) {
				void updateStatus();
			}
		});
		window.connect('close-request', () => {
			auth.destroy();
			return false;
		});
	}
}

function boundSwitch(
	settings: Gio.Settings,
	key: string,
	title: string,
	subtitle: string,
): Adw.ActionRow {
	const row = new Adw.SwitchRow({ title, subtitle });
	settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
	return row;
}

function boundCombo(
	settings: Gio.Settings,
	key: string,
	title: string,
	subtitle: string,
	values: readonly string[],
	labels: string[],
): Adw.ComboRow {
	const row = new Adw.ComboRow({ title, subtitle, model: Gtk.StringList.new(labels) });
	row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
	row.connect('notify::selected', () => {
		settings.set_string(key, values[row.selected] ?? values[0]);
	});
	return row;
}

function boundSpin(
	settings: Gio.Settings,
	key: string,
	title: string,
	subtitle: string,
	lower: number,
	upper: number,
	step: number,
): Adw.ActionRow {
	const adjustment = new Gtk.Adjustment({
		lower,
		upper,
		step_increment: step,
		page_increment: step * 5,
	});

	const row = new Adw.SpinRow({ title, subtitle, adjustment, digits: 0 });
	settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
	return row;
}
