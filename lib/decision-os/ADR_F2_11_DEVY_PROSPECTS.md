# ADR-DOS-F2.11 — Canonical Enrichment: Devy / College Prospects

**Status:** **REJECTED (2026-08-27) — F2.4's deferral is upheld.** Not implemented.
**Decision:** devy stays out of Canonical World. See §7.
**Phase:** 2 (Canonical Enrichment), layer **F2.11** — additive. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata, F2.4 ADP / market values.

---

## 0. Why this ADR exists at all

F2.4 considered devy and **deferred it on the record**:

> `DevyAdp` — devy-only table; niche use case; deferred

That deferral was correct when written. This ADR asks to revisit it, and says plainly what changed
and what did not. If the answer is "still deferred", that is a legitimate outcome — the freeze exists
so that this is a decision rather than a drift.

**What changed since F2.4 (all 2026-08-27, verified in production):**

| Then | Now |
|---|---|
| Devy ingest had no scheduled writer | Roster + stat phases run from `/api/cron/import-players` |
| Four intel feeds had never once run | Scheduled, cadence-gated, one per tick |
| `draftProjectionScore` covered 812 / 1,718 | Same, but its INPUTS now refresh (usage, PPA, SP+, returning production, portal) |
| CFBD key exhausted (HTTP 429 on every call) | Tier 3, 75,000 calls/month |
| No ranked board consumed anywhere | `lib/devy/devyValueBoard.ts` + `devyTradeValue.ts` |

**What did NOT change:** devy is still a minority-coverage, single-provider dataset. That is the crux
of section 4.

---

## 1. Goal

Expose deterministic devy prospect context as a read-only derived enrichment layer:

- Prospect identity (name, position, school, class year, draft-eligible year)
- Board rank and devy points, **null when unranked**
- Scouting projection (`draftProjectionScore`) with its own coverage figure
- College production (season stat line) with the season it belongs to
- Intel context: usage, PPA, SP+, returning production, transfer-portal status
- Honest completeness / uncertainty / warnings throughout

---

## 2. Source audit (P2 — never fabricate)

| Table | Key | Coverage (prod, 2026-08-27) | Freshness | Notes |
|---|---|---|---|---|
| `DevyPlayer` | `[normalizedName, position, school]` | 1,718 rows | `lastSyncedAt`; roster phase per cron tick | Sole devy pool. Written by `lib/devy-classification.ts` |
| `DevyPlayer.draftProjectionScore` | — | **812 / 1,718 (47%)** | via `enrichDevyIntelMetrics`, 500/run | The signal the board ranks on |
| `DevyPlayer` stat columns | — | **481 / 1,718 (28%)** | `statSeason`, devyStats phase | 2025 season; 2026 has not been played |
| `DevyPlayer` intel columns | — | usage 84, PPA 84, SP+ 285, returning 285, transfer 285 *(test pool)* | devyIntelSources phase | Newly scheduled; production coverage not yet measured |
| `lib/devy/devyValueBoard.ts` | derived | ranks only projected players | pure, no storage | The ONLY sanctioned devy valuation |

### 2.1 Sources explicitly NOT used

- **`DevyPlayer.devyValue` — MUST NOT BE USED.** It is a position-and-class-year lookup with no
  player-specific input, and it is **0 for 1,237 of 1,718 rows**. Measured: a freshman QB with 23
  passing yards prices within 4% of a sophomore with 3,610. `devyValueBoard.ts` states in its own
  header that it exists to replace this field. Admitting it would violate **P2** directly — it is a
  fabricated value wearing the name of a real one.
- **`DevyAdp`** — still thin; carried only as an input to the board, never surfaced as a fact.
- **Anything AI-derived** (`AiPlayerMarketMetric` and similar) — **P3**: AI never generates
  deterministic facts.
- **`SportsPlayerRecord.projections` for NCAAF** — empty for devy players; would be a null-shaped
  promise.

---

## 3. Invariant compliance

| Invariant | How this layer satisfies it |
|---|---|
| **P1a Origin blindness** | CFBD appears only in `provenance`. No assembled fact names or branches on the provider. |
| **P1 Purpose blindness** | Canonical World carries FACTS (rank, projection, production). Whether a prospect is a *good trade target* is interpretation and belongs in a decision-specific World. |
| **P2 Enrichment-as-truth** | Unranked ⇒ `value: null`, never 0. Unscouted ⇒ `draftProjectionScore: null`. Coverage is emitted as a first-class field, not implied by list length. |
| **P3 AI governance** | No AI-derived input. The board is deterministic arithmetic over stored columns. |
| **Read-only** | Pure layer; no prisma writes. Reads via `port.ts` find*-only. |

---

## 4. The objection this ADR must answer honestly

**Devy is single-provider, minority-coverage, and on a different scale from NFL value.**

1. **Single provider.** CFBD is the sole NCAAF source. There is no second feed to corroborate against,
   so a CFBD outage or error has no fallback — unlike ADP (multi-provider consensus) or scores.
2. **Minority coverage.** The board ranks **47%** of the pool at best. Every consumer must handle
   "we cannot rank this player" as a first-class answer, not an edge case.
3. **Scale incompatibility.** Devy points are NOT NFL trade units. Mixing them silently is how a
   devy-for-NFL trade gets graded on incomparable numbers. If the trade slice ever consumes this,
   the scale boundary must be explicit and enforced, not conventional.

**Recommended scope if accepted:** enrichment layer **only** — expose the facts, and do **not** wire
them into the trade slice in the same ticket. The trade integration is where the scale problem bites
and deserves its own ADR with its own conformance proof.

---

## 5. What acceptance would commit us to

- A `devy` view in Canonical World, read-only, coverage-carrying.
- A conformance test in the F2 family asserting: null-not-zero for unranked, coverage present,
  provider absent from facts.
- **No** trade-slice consumption without a further ADR.

## 6. Recommendation

Accept **only** if devy prospect context is wanted in Decision OS reasoning soon. Otherwise the
honest answer is to keep F2.4's deferral standing and let the Chimmy provider
(`lib/chimmy-context/providers/DevyContextProvider.ts`, shipped 2026-08-27) serve the conversational
need — it delivers the same board with the same coverage honesty and sits outside the freeze.

Deferring again costs nothing that has not already been paid.

---

## 7. Decision (2026-08-27)

**Rejected. F2.4's deferral stands.**

Not because the data is bad — it is materially better than it was this morning: the ingest is
scheduled, the intel feeds run, the key has quota, and the board is honest about what it cannot rank.
Rejected because **nothing needs it here yet**, and the freeze is worth more than the option value of
having it early.

The reasoning, so this is not re-litigated from scratch:

1. **The need it would serve is already served.** `DevyContextProvider` gives Chimmy the same board
   with the same coverage figure and the same null-not-zero contract, and it sits outside the freeze.
   Admitting devy to Canonical World would duplicate that reach, not extend it.
2. **The objections in §4 are unchanged by anything shipped today.** Still one provider with no
   corroboration; still 47% coverage; still a points scale that is not NFL trade units.
3. **The cost of waiting is nearly zero.** Everything an implementation would need — the pool, the
   board, the coverage figure, the intel columns — is now maintained on a schedule. This ADR can be
   re-opened later against BETTER data than it was written on, which is the opposite of most deferrals.

**What would change the answer:** a Decision OS slice that genuinely needs prospect facts — most
likely a dynasty or devy-aware trade slice. At that point re-open this ADR rather than writing a new
one, and treat §4.3 (scale incompatibility) as the first problem to solve, not the last.

**What must NOT happen in the meantime:** devy facts reaching Decision OS by accident — a helper
import, a shared type, a convenience join. That is exactly the drift the freeze exists to prevent, and
it would land the integration without the conformance proof §5 asks for.
