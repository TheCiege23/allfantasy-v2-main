# Survivor Guillotine launch readiness

Verified on October 15, 2026. This is an operational checklist, not a claim that a real NFL or NBA scoring period has closed in production.

## Production checks

- The draft-pool readiness fix in PR #2376 reached a successful Railway production deployment. A later main deployment may be rolling out; verify its final status before inviting a league.
- Neon production has applied `20261013000000_survivor_guillotine_live`.
- The `allfantasy-cron` Railway service is online. Its recent logs include successful `/api/cron/waivers`, `/api/cron/import-scores`, and `/api/cron/live-score-tick` calls. Some draft-tick and import-scores calls timed out in the same window, so monitor that service during the first live scoring period.
- The older GitHub fast/slow cron workflows are disabled. Railway is the active scheduler; do not re-enable those workflows without checking for duplicate execution.

## Private pilot without friends

Use a disposable Neon branch and the scripts in `scripts/`; both refuse a production database. `smoke-survivor-guillotine-qa.ts` creates four temporary test accounts, a private 22-seat league, claims three invited seats, tests member/commissioner permissions, completes a one-round native draft, verifies hidden draft idols, and removes its data in `finally`. Set `SG_QA_COLD_POOL=1` to require an unseeded draft-pool rebuild from the configured data sources; omit it to use a deterministic player fixture. Set `SG_QA_SPORT=NFL` or `NBA` to cover each sport.

`smoke-survivor-guillotine-season-qa.ts` exercises the scheduled season, commissioner settings edits, scoring, chops, powers, and waivers with synthetic final scores. It is distinct from a real provider-backed game result. Run both sports on the disposable branch before a public invite wave.

On October 15, the cold-pool pilot passed for both NFL and NBA: each rebuilt an unseeded pool, created a private 22-seat league, claimed three invited seats, completed 22 native picks, and seeded three hidden player-bound idols. Both temporary leagues and their four test accounts were removed.

## Remaining live gate

Keep the first invite wave private until a real scoring period is finalized and the automatic or hosted chop, player release, and waiver claim complete under the production scheduler. Check the corrected-score audit after provider stat corrections. A commissioner must explicitly resolve earlier-period corrections that would change a played elimination, because later drafts and claims cannot be silently rewound.

Hosted Chop Night now persists a league-wide reveal stage and holds the next period until the host finishes. The chop transaction still executes when the commissioner starts the ceremony; manager roster and waiver state may show that result through other league screens before the final presentation stage. Treat the synchronized presentation as a reveal flow, not a secrecy boundary, until chop execution is deferred to the final stage.
