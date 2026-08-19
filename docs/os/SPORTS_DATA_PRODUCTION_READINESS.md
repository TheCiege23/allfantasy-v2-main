# Sports Data — Production Readiness Audit (Phase 5G)

## Runtime certification
- **Runtime ports:** all product consumption flows through gateway runtime modules (`store`, `scheduleRuntime`, `statisticsRuntime`, `certifiedReads`, etc.) — never a provider client. ✅
- **Provider isolation:** provider access lives only in gateway adapters/fetchers (`providers/espn.ts`, `providers/sleeper.ts`, `providers/fantasycalc.ts`) and `lib/espn-data.ts` (legacy adapter). Every wired product route and integration service is import-guard tested to contain no `sleeper-client`/`espn-client`/provider URL/bare `fetch(`. ✅
- **Feature gates:** 9 gates (`lineup/waiver/trade/draft/matchup/scoring/intelligence/coach/observability`), all **disabled by default**, server-only, not customer-overridable (no query/body/header bypass). Each subsystem is independently reversible. ✅
- **Import guards:** enforced by tests across lineup/waiver/trade/draft/matchup/scoring/intelligence/statistics/identity/observability. ✅

## Identity certification
- **Canonical identities:** deterministic only. Direct provider-id matches → `resolved`; name matches → `ambiguous` (no canonical id); else `unresolved`. No fuzzy/LLM matching. ✅
- **Deterministic mapping:** Sleeper + FantasyCalc dual-id crosswalks; cross-source conflicts quarantined; idempotent, conflict-safe upsert (never overwrites a different espn id). ✅
- **Append-only snapshots:** identity re-resolution produces a new certified statistics snapshot only when identity content changes; prior snapshots preserved. ✅

## Statistics certification
- **Certification:** ESPN box scores → schema validation → identity classification → content-hash dedup → `canCertify` → append-only persist. Rejected/uncertifiable drafts never persist. ✅
- **Runtime retrieval:** `getCertifiedPlayerStats` returns canonical stats + identity state (proven: 79 rows, 62 resolved). ✅
- **Correction replay:** re-running a sync with changed stats produces a new snapshot (content-hash `changed`); the previous is retained; unchanged reruns fully suppressed. ✅
- **Snapshot preservation:** latest statistics snapshot retrievable (`nfl-stats-2024-w1-…`, 79 records); prior snapshots not mutated. ✅

## Product-runtime authority preservation (all wired subsystems)
| Subsystem | Deterministic authority preserved | Certified-layer role |
|---|---|---|
| Lineup | `persistRosterLineupWithEngine({skipLockCheck:false})`, roster legality | reject-only (fail-open manual) |
| Waiver | `createClaim`, `assertWaiverClaimEligibility`, roster legality | reject-only (fail-open manual) |
| Trade | valuation, legality, ownership, deadline, cap, `createAfLeagueTrade`/`accept`/`finalize` | reject-only (never invents — policy declared-not-enforced) |
| Draft | current pick, ownership, clock, pool, idempotency (`submitPick`) | evidence-only (never blocks) |
| Matchup | `MatchupStateNormalizer` state, winners, playoff | additive input fact (never changes state) |
| Scoring | `updateMatchupScores` finalization, `PlayerWeeklyScore` inputs | stricter-only finalization (never causes, never changes scores) |
| Intelligence/Coach/Chimmy | reasoning/recommendation engines | informational grounding only |

## Production readiness checklist
- Provider boundaries ✅ · Feature gates ✅ · Rollback (per-gate) ✅ · Observability (admin route) ✅ · Structured logging (`console.info` decision evidence, redacted) ✅ · Append-only guarantees ✅ · Idempotency (identity population + draft picks) ✅ · Transaction safety (engine persist unchanged) ✅ · Audit evidence (`sportsDataDecision` emitted) ✅ · Build reproducibility (`✓ Compiled successfully`, Windows post-compile EISDIR only) ✅ · Compile graph (all wired routes enter it) ✅.

## Performance summary (non-prod Neon, over network)
| operation | latency |
|---|---|
| certified schedule retrieval (first/cold) | 6,908 ms (cold pg pool + Neon SSL connect) |
| certified statistics retrieval (79 rows, warm) | 129 ms |
| deterministic identity batch (65 ids, warm) | 318 ms |
| identity coverage counts (warm) | 397 ms |

**Bottleneck:** the only outlier is the **first** query's cold connection (pg pool + Neon SSL handshake from Windows) — a connection-pool concern, not a query concern. Warm reads are 129–397 ms against remote non-prod Neon; in-region production latency will be materially lower. No premature optimization recommended.

## Safety summary
- **Fail-closed:** automatic/unattended actions (auto-sub). ✅
- **Fail-open:** human-confirmed manual saves/claims (existing authority final on stale certified data). ✅
- **Reject-only:** lineup/waiver/trade guards can only add a rejection, never approve. ✅
- **Informational-only:** matchup/intelligence/coach/chimmy/draft-read — never mutate. ✅
- **Provider isolation & credential isolation:** no provider client in product runtime; observability exposes counts/provenance only (no env-var names, connection strings, or raw payloads). ✅
- **No raw payload exposure:** canonical contracts carry normalized fields only; decision evidence is field-restricted. ✅

## Factual domains + scoring boundary (Phase 5H-f — NON-PROD only)
7 factual-domain tables created + proven in non-prod (injuries PROVIDER-VERIFIED; availability/depth/projection fixture-only; correction lineage + history). All default-off gated, effective-dated, non-destructive. **Production scoring authority UNCHANGED** — certified facts never become scoring inputs (test-locked). Not production-ready; production persistence is a separate authorization.

## Canonical persistence (Phase 5H-e — NON-PROD only)
5 canonical domains created + proven in the approved non-production plane behind default-off gates (`FANTASY_OS_CANONICAL_*_ENABLED`), guarded by a fail-closed `nonprodSafetyGuard` (refuses any non-approved project). Additive, versioned, idempotent, reversible (is_active/deactivate), tenant/privacy-tagged. **NOT production-ready** — production migration is a separate authorization; legacy paths remain authoritative and default-on; no consumer switched on. Shadow comparison is the parity-planning tool for a later, evidence-gated consumer migration.

## Provider observability (Phase 5H-d)
`lib/sports-data-gateway/providers/certificationStatus.ts` is the operator-safe backend contract for provider status: per-provider `{status, credentialPresent (boolean — never a secret), lastVerifiedAt, sportsVerified, capabilitiesVerified, canonicalRoute, persistence, blockedReason}` + `summarizeProviderCertification()` / `isProviderConnectable()`. It gates "connected" claims on real-request evidence (test-locked). Live 5H-d status: CERTIFIED ×3 (ESPN/Sleeper/FantasyCalc), VERIFIED ×3 (TheSportsDB/CFBD/API-Sports), BLOCKED ×1 (ClearSports), REQUIRES_WIRING ×1 (Rolling Insights). No dashboard UI was built — backend contract + tests only.
