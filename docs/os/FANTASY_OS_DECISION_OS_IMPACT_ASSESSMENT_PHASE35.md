# Decision OS Impact Assessment (Phase 35, Track A)

## Subsystems affected by the missing tables (before this phase's fix)

| Subsystem | Effect | Truthful handling? |
|---|---|---|
| `lib/decision-os/behavioral/api/real-data-provider.ts` (`decision_os_imported_activity`) | Real Prisma runtime errors on every query, caught and degraded to `[]` | Yes — non-fatal, no crash, but silent (no user-facing signal that data was unavailable) |
| `lib/decision-os/snapshot/prismaBehavioralSnapshotStore.ts` (`decision_os_behavioral_snapshot`) | Same pattern — real errors, caught, degraded to `[]` | Yes, same caveat |
| `lib/decision-os/leagueContext.ts` (`decision_os_league_context`) | Same pattern — real errors, caught, degraded to `null` | Yes, same caveat |
| Mission Control / League Analytics (`lib/decision-os/missionControl.ts`, `leagueAnalytics.ts`) | Downstream of the above — ran in a degraded mode for any league whose health computation touched these code paths | Yes — confirmed via Phase 34's real execution that `evaluateCommissionerShadow()` still returned usable, non-crashing output despite the errors |
| Commissioner shadow module (`lib/shared-services/commissioner/`) | Same downstream degradation; zero real callers anyway (Phase 34 finding) | N/A — no real user exposure |
| `/commissioner-hub`, `app/commissioner-os/*` | **Real, live, user-facing** — both call `lib/decision-os/missionControl`/`leagueAnalytics` directly. Any real user visiting these real routes was receiving degraded Mission Control/League Analytics output for the entire period these tables were missing | **This is the real production-risk finding**: two genuinely live, user-facing product surfaces were silently running in a degraded mode |
| Manager OS (`lib/decision-os/userOs.ts`, `managerCommandCenter.ts`) | Not confirmed to directly query these 3 tables (not read in this phase's Manager OS audit) — flagged as unconfirmed, not asserted | Unconfirmed |

## Measured

- **Degraded features**: Mission Control's behavioral-activity and league-financial-context enrichment layers, for every real league, in every real execution that touched them, for the duration this gap existed.
- **Fallback behavior**: correct and non-fatal in every case observed — no crash was found anywhere in this investigation.
- **Silent failures**: yes, in the sense that the degradation was invisible to end users — no UI-level "some data is unavailable" signal was traced back to this specific cause (out of scope to trace exhaustively this phase, but no such signal was noticed during Phase 33/34's real executions).
- **Truthful handling**: partial — the code never crashed or fabricated data, which is the more important truthfulness property, but it also didn't surface the degradation to end users in a way that would have let them know Mission Control's output was incomplete.
- **Production risk**: real, but bounded. The two live surfaces affected (`/commissioner-hub`, `/commissioner-os/*`) are both real and user-facing, but per Phase 34's Commissioner audit, the Mission Control/League Analytics computations that ran on top of the missing tables never crashed, and the module's own real leagueHealth categorization still resolved (`healthy`, confirmed real). The practical blast radius was reduced coverage/completeness of behavioral/financial-context enrichment, not broken pages or incorrect confident claims.

## Post-fix state

All three tables now exist in `.env.test`, empty (0 rows, honest — no fabricated backfill). The error-catching code paths are no longer triggered; queries now return genuinely empty results directly rather than caught exceptions. This removes the *error noise* but does not yet populate real behavioral/financial-context data — that is a separate, future data-population effort, not a schema problem, and is out of this phase's scope.
