import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { parseUsageCommandStream, type CliUsageReport } from '../domain/usage-insights.js';
import { ChildProcess } from './child-process.js';

/** A report that has not finished by then is abandoned. */
const TIMEOUT_SECONDS = 30;

/**
 * Runs Claude Code's `/usage` command. Claude Code then reads its own
 * credentials, renews its session when needed, and queries the usage endpoint
 * itself. Its structured report carries the rate limits; the contributing-usage
 * section, which it builds from the transcripts on this machine, exists only in
 * the printed text and is parsed in the domain layer.
 *
 * The command makes no model request. It loads no settings, so the user's
 * hooks and plugins do not run, and it saves no session, so it does not add
 * itself to the transcripts it reports on.
 */
export class ClaudeCliUsage {
	private process: ChildProcess | null = null;

	static isInstalled(): boolean {
		return GLib.find_program_in_path('claude') !== null;
	}

	/** Resolves with the report, or null when the command failed or is busy. */
	async run(): Promise<CliUsageReport | null> {
		if (this.process || !ClaudeCliUsage.isInstalled()) {
			return null;
		}

		let child: ChildProcess;
		try {
			const launcher = new Gio.SubprocessLauncher({
				flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
			});
			// The CLI must never block on a prompt inherited from GNOME Shell.
			launcher.set_stdin_file_path('/dev/null');
			launcher.set_cwd(GLib.get_home_dir());
			child = new ChildProcess(
				launcher.spawnv([
					'claude',
					'-p',
					'/usage',
					'--setting-sources',
					'',
					'--no-session-persistence',
					'--output-format',
					'stream-json',
					'--verbose',
				]),
				TIMEOUT_SECONDS,
			);
		} catch {
			return null;
		}

		this.process = child;
		try {
			return parseUsageCommandStream(await child.output());
		} catch {
			return null;
		} finally {
			if (this.process === child) {
				this.process = null;
			}
		}
	}

	destroy(): void {
		this.process?.cancel();
		this.process = null;
	}
}
