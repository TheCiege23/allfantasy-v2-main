# League Configuration Coverage Matrix (Phase 30, supersedes Phase 29's table for the 2 configs touched)

| Configuration | Phase 29 classification | Phase 30 classification | What changed |
|---|---|---|---|
| **Redraft** | Genuine (baseline default) | Genuine (unchanged) | — |
| **Superflex** | Genuine (`isSF` → `formatBoost +14`) | Genuine (unchanged) | — |
| **Dynasty** | Genuine scoring impact (age-based) | Genuine (unchanged) | — |
| **PPR** | Genuine scoring impact | Genuine (unchanged) | — |
| **Half-PPR** | Genuine scoring impact | Genuine (unchanged) | — |
| **Standard** | Genuine baseline/reference | Genuine (unchanged) | — |
| **Keeper** | Unsupported — no distinct flag | **Genuine scoring impact** — future keeper locks excluded from `available` | Implemented this phase |
| **Auction** | Unsupported in the recommendation formula | **Genuine scoring impact** — real budget-affordability adjustment | Implemented this phase |
| **2QB** | Conflated with Superflex (same `isSF` flag) | **Unchanged this phase** — still conflated, explicitly out of scope | Not touched |
| **TE Premium** | Misnomer — checks for TE roster slot, not TE scoring rule | **Unchanged this phase** — still a misnomer | Not touched, explicitly out of scope |
| **IDP** | Unsupported | **Unchanged this phase** — still unsupported | Not touched, explicitly out of scope |

## Summary

Of 11 configurations, genuine scoring impact now exists for **7** (Redraft, Superflex, Dynasty, PPR, Half-PPR/Standard, Keeper, Auction), up from 5 before this phase. This meets the phase's stated success criterion of Draft OS reaching 7/11 supported configurations. The remaining 4 (2QB, TE Premium, IDP — plus Half-PPR/Standard counted as one reference pair) are unchanged, explicitly deferred: 2QB, TE Premium, and IDP per this phase's own scope boundary.

Note: both Keeper and Auction support could not be end-to-end validated against real `.env.test` data (0 real keeper-materialized sessions, 0 real auction sessions) — see `FANTASY_OS_DRAFT_KEEPER_INTELLIGENCE_REPORT_PHASE30.md` and `FANTASY_OS_DRAFT_AUCTION_INTELLIGENCE_REPORT_PHASE30.md` for the honest disclosure. Coverage classification reflects correct, tested logic, not live-validated production behavior.
