# League Configuration Coverage Matrix (Phase 31, supersedes Phase 30's table for the 3 configs touched)

| Configuration | Phase 30 classification | Phase 31 classification | What changed |
|---|---|---|---|
| **Redraft** | Genuine (baseline default) | Genuine (unchanged) | — |
| **Superflex** | Genuine, but detector never fired on real data (real bug, undetected until this phase) | **Genuine AND real-data validated** — corrected detector, confirmed against 3 real Sleeper leagues | Fixed a real bug this phase |
| **Dynasty** | Genuine scoring impact | Genuine (unchanged) | — |
| **PPR** | Genuine scoring impact | Genuine (unchanged) | — |
| **Half-PPR** | Genuine scoring impact | Genuine (unchanged) | — |
| **Standard** | Genuine baseline/reference | Genuine (unchanged) | — |
| **Keeper** | Genuine, fixture-validated only | Genuine (unchanged) | — |
| **Auction** | Genuine, fixture-validated only | Genuine (unchanged) | — |
| **2QB** | Conflated with Superflex (same `isSF` flag) | **Genuine, distinct scoring impact** — fixture-validated only (0 real 2QB leagues exist) | Implemented this phase |
| **TE Premium** | Misnomer — roster-slot presence, not scoring rule | **Genuine scoring impact** — real settings-based, fixture-validated only (0 real leagues populate the setting) | Implemented this phase |
| **IDP** | Unsupported | **Unchanged this phase** — still unsupported | Not touched, explicitly out of scope |

## Summary

Of 11 configurations, genuine scoring impact now exists for **9** (Redraft, Superflex, Dynasty, PPR, Half-PPR/Standard, Keeper, Auction, 2QB, TE Premium), up from 7 before this phase. This meets the phase's stated success criterion of Draft OS reaching 9/11 supported configurations. Only **IDP** remains unsupported.

Note: 2QB and TE Premium, like Keeper and Auction before them, could not be end-to-end validated against real `.env.test` data (0 real 2QB leagues, 0 real TE Premium settings) — see `FANTASY_OS_DRAFT_LEAGUE_SETTINGS_VALIDATION_REPORT_PHASE31.md` for the honest disclosure. Superflex, uniquely among this phase's changes, **is** real-data validated — a genuine bug fix confirmed against 3 real leagues, not just a new feature.
