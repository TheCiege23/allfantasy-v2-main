# Game Day — what remains

This directory was the Phase 9 "Game Day / Scoring Service (Shadow Mode)". The shadow modules —
`GameDayContextAssembler`, `MatchupStateNormalizer`, `LineupAttentionService`, `GameWindowService`,
`GameDayDivergenceAnalyzer`, `GameDaySnapshotService` and `GameDaySnapshotStore` — were removed on
2026-09-30. None had a production caller: their only non-test importers were each other and the
`lib/shared-services/commissioner` shadow package (removed at the same time), whose last caller,
`lib/shared-services/league-hub/commissionerOsContext.ts`, was deleted in PR #1621. The Phase 9 write-up,
including the audit of the live engines they wrapped, is in git history
(`git show b85cdfb15:lib/shared-services/game-day/README.md`).

What stays is live:

- **`UserPlayerExposureService.ts`** — per-user, cross-league player exposure. Read by
  `/api/players/my-exposure`, `lib/activity/sources/rosterInjuryActivity.ts`,
  `lib/chimmy-alerts/hydrateInjuredStarters.ts` (dynamic import) and `lib/shared-services/league-hub/`.
- **`exposureKey.ts`** — the exposure map key, used by the service above.
- **`types.ts`** — `UserPlayerExposure` and related types.

`UserPlayerExposure` is the user's own private data and is deliberately **not** the Knowledge Graph's
cohort-gated `PlayerExposure` (`lib/shared-services/knowledge-graph/`); the two are never mixed.
