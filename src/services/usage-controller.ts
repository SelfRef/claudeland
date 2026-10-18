import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { ClaudeCredential } from '../domain/credential.js';
import { canRenew, evaluateSession, isAccessTokenUsable } from '../domain/session.js';
import { severityFor, type UsageSnapshot } from '../domain/usage.js';
import { ClaudeAuth } from './claude-auth.js';
import { ClaudeCredentials } from './claude-credentials.js';
import { ClaudeUsageClient } from './claude-usage-client.js';
import { VibecheckError } from './errors.js';

export interface UsageState {
	snapshot: UsageSnapshot | null;
	loading: boolean;
	renewing: boolean;
	stale: boolean;
	errorCode: VibecheckError['code'] | null;
	planLabel: string | null;
}

type StateListener = (state: Readonly<UsageState>) => void;

type UsageClient = Pick<ClaudeUsageClient, 'fetch' | 'destroy'>;
type UsageAuth = Pick<ClaudeAuth, 'status' | 'renew' | 'launchLogin' | 'destroy'>;
type UsageCredentials = Pick<ClaudeCredentials, 'read'>;

export interface UsageControllerDependencies {
	client?: UsageClient;
	auth?: UsageAuth;
	credentials?: UsageCredentials;
}

/**
 * How long to wait before asking the CLI to renew again after a failure, so a
 * broken session cannot turn every poll into a subprocess spawn.
 */
const RENEWAL_COOLDOWN_MS = 15 * 60 * 1000;

export class UsageController {
	private readonly listeners = new Set<StateListener>();
	private client: UsageClient | null;
	private auth: UsageAuth | null;
	private credentials: UsageCredentials | null;
	private timeoutId: number | null = null;
	private renewalBlockedUntil = 0;
	private state: UsageState = {
		snapshot: null,
		loading: false,
		renewing: false,
		stale: false,
		errorCode: null,
		planLabel: null,
	};

	constructor(
		private readonly settings: Gio.Settings,
		dependencies: UsageControllerDependencies = {},
	) {
		this.client = dependencies.client ?? new ClaudeUsageClient();
		this.auth = dependencies.auth ?? new ClaudeAuth();
		this.credentials = dependencies.credentials ?? new ClaudeCredentials();
	}

	start(): void {
		void this.refresh();
	}

	/** Re-render the cached snapshot after a display-only setting changed. */
	redraw(): void {
		const snapshot = this.state.snapshot;
		const warning = this.settings.get_uint('warning-remaining');
		const critical = this.settings.get_uint('critical-remaining');
		this.setState({
			snapshot: snapshot && {
				...snapshot,
				limits: snapshot.limits.map((limit) => ({
					...limit,
					severity: severityFor(limit.remainingPercent, warning, critical),
				})),
			},
		});
	}

	subscribe(listener: StateListener): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	async refresh(): Promise<void> {
		const client = this.client;
		if (!client || this.state.loading) {
			return;
		}

		this.setState({ loading: true, errorCode: null });
		let nextDelay = this.baseIntervalSeconds();

		try {
			let credential = await this.readCredential();
			if (this.client !== client) {
				return;
			}

			// An expired access token is not a lost session: the CLI can still
			// exchange its refresh token for a new one.
			let renewed = false;
			if (evaluateSession(credential) !== 'valid') {
				credential = await this.renewCredential(credential);
				renewed = true;
				if (this.client !== client) {
					return;
				}
			}

			const options = {
				warningRemaining: this.settings.get_uint('warning-remaining'),
				criticalRemaining: this.settings.get_uint('critical-remaining'),
			};

			let result;
			try {
				result = await client.fetch(credential, options);
			} catch (error) {
				// The server is the authority on token validity: honour a 401 even
				// when the recorded expiry still looked fine.
				if (
					!renewed &&
					error instanceof VibecheckError &&
					error.code === 'unauthorized' &&
					canRenew(credential)
				) {
					credential = await this.renewCredential(credential);
					if (this.client !== client) {
						return;
					}
					result = await client.fetch(credential, options);
				} else {
					throw error;
				}
			}

			if (this.client !== client) {
				return;
			}
			this.renewalBlockedUntil = 0;
			this.setState({
				snapshot: result.snapshot,
				planLabel: result.planLabel,
				loading: false,
				renewing: false,
				stale: false,
				errorCode: null,
			});
		} catch (error) {
			if (this.client !== client) {
				return;
			}
			if (error instanceof VibecheckError && error.code === 'rate-limited') {
				nextDelay = Math.max(nextDelay, error.retryAfterSeconds ?? nextDelay * 2);
			}
			this.setState({
				loading: false,
				renewing: false,
				stale: this.state.snapshot !== null,
				errorCode: error instanceof VibecheckError ? error.code : 'network-error',
			});
		} finally {
			if (this.client === client) {
				this.schedule(nextDelay);
			}
		}
	}

	launchLogin(): void {
		// A manual sign-in is an explicit fresh start for automatic renewal too.
		this.renewalBlockedUntil = 0;
		this.auth?.launchLogin();
	}

	destroy(): void {
		const client = this.client;
		const auth = this.auth;
		this.client = null;
		this.auth = null;
		this.credentials = null;
		if (this.timeoutId !== null) {
			GLib.Source.remove(this.timeoutId);
			this.timeoutId = null;
		}
		this.listeners.clear();
		auth?.destroy();
		client?.destroy();
	}

	/**
	 * Reads the credential Claude Code owns, asking the CLI for context only
	 * when the file cannot be used. The happy path stays free of subprocesses.
	 */
	private async readCredential(): Promise<ClaudeCredential> {
		const credentials = this.credentials;
		if (!credentials) {
			throw new VibecheckError('credentials-missing');
		}

		try {
			return await credentials.read();
		} catch (error) {
			if (error instanceof VibecheckError && error.code === 'credentials-missing') {
				const status = await this.auth?.status();
				if (status && !status.installed) {
					throw new VibecheckError('claude-cli-missing');
				}
				if (status && !status.loggedIn) {
					throw new VibecheckError('not-authenticated');
				}
			}
			throw error;
		}
	}

	/**
	 * Delegates renewal to the Claude Code CLI and returns the credential it
	 * wrote. Vibecheck never talks to the OAuth token endpoint itself.
	 */
	private async renewCredential(credential: ClaudeCredential): Promise<ClaudeCredential> {
		const auth = this.auth;
		if (!auth) {
			throw new VibecheckError('credentials-expired');
		}
		if (!canRenew(credential)) {
			throw new VibecheckError('credentials-expired');
		}
		if (Date.now() < this.renewalBlockedUntil) {
			throw new VibecheckError('renewal-failed');
		}

		this.setState({ renewing: true });
		try {
			await auth.renew(credential);
		} finally {
			if (this.auth === auth) {
				this.setState({ renewing: false });
			}
		}

		// The credential file is the authority, not this subprocess's exit code.
		// Another Claude Code process can rotate the single-use refresh token at
		// the same time: our process then fails even though the shared file now
		// contains a valid replacement.
		const next = await this.readCredential();
		if (isAccessTokenUsable(next)) {
			this.renewalBlockedUntil = 0;
			return next;
		}

		this.renewalBlockedUntil = Date.now() + RENEWAL_COOLDOWN_MS;
		throw new VibecheckError('renewal-failed');
	}

	private setState(patch: Partial<UsageState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}

	private schedule(seconds: number): void {
		if (!this.client) {
			return;
		}
		if (this.timeoutId !== null) {
			GLib.Source.remove(this.timeoutId);
			this.timeoutId = null;
		}
		this.timeoutId = GLib.timeout_add_seconds(
			GLib.PRIORITY_DEFAULT,
			Math.max(60, Math.round(seconds)),
			() => {
				this.timeoutId = null;
				void this.refresh();
				return GLib.SOURCE_REMOVE;
			},
		);
	}

	private baseIntervalSeconds(): number {
		return Math.max(1, this.settings.get_uint('refresh-interval')) * 60;
	}
}
