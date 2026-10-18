export type VibecheckErrorCode =
  | 'claude-cli-missing'
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
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'VibecheckError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof VibecheckError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}
