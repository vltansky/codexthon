# Keep sensitive event data out of source control

- Date: 2026-07-23
- Owners: @vltansky
- Related: `.gitignore`, `SECURITY.md`, `README.md`

## Context

Codexthon processes attendee identity and contact data, personal access links, promo values, Wi-Fi credentials, email delivery records, Google Drive resources, and deployment secrets. The source repository is intended to become public and must remain safe to fork.

## Decision

We will keep real event data, credentials, and deployment-specific infrastructure out of source control.

Committed documentation, tests, and fixtures use synthetic `.example` or `.test` values. Runtime data belongs in the operator's Base44 app. Secrets belong in Base44 Secrets or the operator's credential store. Generated exports, browser traces, local environment files, connector tokens, app-link metadata, access links, and promo values remain untracked.

Public operational output will use aggregate counts and status unless the user explicitly chooses a private, authorized destination.

## Alternatives Considered

- Commit a sample production export and redact it manually: rejected because identifiers and credentials are easy to miss and later Git removal is unreliable.
- Keep deployment IDs and secrets in local source files: rejected because forks, screenshots, issue reports, and Git history can expose them.

## Consequences

- Positive: the repository can be reviewed and published without carrying event-specific private data.
- Positive: each installation starts with an explicit data and secret setup.
- Negative: maintainers cannot reproduce a live event from the repository alone.
- Follow-up: rotate a leaked credential immediately; deleting it from the current tree is not sufficient if it entered Git history.
