export type VibecheckErrorCode =
	| 'claude-cli-missing'
	| 'claude-cli-failed'
	| 'terminal-missing'
	| 'not-authenticated'
	| 'credentials-missing'
	| 'credentials-invalid'
	| 'credentials-expired'
	| 'renewal-failed'
	| 'unauthorized'
	| 'rate-limited'
	| 'server-error'
	| 'network-error'
	| 'invalid-response';

export class VibecheckError extends Error {
	constructor(
		public readonly code: VibecheckErrorCode,
		public readonly retryAfterSeconds: number | null = null,
	) {
		super(code);
		this.name = 'VibecheckError';
	}
}
