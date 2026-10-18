import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * A spawned process with a time limit. `cancel()` kills it and removes its
 * timer right away, so nothing outlives the extension's `disable()`.
 */
export class ChildProcess {
	private readonly cancellable = new Gio.Cancellable();
	private timeoutId: number | null;

	constructor(
		private readonly process: Gio.Subprocess,
		timeoutSeconds: number,
	) {
		this.timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
			this.timeoutId = null;
			this.process.force_exit();
			return GLib.SOURCE_REMOVE;
		});
	}

	/** Resolves with standard output once the process exits. */
	output(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			this.process.communicate_utf8_async(null, this.cancellable, (source, result) => {
				try {
					const [, stdout] = source!.communicate_utf8_finish(result);
					resolve(stdout ?? '');
				} catch (error) {
					reject(error);
				}
			});
		}).finally(() => this.removeTimeout());
	}

	/** Resolves true when the process exits successfully. */
	succeeded(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.process.wait_check_async(this.cancellable, (source, result) => {
				try {
					// Throws on a non-zero exit.
					resolve(source!.wait_check_finish(result));
				} catch {
					resolve(false);
				}
			});
		}).finally(() => this.removeTimeout());
	}

	cancel(): void {
		this.removeTimeout();
		this.cancellable.cancel();
		this.process.force_exit();
	}

	private removeTimeout(): void {
		if (this.timeoutId !== null) {
			GLib.Source.remove(this.timeoutId);
			this.timeoutId = null;
		}
	}
}
