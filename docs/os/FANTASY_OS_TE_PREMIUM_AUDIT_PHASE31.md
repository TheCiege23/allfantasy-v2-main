# TE Premium Audit (Phase 31)

## Fresh audit finding: the pre-existing "TE Premium" handling was a misnomer

`RecommendationEngine.ts`'s scoring loop previously contained:

```ts
if (normalizedSport === 'NFL' && pos === 'TE' && (rosterSlots.includes('TE') || rosterSlots.some((s) => s?.includes('TE')))) formatBoost += 4
```

This fires whenever a league merely *has a TE roster slot* — true for nearly every real NFL league regardless of its actual scoring rules. It is a roster-slot-presence approximation, not a genuine TE Premium scoring signal, confirming Phase 29's own prior classification of this as a "misnomer."

## Real settings field exists in the codebase, but is unpopulated in real data

`lib/agents/anthropic-pipeline.ts`'s `buildLeagueScoringSettings()` already reads a real `te_premium`/`tePremium` field from league settings (`readNumber(settings, ['te_premium', 'tePremium'])`) for AI chat context — confirming the field name pattern is real and already in production use elsewhere, not invented for this phase.

A direct query against all 65 real leagues in `.env.test`:

| Check | Real leagues matching |
|---|---|
| `settings.te_premium` or `settings.tePremium` present (any value) | **0 / 65** |

**Zero real leagues in this environment populate a TE Premium scoring setting.** This matches the Keeper/Auction disclosure pattern from Phase 30 — real, correctly-implemented logic with no real data to exercise it against.

## Fix implemented

- Removed the roster-slot-presence approximation entirely (per this phase's explicit guardrail: "Replace the current roster-slot approximation").
- `resolveTePremiumValue(settingsJson)` (new, in `DraftContextAssembler.ts`) reads the real `settings.te_premium`/`settings.tePremium` field, mirroring the exact pattern already used for `settings.ppr`/`settings.points_per_reception` (Phase 29).
- `tePremiumAdjustment(position, tePremiumValue)` (new, in `RecommendationEngine.ts`) applies a bounded boost (`clamp(tePremiumValue * 8, 0, 20)`) only to TE players, only when a real positive value is present.

## Honest disclosure and a real, measured behavior change

Because 0/65 real leagues populate `te_premium`, and the old roster-slot approximation fired an always-on `+4` for essentially every real NFL league's TE recommendations, **this fix is a net real behavior change for every current real league**: TE players in leagues without a real TE Premium setting will score `~4 points` lower (out of the removed always-on boost) than they did before this phase, since that boost was never a genuine signal to begin with. This is the correct, intended outcome per the explicit "replace, don't add alongside" guardrail — logged here for transparency, not silently absorbed.
