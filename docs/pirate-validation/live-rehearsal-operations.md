# Isolated Pirate live rehearsal

This is a temporary QA run against real NFL games and provider player records, with four synthetic managers at `example.invalid`. The manifest in `live-matchup-staging.json` records the exact fixture. The user’s PVT league is outside its scope. Completion of setup does not certify a finished real scoring period.

## Runtime

Project: `80e84d3b-778a-4fe6-be53-6c16068e8aa2` (AllFantasy Pirate Staging). Environment: `686eb5e0-af93-4370-806a-af544049ea93` (staging).

| Worker | Service | UTC schedule | Work |
| --- | --- | --- | --- |
| Capture | `cd151764-2c64-4684-bf33-c63387bda372` | Every five minutes | Immutable snapshots around real locks |
| Data | `8527fa60-4d22-45c2-af28-90663e18eebe` | Every fifteen minutes | Four-sport injury coverage, NBA/MLB/NHL schedules when twelve hours old, NFL scoreboard |
| Score | `4923ec7b-87c4-4d80-a7db-00c7c8bd9fb1` | Every five minutes, offset two minutes | Fixture-only weekly player stats, reconciliation, canonical finalizer, Pirate claim seeding/maintenance |

Deploy `scripts/railway-pirate-rehearsal.ts` as the exact source for all three Bun Functions. Set `PIRATE_REHEARSAL_TASK` to the corresponding task. Each function receives `CRON_SECRET` through the same-project `${{pirate-web.CRON_SECRET}}` reference. Do not export secrets through tool output. Workers exit after each run; Railway owns cadence and skips overlapping invocations. Capture is independent of slow ingestion/scoring.

Both web and workers require the reviewed staging project/environment, explicit enablement and **`PIRATE_REHEARSAL_UNTIL=2026-11-07T12:00:00Z`**. The web additionally validates the separate staging DB, exact configured league ID, fixture tenant/tag and every roster's synthetic owner. Requests cannot select a different league. The endpoint is disabled by default everywhere else. Its scoring pass uses the fixture's recorded week, preserving sealed results and actual finalization grace/coverage gates.

The web service has sleeping disabled for this temporary run to reduce cold-start risk around the seven-minute snapshot window. After validation, disable the three cron schedules and restore sleeping; expiry stops provider work but does not delete the worker services or stop scheduled bootups.

## Quiet ingestion and observation

- Data-only cron requests use `notifications=0`; regular production callers retain their existing notification behavior. The rehearsal finalizer injects no-op result, prediction and integrity dispatchers. Only synthetic fixture accounts can receive queued Pirate events; this infrastructure does not run an outbox relay.
- Injury jobs must return `ok:true` and `lineupCoverageCertified:true`. A 200 without certified coverage fails the worker. Every sport is awaited and inspected. Unknown relevant player designations still preserve locks for review.
- Schedules retain the canonical provider cache and refresh at most every twelve hours while fresh. NFL uses the existing scoreboard importer. Do not substitute season aggregate stat lines for weekly player stats.
- Runtime logs contain only task/sport names, status and counts. Check `SyncJobRun` rows named `cron-pirate-rehearsal-capture`, `cron-pirate-rehearsal-score` and `cron-pirate-rehearsal-schedules` for successful execution; inspect recent `injuries-cron` V2 markers for all four sports.
- Five-minute cadence is not proof of capture: inspect actual before/after immutable evidence at each game lock. A provider or execution gap retains protections for review. Do not backdate missing snapshots.

## Pending real-period acceptance

1. Confirm first and subsequent unattended runs, recent provider attestations and zero unexpected recipients.
2. At the manifest's actual locks, confirm before/after evidence and deduplication. Legal-lineup controls must keep protections. The empty-QB case may forfeit only after a final loss and proven available complete lineup at the relevant locks.
3. After all actual games finish and canonical finalization grace elapses, inspect real weekly stats, final matchups and seeded claims. Never insert synthetic scores or final statuses into this fixture.
4. QA managers do not choose a claim by themselves. After real results, explicitly exercise winner selection and the actual 24-hour response/transfer deadline using the canonical claim APIs. Synthetic deadline tests are already separate evidence.
5. Record the result, disable the temporary workers, restore staging sleeping and remove only the fixture league, tenant and four owned QA accounts. Retain real provider rows and the manifest. Physical Android QA and production sign-off remain separate gates.
