# Team workspace: five follow-ups

This release adds the five requested follow-ups to the Team / Live workspace.

1. Responsive polish: compact long team names and summary tiles on phones, give desktop decision explanations more space, and keep action buttons and commissioner controls touch accessible.
2. League-specific alerts: show confirmed injury evidence, its freshness, recorded deadlines in the device timezone and eligible alternatives. Links preserve the league. Notifications reuse channel preferences, league overrides and quiet hours; delivery is evaluated, not claimed as guaranteed.
3. Cloud weekly plans: private account/league/roster/season/week scopes with optimistic versions, deletion tombstones and explicit device-local imports. Stale saves keep edits and require a reload. Plans never submit a lineup.
4. Native AutoSubs: explicit commissioner enablement plus weekly owner-assigned backups. Execution requires trusted status evidence under 30 minutes old, a definite inactive starter, an available eligible bench player, known individual game times and existing league locks. Missing evidence holds the action. The roster compare-and-swap, consumed assignment and audit receipt commit together; a refreshed read verifies success.
5. Commissioner action queue: actual saved lineup gaps, accepted trades awaiting commissioner review, recorded scoring failures and published deadlines. Status writes preserve existing head commissioner permissions, reject stale updates and write an audit. Stale/unreadable roster evidence preserves previous lineup findings.

The new plan and alert readers use saved rosters, and imported alert evaluations hold when roster sync evidence is absent, future-dated or over 30 minutes old. The existing live lineup screen keeps its provider verification requirement.

No migration or provider write integration is introduced. Preferences use atomic single-key JSONB merges in the existing user profile; tasks and receipts use existing deployed tables. Scheduled phases use the existing alert sweep with bounded admission. Website main and worker-release must both carry the change for the scheduled execution to run.

## Verification

- 114 affected tests across 13 suites, including cloud-plan concurrent saves and tombstones against isolated local PostgreSQL, real native execution and rollback on changed ownership, membership/eligibility checks and Spanish UI behavior.
- TypeScript ratchet: 139 existing errors versus baseline 143; zero new per-file errors and zero redraft-scoped errors.
- Authenticated local Next.js app with synthetic users and a strictly loopback-only database. Chromium desktop/Android and WebKit iOS/tablet emulation; shared plans, page overflow and uncaught errors checked. Physical devices, installed PWAs and production-authenticated accounts remain separate verification.
- Native automation is off by default. QA does not authorize or mutate any production roster and sends no real notification transports.

## Product constraints and research

Sleeper's public API is read-only: https://docs.sleeper.com/. Its documented AutoSubs rules informed the backup assignment and game-lock workflow: https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work. Imported provider lineups retain their provider destination; this executor mutates only native AllFantasy rosters.

## Useful next work

Physical-device and production account acceptance; notification transport receipts and alert engagement metrics; native AutoSubs dry-run explanations and paused-assignment indicators; organization-level commissioner queues after tenant permissions are designed; release pipeline timing and cache improvements that retain all required gates.
