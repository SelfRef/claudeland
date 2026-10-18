import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {
	normalizeUsage,
	type NormalizeOptions,
	type UsageSnapshot,
	formatPlanLabel,
} from '../domain/usage.js';
import type { ClaudeCredential } from '../domain/credential.js';
import { VibecheckError } from './errors.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

export class ClaudeUsageClient {
	private readonly session = new Soup.Session({
		timeout: 20,
		user_agent: 'vibecheck',
	});

	/**
	 * Performs one usage request with the credential it is given. Credential
	 * reading and session renewal belong to the caller, so a retry after a
	 * renewal is an ordinary second call with a fresher access token.
	 */
	async fetch(
		credential: ClaudeCredential,
		options: NormalizeOptions = {},
	): Promise<UsageFetchResult> {
		const message = Soup.Message.new('GET', USAGE_URL);
		message.request_headers.append('Authorization', `Bearer ${credential.accessToken}`);
		message.request_headers.append('anthropic-beta', OAUTH_BETA);

		let bytes: GLib.Bytes;
		try {
			bytes = await sendAndRead(this.session, message);
		} catch {
			throw new VibecheckError('network-error');
		}

		const status = message.status_code;
		if (status === Soup.Status.UNAUTHORIZED || status === Soup.Status.FORBIDDEN) {
			throw new VibecheckError('unauthorized');
		}
		if (status === 429) {
			throw new VibecheckError('rate-limited', parseRetryAfter(message));
		}
		if (status >= 500) {
			throw new VibecheckError('server-error');
		}
		if (status < 200 || status >= 300) {
			throw new VibecheckError('invalid-response');
		}

		try {
			const payload = JSON.parse(
				new TextDecoder().decode(bytes.get_data() ?? new Uint8Array()),
			) as unknown;
			return {
				snapshot: normalizeUsage(payload, options),
				planLabel: formatPlanLabel(credential.subscriptionType, credential.rateLimitTier),
			};
		} catch {
			throw new VibecheckError('invalid-response');
		}
	}

	destroy(): void {
		this.session.abort();
	}
}

export interface UsageFetchResult {
	snapshot: UsageSnapshot;
	planLabel: string;
}

function parseRetryAfter(message: Soup.Message): number | null {
	const header = message.response_headers.get_one('retry-after');
	if (!header) {
		return null;
	}
	const seconds = Number.parseInt(header, 10);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function sendAndRead(session: Soup.Session, message: Soup.Message): Promise<GLib.Bytes> {
	return new Promise((resolve, reject) => {
		session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
			try {
				resolve(source!.send_and_read_finish(result));
			} catch (error) {
				reject(error);
			}
		});
	});
}
