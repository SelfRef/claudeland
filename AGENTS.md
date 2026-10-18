# AGENTS.md

Vibecheck is a GNOME Shell extension that shows the remaining Claude
subscription capacity: the five-hour window, weekly limits, and model-scoped
limits discovered at runtime.

## Workflow

- Work and commit on `master`, the only branch.
- Use `pnpm`. Run `pnpm check` before every commit.
- UI or Shell changes: run `pnpm verify:shell`; try them by hand with
  `pnpm dev:nested`.
- Releases are cut by the manual Release workflow, which bumps the version and
  moves the `Unreleased` changelog section under it. Add user-visible changes
  to `CHANGELOG.md` under `Unreleased`.

## GNOME support

- Target only maintained GNOME Shell releases (the current stable and the one
  before it). When a new release ships, drop the oldest: update `metadata.json`
  and the `tests/shell/Dockerfile.gnome*` containers together.
- No version checks or compatibility shims for unmaintained releases.

## Code layout

- `src/domain/`: pure types, normalization, and formatting. No GNOME imports;
  runs under Node and is covered by unit tests.
- `src/services/`: credentials, Claude Code authentication, and the HTTP
  adapter. The usage endpoint is undocumented: keep it isolated in
  `claude-usage-client.ts` and treat every response as untrusted.
- `src/ui/`: Shell actors and menus. `extension.ts` is lifecycle only;
  `prefs.ts` must not import Shell, St, or Clutter.
- Discover model-scoped limits dynamically; never hard-code model names.
- New response shapes get a fixture and a parser test.
- User-facing percentages are remaining capacity, not consumed.
- Wrap user-facing strings in gettext and update `po/vibecheck.pot` and
  `po/it.po`.

## GNOME Shell rules

- Clean up every signal, timeout, and actor in `disable()` or `destroy()`.
- No synchronous network or file I/O on the Shell main loop.
- Use public API only; never touch underscore-prefixed Shell fields.
- Keep the desktop card inside the wallpaper's `Meta.BackgroundGroup`. As a
  sibling in `global.window_group` it floats above application windows.

## Credentials and security

- Never log, persist, commit, or use in fixtures a real token, email address,
  or organization identifier.
- Authentication and session renewal belong to the Claude Code CLI (ADR 002,
  ADR 003). Do not implement the OAuth token protocol or scrape browser
  cookies.
- The refresh token stays in memory and reaches the CLI only through the child
  environment, never argv, GSettings, logs, or files.
- An expired access token is not an expired session: ask the user to sign in
  only when the refresh token is missing, expired, or rejected. Renew at most
  once per request cycle and back off after a failure.
