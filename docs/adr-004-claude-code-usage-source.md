# ADR 004: Read usage through the Claude Code CLI by default

- Status: accepted
- Date: 2026-10-18

## Context

Vibecheck read Claude Code's credential file, queried the undocumented OAuth
usage endpoint itself, and asked the CLI to renew the session when the access
token expired (ADR 003). That made Vibecheck responsible for the endpoint URL,
its beta header, the session state machine, and every change Anthropic makes to
any of them.

Claude Code's `/usage` command already does all of this. Run as
`claude -p /usage --output-format stream-json --verbose`, it prints a
structured report holding the same rate limits in the endpoint's shape, plus a
"What's contributing to your limits usage?" section that Claude Code computes
from local transcripts and that the endpoint does not return. The command makes
no model request and costs nothing. `--setting-sources ''` keeps the user's
hooks and plugins from running, and `--no-session-persistence` keeps the run
out of the transcripts it reports on. A run takes about 1.5 seconds.

## Decision

When Claude Code is installed, read usage by running its `/usage` command on
every poll, asynchronously and with a timeout. Claude Code then owns reading the
credential, renewing the session, and talking to the endpoint.

Keep the direct request path behind a "Request usage directly" setting, and use
it automatically when Claude Code is not installed.

## Consequences

- Endpoint changes that Claude Code absorbs no longer break Vibecheck by
  default, and the contributing-usage report comes with every poll.
- Every poll spawns one CLI process instead of making one HTTPS request.
- The plan name still comes from the credential file, which only the CLI
  writes; the `/usage` report does not include it.
- Signed out, the command reports no limits and no error, so Vibecheck asks
  `claude auth status` to tell a missing sign-in from a failure.
- ADR 003 still applies to direct requests.
