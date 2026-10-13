# NBA Survivor create-to-draft audit — 2026-10-12

Scope: the active Create League v2 wizard, canonical creation and validation, seat claims, native draft start, scheduled start, and the completed-draft Survivor handoff. This is a code and automated-test audit; a multi-account live draft against a staging database is still required before a public invite wave.

## Fixed in this change

1. The active wizard did not expose its Survivor tribe count or whether the commissioner plays. New leagues therefore silently used four tribes and a host-only commissioner even when the creator expected to manage a team. Both choices now appear on Basics and Review, are sent to the canonical API, and are validated for the selected cast size.
2. Native Survivor drafts could start while cast seats were unclaimed, duplicated, or held by a host-only commissioner. The completed-draft initializer then rejected the cast after picks had been made. All draft-start entry points now share a server check before the first pick and return an actionable 409. The check also refuses a season calendar that no longer has enough weeks to reach the finale.
3. The draft time was persisted, but no scheduler started the draft. New Survivor leagues now opt into autostart; the existing authenticated draft tick starts due native Survivor drafts after checking session status and player-pool readiness. The fast-tier scheduler includes the draft tick even when the Vercel manifest does not.
4. Claiming a reserved seat updated roster ownership but left the pre-draft room's slot labelled “Open Team.” Survivor seat claims and releases now keep that slot's name and open flag in sync.
5. A past draft time could pass creation validation and immediately qualify for autostart. New Survivor creation now requires a future scheduled draft time.

## Verified

- Focused create, draft, seat, scheduler, and handoff Vitest suites pass.
- Changed source files pass ESLint.
- TypeScript reports no diagnostics in edited files; repository-wide `tsc --noEmit` still exits nonzero on pre-existing diagnostics elsewhere.
- The fast-tier scheduler dry run lists `/api/cron/draft-tick` at one-minute cadence.

## Remaining launch checks

- Run a staging rehearsal with 16–20 distinct accounts: create both commissioner modes, claim every seat, confirm only the owner can pick, complete every round, verify NBA rosters, tribes, private idols, Exile, and the first weekly settlement. The tests here do not prove production data availability or browser behavior during a full draft.
- Confirm the production draft tick heartbeat and `DRAFT_TICK_CRON_ENABLED` setting. Scheduled start is independent of that flag, but fully unattended expired-pick autopick still depends on it.
- The current post-draft idol seeder still issues `rosterSpots + tribeCount` Vote Shields attached to roster IDs. That differs from the requested minority-of-managers, real-player-bound, tradeable idol design and needs a separate gameplay implementation before positioning the full Survivor season as complete.
- New Survivor creation remains NBA-only and accepts 16–20 cast seats. NHL, other sports, and 24-seat casts remain outside this pilot.
