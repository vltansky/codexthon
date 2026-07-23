# Repository guidelines

- Follow the existing TypeScript and React patterns.
- Prefer early returns and small, focused components.
- Keep credentials, attendee data, access links, promo values, and event-specific infrastructure out of source control.
- Use synthetic `.example` or `.test` data in documentation, fixtures, and tests.
- Run `npm test`, `npm run test:mcp`, `npm run typecheck`, and `npm run build` before submitting changes.
- Do not start a development server unless the user explicitly requests it.
- Use Conventional Commits for commit and pull-request titles.
- Never commit generated exports, browser traces, local environment files, or deployment credentials.

## Architecture decisions

- Record cross-cutting, security-sensitive, or hard-to-reverse repository decisions in `adr/`.
- Prefer ADR-first: when a task settles such a decision, draft the ADR before or alongside the implementation, not as an afterthought — it is part of the change, not follow-up documentation.
- Before finishing a feature, check whether it settled a decision that belongs in `adr/`; shipping one without its ADR is an incomplete change.
- Keep session notes, temporary exploration, event counts, and deployment status out of ADRs.
- Merged ADRs are immutable; supersede a decision with a new slug-only ADR.
