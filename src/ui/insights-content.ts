import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import type { UsageInsightPeriod } from '../domain/usage-insights.js';

/**
 * Claude Code's contributing-usage report: one titled group per period. The
 * findings are shown as Claude Code words them, which is English only.
 */
export function createInsightsContent(periods: readonly UsageInsightPeriod[]): St.BoxLayout {
	const content = new St.BoxLayout({
		x_expand: true,
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'vibecheck-insights',
	});
	content.add_child(
		new St.Label({
			text: _('Contributing to usage on this machine'),
			style_class: 'vibecheck-insights-heading',
		}),
	);

	for (const period of periods) {
		const group = new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			style_class: 'vibecheck-insight-period',
		});
		group.add_child(
			wrapped(new St.Label({ text: period.title, style_class: 'vibecheck-insight-title' })),
		);
		for (const line of period.lines) {
			group.add_child(
				wrapped(
					new St.Label({
						text: line,
						style_class: 'vibecheck-insight-line',
						// Dimmed rather than recolored, so it follows a light or dark menu.
						opacity: 180,
					}),
				),
			);
		}
		content.add_child(group);
	}
	return content;
}

function wrapped(label: St.Label): St.Label {
	label.clutter_text.line_wrap = true;
	label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
	return label;
}
