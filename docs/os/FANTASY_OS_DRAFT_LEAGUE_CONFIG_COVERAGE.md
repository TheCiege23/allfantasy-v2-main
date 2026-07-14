# Draft OS — League Configuration Coverage (Phase 25)

**Status: verified directly from `lib/draft-helper/RecommendationEngine.ts` source. No configuration support was assumed — every row below is either a confirmed present code path or a confirmed absence (grep returned zero matches).**

| Configuration | Support | Evidence |
|---|---|---|
| **Redraft** | Supported (default/baseline) | The engine's baseline behavior with `isDynasty: false` — no special-casing needed, it's the unmarked default. |
| **Dynasty** | **Cosmetic only, not scoring** | `isDynasty` flag exists and is threaded through, but its only real effect found is adding an explanation sentence ("Dynasty context favors multi-year value...", `RecommendationEngine.ts:150-152`) — **it does not change `needScore`, `adpEdge`, or `formatBoost` numerically.** Real gap: dynasty and redraft drafts receive functionally identical rankings today. |
| **Keeper** | **Not supported — no distinct flag exists** | Grep for "keeper" across `RecommendationEngine.ts` and `DraftContextAssembler.ts`: zero matches. Keeper leagues are not distinguished from dynasty or redraft in the recommendation engine at all (keeper-specific draft-room mechanics do exist in `lib/live-draft-engine/keeper/`, but that's the live pick-submission flow, not the recommendation formula). |
| **Superflex** | Supported | `isSF` flag, `+14` `formatBoost` for QB when true (`RecommendationEngine.ts:345`), plus a `+18` need boost (`:247`) and an explanation note (`:141-143`). |
| **2QB** | **Conflated with Superflex, not distinguished** | `isSF` is derived from `starterSlots.QB >= 2` (`DraftContextAssembler.ts` `resolveLeagueScoringFlags`) — true 2QB (mandatory 2 starting QBs) and Superflex (QB-eligible flex slot) are real, different league mechanics that this engine treats identically. Not necessarily wrong in practice (both increase QB scarcity similarly) but not a distinct, verified-correct handling either. |
| **TE Premium** | **Misnomer — not a scoring-setting check at all** | The `+4` "TE" `formatBoost` (`RecommendationEngine.ts:346`) fires whenever the roster template includes *any* TE slot — it does **not** read the league's actual scoring settings for extra per-reception TE points. A league with genuine TE Premium scoring (e.g., 1.5x PPR for TEs) gets no different treatment than one without it, as long as both have a TE roster slot. Confirmed by grep: zero matches for "scoring"/"PPR"/"tePremium" anywhere in `RecommendationEngine.ts`. |
| **IDP** (individual defensive players) | **Not supported** | Zero matches for "IDP" in `RecommendationEngine.ts`. No defensive-position-specific scoring or need logic found. |
| **Auction** | **Not supported in the recommendation formula** | `DraftSession.draftType` field does record `'auction'` as a real value (confirmed via schema/session data), but `RecommendationEngine.ts` has no bid-value-vs-pick-order logic, no budget-awareness, no auction-specific scoring path — the same pick-order-based formula runs regardless of draft type. |
| **PPR / Half-PPR / Standard** | **Not supported — scoring format is never read** | Zero matches for "scoring"/"PPR"/"halfPpr" anywhere in `RecommendationEngine.ts`. Recommendations do not vary by scoring format at all — a full-PPR-relevant pass-catching RB and a standard-scoring between-the-tackles RB receive identical treatment. |

## Summary

Of the 11 configurations named in this phase's brief, genuine, verified, distinct handling exists for exactly **2** (Redraft as baseline, Superflex). **9 are unsupported or only nominally/cosmetically supported**: Dynasty (text-only), Keeper (absent), 2QB (conflated with Superflex), TE Premium (misnamed roster-slot check, not a scoring-setting check), IDP (absent), Auction (absent), PPR/Half-PPR/Standard (absent — scoring format isn't read at all).

This is a materially larger coverage gap than the engine's own documentation or naming suggested going into this audit, and is the single most significant finding shaping the migration-readiness classification.
