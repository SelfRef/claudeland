import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { parseUsageInsights, type UsageInsightPeriod } from '../domain/usage-insights.js';
import { isRecord } from '../domain/usage.js';
import { communicateUtf8 } from './claude-auth.js';

/** A report that has not finished by then is abandoned. */
const TIMEOUT_SECONDS = 30;

/**
 * Reads the "What's contributing to your limits usage?" report that Claude
 * Code's `/usage` command builds from the transcripts on this machine. The CLI
 * prints it only as text, so the text is parsed in the domain layer.
 *
 * The command runs locally and makes no model request. It loads no settings,
 * so the user's hooks and plugins do not run, and it saves no session, so it
 * does not add itself to the transcripts it reports on.
 */
export class ClaudeUsageInsights {
	private process: Gio.Subprocess | null = null;

	/** Resolves with the report's periods, or null when it is unavailable. */
	async fetch(): Promise<UsageInsightPeriod[] | null> {
		if (this.process || !GLib.find_program_in_path('claude')) {
			return null;
		}

		let process: Gio.Subprocess;
		try {
			const launcher = new Gio.SubprocessLauncher({
				flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
			});
			// The CLI must never block on a prompt inherited from GNOME Shell.
			launcher.set_stdin_file_path('/dev/null');
			launcher.set_cwd(GLib.get_home_dir());
			process = launcher.spawnv([
				'claude',
				'-p',
				'/usage',
				'--setting-sources',
				'',
				'--no-session-persistence',
				'--output-format',
				'json',
			]);
		} catch {
			return null;
		}

		this.process = process;
		let timeoutId: number | null = GLib.timeout_add_seconds(
			GLib.PRIORITY_DEFAULT,
			TIMEOUT_SECONDS,
			() => {
				timeoutId = null;
				process.force_exit();
				return GLib.SOURCE_REMOVE;
			},
		);

		try {
			const [, stdout] = await communicateUtf8(process);
			const parsed = JSON.parse(stdout ?? '') as unknown;
			if (!isRecord(parsed) || parsed.is_error === true || typeof parsed.result !== 'string') {
				return null;
			}
			return parseUsageInsights(parsed.result);
		} catch {
			return null;
		} finally {
			if (timeoutId !== null) {
				GLib.Source.remove(timeoutId);
			}
			if (this.process === process) {
				this.process = null;
			}
		}
	}

	destroy(): void {
		this.process?.force_exit();
		this.process = null;
	}
}
