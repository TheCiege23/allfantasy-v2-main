# T9 — Official AllFantasy Market Value Layer (conservative, reversible)

Audit-first. The first **AllFantasy-owned** market value, computed from internal trade signals, stored
**separately**, conservative, auditable, reversible, and **display-only by default**. Do NOT merge
until reviewed.

**Explicitly: no AI/LLM, no provider write syncs, no external calls, no destructive updates to
`SportsPlayer`/`FantasyProjection`/ADP/T2 snapshots, no auto-trading/auto-veto. Trade grading is NOT
changed by this PR.**

## Precondition (Phase 0) — met
Main at T8 merge `807b9cc7`; T8 production-smoked 6/6 (block add/list/privacy, non-owner delete 403,
interest add, discovery `INTEREST_MATCH`+`PRIVATE_INTEREST_USED`, `TRADE_BLOCK_UNAVAILABLE` dropped,
owner remove; no value mutation). Branched fresh.

---

## PHASE 1 — Audit findings

1. **Safe-enough signals to affect official value:** completed trades (`trade_processed` /
   `proposal_accepted` w/ settlement) are the **strong** price signal; public trade-block items +
   repeated accepted appearances are **medium**.
2. **Weak/context-only:** `proposal_rejected`/`canceled`/`expired`, **private** interest (aggregate
   pressure only — never a public price by itself), `proposal_created`/`value_snapshot_created`/
   `league_vote_cast`. Negative: `commissioner_vetoed`/`proposal_vetoed`.
3. **Minimum sample:** `< 5` distinct deduped proposals ⇒ **do not publish** an adjustment.
4. **Confidence:** `< 60` ⇒ **do not publish** an adjustment.
5. **Anti-circularity:** `baseValue` = median observed **T2 snapshot internalValue** (derived from
   projection × scarcity + ADP) — **never** the AllFantasy market value. AF value is an output only,
   never an input to itself.
6. **Separate storage:** new `AllFantasyMarketPlayerValue` + `AllFantasyMarketValueAudit` tables only.
   `SportsPlayer`/`FantasyProjection`/ADP/T2 snapshots are never written.
7. **Visible now:** commissioner/owner-gated read endpoints + a commissioner-only panel (display-only).
8. **Not wired yet:** trade grading, the normalized value resolver default, and any all-manager
   exposure stay **default-off** (documented).
9. **Admin recalculation endpoint:** deferred. Existing `/api/admin/*` auth is not uniformly verified
   here, so T9 ships the **calc service + a dry-run-default script** (the established script pattern)
   and **no** user/admin write endpoint. Recalc as a scheduled/admin job is future work.

---

## PHASE 2 — Schema (additive)
`AllFantasyMarketPlayerValue` (sport, leagueConcept, scoringFormat?, playerId, …, baseValue,
marketValue, adjustmentPercent, adjustmentPoints, confidence, sampleSize, accepted/rejected/vetoed/
block/interest/recent counts, direction, sourceVersion, calculationVersion, reasons Json, generatedAt)
with `@@unique([sport, leagueConcept, playerId])`. `AllFantasyMarketValueAudit` (append-only history of
every change). Indexes per spec. No FK. Additive idempotent migration applied via `db execute` +
`migrate resolve` (live Neon drift; not `migrate dev`).

## PHASE 3 — Calculation service (`lib/trade-market/allFantasyMarketValues.ts`)
Pure core `computeOfficialMarketValue({ baseValue, observations, blockSignalCount, interestSignalCount,
managerKeys })`:
- **Strict gates:** sample `<5` → unpublished; `5–14` cap **±3%**; `15–49` cap **±7%**; `50+` cap
  **±12%**; confidence `<60` → unpublished; **hard ±12%** ceiling.
- **Veto/rejection drag reduces confidence more than price.**
- **Anti-manipulation:** dedupe by `tradeProposalId`; cap per-`(proposerRoster,receiverRoster)` and
  per-manager repeated influence; downweight vetoed/rejected; one trade can't move a player materially.
- **Direction:** rising/falling/stable/insufficient. `calculationVersion` stamped.
DB layer gathers signals (T3 proposals+snapshots across the sport/concept, T8 block/interest counts),
upserts the AF value row, and writes an audit row **only on change**.

## PHASE 4 — Resolver
`resolveAllFantasyMarketValue(playerId, ctx)` → `{ baseValue, allFantasyMarketValue|null,
adjustmentPercent, confidence, sampleSize, direction, reasons, source:'allfantasy_market', generatedAt }`.
Returns `null`/unpublished when no row or insufficient. **Never computes/mutates on a user GET.**

## PHASE 5 — Read endpoint (commissioner-gated)
A single `GET /api/redraft/trades/market-values?leagueId=` route serves both the published list and
the single-player lookup via an optional `&playerId=` param (read-only resolver, never mutates). The
single-player lookup was consolidated onto this route — the former `…/market-values/[playerId]` route
was removed — to conserve the Vercel route budget (the 2048-route cap). No PII.
Admin recalc endpoint **deferred** (see audit #9).

## PHASE 6 — Controlled calculation path
`scripts/recalculate-allfantasy-market-values.ts` — **dry-run by default**, `--write` required to
persist; writes only the two AF tables + audit; logs a summary; no provider writes/env/external calls.

## PHASE 7–8 — UI + wiring
Commissioner-only panel (base/market/adjustment/confidence/sample/direction/reasons + the disclaimer
"AllFantasy market value is separate from provider, ADP, projection, and historical snapshot values";
insufficient → "Not enough verified AllFantasy market history…"). **Grading unchanged**; resolver
wiring into the value engine is **documented default-off**, not enabled.

## Privacy
Internal ids only; commissioner-gated; no emails/tokens/sessions.

## Future (T10/T11/T12 — NOT this PR)
T10 Chimmy trade intelligence, T11 automated negotiation, T12 provider-market integrations.
**T9 is conservative + reversible (audit table, AF-tables-only writes) and changes no provider data or
grading.**
