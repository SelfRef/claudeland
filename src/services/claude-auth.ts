import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { ClaudeCredential } from '../domain/credential.js';
import { ChildProcess } from './child-process.js';
import { VibecheckError } from './errors.js';

export interface ClaudeAuthStatus {
	installed: boolean;
	loggedIn: boolean;
}

/**
 * Scopes used only when the credential file does not declare its own. Claude
 * Code rejects a refresh token whose scopes are not restated.
 */
const FALLBACK_SCOPES = [
	'user:profile',
	'user:inference',
	'user:sessions:claude_code',
	'user:mcp_servers',
];

/** A status check that has not finished by then is treated as signed out. */
const STATUS_TIMEOUT_SECONDS = 15;

/** A renewal that has not finished by then is treated as failed. */
const RENEW_TIMEOUT_SECONDS = 45;

export class ClaudeAuth {
	private statusProcess: ChildProcess | null = null;
	private renewal: Promise<boolean> | null = null;
	private renewalProcess: ChildProcess | null = null;

	async status(): Promise<ClaudeAuthStatus> {
		if (!GLib.find_program_in_path('claude')) {
			return { installed: false, loggedIn: false };
		}

		let child: ChildProcess | null = null;
		try {
			child = new ChildProcess(
				Gio.Subprocess.new(
					['claude', 'auth', 'status', '--json'],
					Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
				),
				STATUS_TIMEOUT_SECONDS,
			);
			this.statusProcess = child;
			const parsed = JSON.parse((await child.output()) || '{}') as { loggedIn?: unknown };
			return { installed: true, loggedIn: parsed.loggedIn === true };
		} catch {
			return { installed: true, loggedIn: false };
		} finally {
			if (this.statusProcess === child) {
				this.statusProcess = null;
			}
		}
	}

	/**
	 * Asks the Claude Code CLI to exchange its refresh token for a fresh access
	 * token, using the CLI's documented non-interactive login environment.
	 *
	 * Vibecheck deliberately does not speak the OAuth token protocol itself:
	 * the CLI owns the client identity, the rotation, and the credential file
	 * format. The refresh token is passed through the child environment, never
	 * through argv, and is not retained afterwards.
	 *
	 * Resolves true when the CLI reports success. It never opens a browser: the
	 * refresh-token environment selects a non-interactive code path.
	 */
	async renew(credential: ClaudeCredential): Promise<boolean> {
		if (!credential.refreshToken) {
			return false;
		}
		if (!GLib.find_program_in_path('claude')) {
			throw new VibecheckError('claude-cli-missing');
		}
		if (this.renewal) {
			return this.renewal;
		}

		const scopes = credential.scopes.length > 0 ? credential.scopes : FALLBACK_SCOPES;
		this.renewal = this.spawnRenewal(credential.refreshToken, scopes.join(' ')).finally(() => {
			this.renewal = null;
			this.renewalProcess = null;
		});
		return this.renewal;
	}

	destroy(): void {
		this.statusProcess?.cancel();
		this.statusProcess = null;
		this.renewalProcess?.cancel();
		this.renewalProcess = null;
		this.renewal = null;
	}

	private spawnRenewal(refreshToken: string, scopes: string): Promise<boolean> {
		try {
			const launcher = new Gio.SubprocessLauncher({
				flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
			});
			// Never through argv: process arguments are world-readable.
			launcher.setenv('CLAUDE_CODE_OAUTH_REFRESH_TOKEN', refreshToken, true);
			launcher.setenv('CLAUDE_CODE_OAUTH_SCOPES', scopes, true);
			// The CLI must never block on a prompt inherited from GNOME Shell.
			launcher.set_stdin_file_path('/dev/null');
			this.renewalProcess = new ChildProcess(
				launcher.spawnv(['claude', 'auth', 'login', '--claudeai']),
				RENEW_TIMEOUT_SECONDS,
			);
		} catch {
			return Promise.resolve(false);
		}
		// A non-zero exit is how the CLI reports a failed renewal.
		return this.renewalProcess.succeeded();
	}
}

/**
 * Opens Claude Code's interactive browser sign-in in the user's terminal. Used
 * by both the Shell menu and the preferences window.
 */
export function launchLogin(): void {
	if (!GLib.find_program_in_path('claude')) {
		throw new VibecheckError('claude-cli-missing');
	}

	const command = ['claude', 'auth', 'login', '--claudeai'];
	const terminalCandidates: string[][] = [
		['kgx', '--', ...command],
		['gnome-terminal', '--', ...command],
		['x-terminal-emulator', '-e', ...command],
	];

	for (const argv of terminalCandidates) {
		if (GLib.find_program_in_path(argv[0])) {
			Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
			return;
		}
	}

	throw new VibecheckError('terminal-missing');
}
