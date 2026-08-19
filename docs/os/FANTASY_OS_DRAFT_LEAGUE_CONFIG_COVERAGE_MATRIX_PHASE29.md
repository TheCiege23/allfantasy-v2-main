# League Configuration Coverage Matrix (Phase 29, supersedes Phase 25's table for the 2 configs touched)

| Configuration | Phase 25 classification | Phase 29 classification | What changed |
|---|---|---|---|
| **Redraft** | Genuine (baseline default) | Genuine (unchanged) | — |
| **Superflex** | Genuine (`isSF` → `formatBoost +14`, need boost) | Genuine (unchanged) | — |
| **Dynasty** | **Explanation-only** — zero scoring effect | **Genuine scoring impact** — real age-based adjustment (+8 young, 0 neutral, down to −16 aging), only when `isDynasty: true` | Implemented this phase |
| **PPR** | Ignored — no scoring format ever read | **Genuine scoring impact** — position-level `formatBoost` (WR/TE +3, RB +1.5) | Implemented this phase |
| **Half-PPR** | Ignored | **Genuine scoring impact** — half the PPR position boost | Implemented this phase |
| **Standard** | Ignored (same as PPR — no differentiation existed) | **Genuine baseline** — zero boost, the reference point the other two formats are measured against | Implemented this phase (as the default/reference case) |
| **2QB** | Conflated with Superflex (same `isSF` flag) | **Unchanged this phase** — still conflated, explicitly out of scope | Not touched |
| **TE Premium** | Misnomer — checks for TE roster slot, not TE scoring rule | **Unchanged this phase** — still a misnomer | Not touched, explicitly out of scope |
| **Keeper** | Unsupported — no distinct flag | **Unchanged this phase** — still unsupported | Not touched, explicitly out of scope |
| **IDP** | Unsupported | **Unchanged this phase** — still unsupported | Not touched, explicitly out of scope |
| **Auction** | Unsupported in the recommendation formula | **Unchanged this phase** — still unsupported | Not touched, explicitly out of scope |

## Summary

Of 11 configurations, genuine scoring impact now exists for **5** (Redraft, Superflex, Dynasty, PPR, Half-PPR/Standard as the reference), up from 2 before this phase. The remaining 6 (2QB, TE Premium, Keeper, IDP, Auction) are unchanged, explicitly deferred per this phase's own scope boundary ("Do not add Keeper, IDP, Auction, or TE Premium support in this phase").
