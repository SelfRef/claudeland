# Vibecheck

Vibecheck is a GNOME Shell extension that keeps Claude plan capacity visible
without placing an always-on-top application over your work. It runs on any
distribution shipping a supported GNOME Shell, under both X11 and Wayland.
It is an independent project and is not affiliated with or endorsed by Anthropic.

It displays remaining capacity for:

- the current five-hour usage window;
- the all-model weekly window;
- model-scoped weekly limits discovered at runtime, such as Fable;
- any compatible limits Anthropic adds to the response in the future.

> [!WARNING]
> Anthropic does not currently document the OAuth usage endpoint used by Claude
> Code's usage screen. Vibecheck isolates that integration behind one adapter,
> but a Claude Code or server-side change may temporarily break live data.

## Status

The project is at `0.3.1` and targets GNOME Shell 45 through 51, under X11
and Wayland alike. Compatibility is checked against GNOME Shell 50 type
definitions, and every declared release is exercised by a runtime verification
run against a real headless Shell.

## Why a GNOME extension?

GNOME does not let ordinary applications control their global position and
stacking order, and Wayland enforces that by design. A GTK, Qt, Electron, or
Tauri window cannot reliably behave like a desktop widget below every
application on stock GNOME. Vibecheck therefore integrates with GNOME Shell
directly:

- the panel indicator is the stable default;
- the optional desktop card is placed in GNOME's background actor group and is
  non-interactive, so it does not cover application windows or steal input.

## Requirements

- any distribution using GNOME Shell 45 through 51;
- an X11 or a Wayland session; both are supported;
- Claude Code installed and available as `claude` in `PATH`;
- a Claude subscription authenticated through Claude Code;
- Git, Node.js 20.19+, and pnpm 9+ when installing from source.

Check authentication with:

```bash
claude auth status --json
```

If needed, log in through the official browser flow:

```bash
claude auth login --claudeai
```

Vibecheck never asks for browser cookies and does not save a second copy of
your credential.

## Install the release

Download `vibecheck@selfref.dev.shell-extension.zip` and its `.sha256`
companion from the
[latest release](https://github.com/SelfRef/vibecheck/releases/latest),
then, in the download directory, verify and install it for the current user:

```bash
ARCHIVE=vibecheck@selfref.dev.shell-extension.zip
sha256sum --check "$ARCHIVE.sha256"
gnome-extensions install --force "$ARCHIVE"
```

Log out and back in after the first installation, then enable it:

```bash
gnome-extensions enable vibecheck@selfref.dev
```

On X11, GNOME Shell can instead be restarted with `Alt+F2`, `r`, Enter. That
restart shortcut is intentionally unavailable on Wayland, where logging out and
back in is the only way to reload the Shell.

Verify the installation and open preferences with:

```bash
gnome-extensions info vibecheck@selfref.dev
gnome-extensions prefs vibecheck@selfref.dev
```

## Install from source

Clone the public repository, install the locked development dependencies, and
install the extension for your user:

```bash
git clone https://github.com/SelfRef/vibecheck.git
cd vibecheck
corepack enable
pnpm install --frozen-lockfile
pnpm dev:install
```

Then follow the same logout, enable, and verification steps shown above.

## Update

For a release installation, download the assets for the newer version,
verify the checksum, and run `gnome-extensions install --force` again.

For a source installation, update the checkout and reinstall the extension:

```bash
cd vibecheck
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm dev:install
```

Log out and back in to reload the updated extension. On X11 the Shell can
instead be restarted with `Alt+F2`, `r`, Enter.

## Uninstall

```bash
gnome-extensions disable vibecheck@selfref.dev
gnome-extensions uninstall vibecheck@selfref.dev
```

## Commands

| Command               | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `pnpm build`          | Build the ES module package and copy its runtime assets          |
| `pnpm check`          | Check formatting, lint, typecheck, test, and build               |
| `pnpm format`         | Format supported source and documentation files with Prettier    |
| `pnpm test`           | Run parser/domain unit tests                                     |
| `pnpm verify:gjs`     | Run the domain smoke test under GJS                              |
| `pnpm verify:session` | Exercise credential reading and session renewal under GJS        |
| `pnpm verify:shell`   | Verify the built extension on every declared GNOME Shell release |
| `pnpm dev:install`    | Build and install into the user extension directory              |
| `pnpm dev:nested`     | Install, then run the extension in a nested GNOME Shell window   |
| `pnpm package`        | Produce the extension ZIP and SHA-256 checksum in `build/`       |
| `pnpm clean`          | Remove every generated build directory                           |

## Testing the UI

Every GNOME Shell release declared in `metadata.json` is verified in a
disposable container, so a second desktop is not needed:

```bash
pnpm build && pnpm verify:shell        # every declared release
pnpm verify:shell 45 50                # selected releases
```

For each release this starts a real headless GNOME Shell, enables the packaged
extension, checks that it becomes active, survives a disable/enable cycle, and
leaves the journal clean, opens the preferences dialog in its own GTK process,
then renders every panel and card state through a throwaway probe extension
(`tests/shell/uicheck-extension.js`). The containers have no network access and
mock logind on a private bus, so nothing outside the container is touched.
Docker is the only requirement.

To drive the real UI by hand, run it in a nested GNOME Shell window:

```bash
pnpm dev:nested
```

This installs the extension and starts a nested Wayland shell with it enabled,
using its own settings database in `build/nested`, so your desktop session is
not touched.
GNOME 48 and older use `--nested`; GNOME 49+ uses Mutter DevKit, which on Ubuntu
needs `mutter-dev-bin` (Arch: `mutter-devkit`).

Follow logs with:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

## Authentication and data flow

```text
Claude Code browser login
          │
          ▼
~/.claude/.credentials.json <── claude auth login (non-interactive renewal)
          │                                │
          │ read on demand, never copied   │ access token expired, or 401
          ▼                                │
ClaudeUsageClient ── HTTPS ──> Anthropic OAuth usage endpoint
          │
          ▼
normalizeUsage() ──> UsageSnapshot ──> panel + desktop card
```

The extension polls at a configurable interval, with a minimum of one minute.
It does not send prompts or create Claude conversations. A `429` preserves the
last valid snapshot and backs off.

### Session renewal

Claude Code issues a short-lived access token alongside a long-lived refresh
token, so an access token that expires overnight does not end the session.

When the access token has expired, or a request comes back `401`, Vibecheck
asks the Claude Code CLI to renew the session non-interactively and retries the
request once. Vibecheck never speaks the OAuth token protocol itself: the CLI
keeps ownership of the client identity, of refresh-token rotation, and of the
credential file. The refresh token is read from that file, passed to the CLI
through the child environment, and never stored or logged.

Signing in again is requested only when the refresh token is missing, expired,
or rejected. After a failed renewal Vibecheck waits fifteen minutes before
trying again.

## Privacy

- No analytics or telemetry.
- No browser-cookie access.
- No account identifiers in settings.
- No credential is copied out of `~/.claude/.credentials.json`; the refresh
  token is only handed back to the Claude Code CLI.
- No real API responses or credentials in test fixtures.
- Usage data stays in memory and is discarded when the extension is disabled.

## Languages

English is the source and fallback language. Vibecheck follows the GNOME
system locale through gettext; Italian is included in the initial release.
Translations live in `po/` and are compiled into the extension during build.

See [SECURITY.md](SECURITY.md) for the threat model.

## Repository layout

```text
src/domain/       Pure types, normalization, formatting
src/services/     Claude credentials, auth, and HTTP adapter
src/ui/           GNOME Shell indicator and desktop actor
schemas/          GSettings schema
tests/            Unit tests and synthetic fixtures
scripts/          Reproducible build/install/pack commands
docs/             Architecture decisions and roadmap
```

## Limitations

- The usage endpoint is undocumented and may change without notice.
- The desktop card lives inside the wallpaper's own actor group, since GNOME
  Shell exposes no stable API dedicated to third-party desktop widgets.
- A normal “daily quota” is not provided by Claude subscriptions. Vibecheck
  shows the official five-hour and weekly windows instead.
- KDE Plasma, Sway, and Hyprland need separate frontends; they are not GNOME
  Shell and cannot load this extension.

## Contributing

Bug reports and pull requests are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

## Credits

Vibecheck began as a fork of Claudeland, originally written by
[FabioSM46](https://github.com/FabioSM46).
