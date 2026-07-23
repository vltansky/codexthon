# Model judging with exclusive panel assignments

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/entities/judge.jsonc`, `base44/entities/judge-group.jsonc`, `app/AdminJudgingPage.tsx`

## Context

The event already had a mentor-per-team model. Judging required separate contacts and small panels that could include judges and mentors, with each panel responsible for several teams. Extending the mentor model or adding a general join graph would make a bounded operational workflow harder to manage.

## Decision

We will keep mentor assignment unchanged and add admin-only `Judge` and `JudgeGroup` entities.

A judge group stores typed arrays of mentor keys, judge keys, and team keys. A team belongs to at most one judge group; assigning it to a group removes it from every other group. Missing team keys are rendered as stale references so an operator can remove them after roster changes.

This model covers the directory and assignment workflow only. Participant visibility, scoring, ranking, deliberation, wildcards, schedules, and results are separate future decisions.

## Alternatives Considered

- Reuse mentor assignment for judging: rejected because mentoring and judging are different roles and schedules.
- Add join entities for every panel membership and team assignment: rejected because panels are small and edited as one bounded aggregate.
- Build the scoring workflow at the same time: rejected because assignment logistics were the immediate operational need.

## Consequences

- Positive: the data model mirrors how small judging rooms are operated.
- Positive: mentor relationships remain stable while mentors can also join panels.
- Negative: array references can become stale when imported roster keys change.
- Negative: exclusivity must be enforced by every write path, including the UI and Admin MCP.
