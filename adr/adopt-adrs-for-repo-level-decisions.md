# Adopt ADRs for repo-level decisions

- Date: 2026-07-23
- Owners: @vltansky
- Related: `AGENTS.md`, `README.md`

## Context

Codexthon was assembled through several event-day coding sessions, deployment investigations, and operational corrections. Important rationale lived in transcripts, while the root documentation mostly described the resulting features. That makes it difficult to distinguish durable constraints from temporary implementation history.

## Decision

We will use Architecture Decision Records in `adr/` for architecture-impacting, security-sensitive, cross-cutting, or hard-to-reverse repository decisions.

ADRs are accepted through review and merge. They use slug-only filenames without numeric prefixes. Temporary exploration, event operations, live counts, and session artifacts stay outside `adr/`.

## Alternatives Considered

- Keep rationale only in `README.md`: rejected because the README should help operators use the system, not carry design history.
- Rely on Git history and transcripts: rejected because the repository was republished with clean history and conversation history is not a stable contributor surface.
- Store plans and accepted decisions together: rejected because future readers need to know which constraints still govern the code.

## Consequences

- Positive: contributors can recover the reason behind major boundaries without access to private transcripts.
- Positive: the root documentation can remain concise and operational.
- Negative: maintainers must decide when a change is significant enough for an ADR.
- Follow-up: supersede an accepted ADR with a new record instead of editing it after merge.

## Links

- [ADR directory](./README.md)
