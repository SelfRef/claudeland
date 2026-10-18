import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
	InvalidCredentialError,
	parseCredential,
	type ClaudeCredential,
} from '../domain/credential.js';
import { VibecheckError } from './errors.js';

export type { ClaudeCredential };

/**
 * Reads the credential Claude Code owns. The file is re-read on every request
 * so a token the CLI rotated in the meantime is picked up without restarting
 * the extension.
 */
export class ClaudeCredentials {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
	}

	async read(): Promise<ClaudeCredential> {
		const file = Gio.File.new_for_path(this.path);
		let bytes: Uint8Array;

		try {
			bytes = await loadContents(file);
		} catch {
			throw new VibecheckError('credentials-missing');
		}

		let payload: unknown;
		try {
			payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
		} catch {
			throw new VibecheckError('credentials-invalid');
		}

		try {
			return parseCredential(payload);
		} catch (error) {
			throw new VibecheckError(
				error instanceof InvalidCredentialError && error.problem === 'missing'
					? 'credentials-missing'
					: 'credentials-invalid',
			);
		}
	}
}

function loadContents(file: Gio.File): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		file.load_contents_async(null, (source, result) => {
			try {
				const [, contents] = source!.load_contents_finish(result);
				resolve(contents);
			} catch (error) {
				reject(error);
			}
		});
	});
}
