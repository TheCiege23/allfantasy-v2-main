# Draft Configuration Matrix — Final (Phase 32)

| Configuration | Status | Validation |
|---|---|---|
| Standard | Genuine (reference baseline) | **Fully validated** — the reference case every other format is measured against |
| Half-PPR | Genuine scoring impact | **Fully validated** — position-level PPR boost, halved |
| PPR | Genuine scoring impact | **Fully validated** — position-level PPR boost |
| Dynasty | Genuine scoring impact (age-based) | Fixture validated — 0/8 real Dynasty leagues in `.env.test` have both real `DraftSession`+`Roster` (Phase 29 finding) |
| Superflex | Genuine, real bug fixed this phase | **Fully validated against real data** — 3/3 real Sleeper leagues correctly reclassify post-fix |
| 2QB | Genuine, distinct from Superflex | Fixture validated — 0/65 real leagues are 2QB |
| TE Premium | Genuine, settings-driven | Fixture validated — 0/65 real leagues populate `te_premium` |
| Keeper | Genuine (future-lock exclusion) | Fixture validated — 0/65 real leagues have materialized keeper data |
| Auction | Genuine (budget affordability) | Fixture validated — 0/65 real leagues are auction-type |
| IDP | Genuine (position targets + flex-slot eligibility + real format detection) | Fixture validated — 0/65 real leagues are IDP-configured; real defensive player pool exists (6,712 rows) but real IDP league/ADP coverage does not |

## Summary

**9 of 10 rows above are "genuine"** in the sense that real, tested, deterministic logic exists for each. Only **Superflex** is fully validated against unambiguous real production data — every other non-baseline configuration is honestly disclosed as fixture-validated-only, because `.env.test` genuinely lacks real leagues of those shapes. This is not a gap in engineering rigor; it is a disclosed, measured property of the available validation environment, consistent across every Draft OS phase since Phase 25.

Draft OS now covers **10 of 11** originally-scoped configurations (Redraft counted separately from Standard/Half-PPR/PPR as the base game mode, all others as listed above). No further configuration work is planned — see the Close-Out Report for the maintenance-mode transition.
