# Contributing

Bug reports, ideas, and pull requests are welcome.

- Open an issue first for larger changes, so we can agree on the approach.
- Run `pnpm check` before pushing; changes to the UI or Shell integration
  should also pass `pnpm verify:shell`.
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/),
  such as `fix(panel): keep the icon size stable`.
- Add user-visible changes to the `Unreleased` section of `CHANGELOG.md`.
- Never include real tokens, email addresses, organization IDs, or raw API
  responses in code, fixtures, or logs.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
