# Redraft Commissioner Scoring Contract — Team Defense (G8) & Return Yardage (G9)

This doc exists to close a dangling reference: `lib/sportConfig/configs/nfl.ts` cites gaps
**G8** and **G9** here. It didn't exist yet — this is the first version, written directly from
the shipped code (`lib/sportConfig/{configs/nfl.ts,types.ts}`,
`lib/scoring-runtime/canonicalNflRedraftScoringRuntime.ts`, `lib/e2e/seedG8League.ts`), not
invented. Follows this repo's `docs/redraft/G<N>_*` gap-tracking convention in content, kept at
the path the code already references.

## Background — a runtime capability that outran its type

`canonicalNflRedraftScoringRuntime.ts`'s `categoryPoints()` already implements **tier-based
scoring** — award a category's points when a raw stat value falls in `[tierMin, tierMax]`:

```ts
if (cat.tierStatKey != null) {
  if (!(cat.tierStatKey in rawStats)) return 0
  const value = rawStats[cat.tierStatKey]
  if (!Number.isFinite(value)) return 0
  const min = cat.tierMin ?? Number.NEGATIVE_INFINITY
  const max = cat.tierMax ?? Number.POSITIVE_INFINITY
  return value >= min && value <= max ? pointsValue : 0
}
```

That logic was already committed on `main`. What was missing: the `ScoringCategory` type
(`lib/sportConfig/types.ts`) never declared `tierStatKey` / `tierMin` / `tierMax`, and no
scoring category in `NFL_SCORING_BASE` actually used them — so the tier path was dead code with
nothing to exercise it. **G8 and G9 are that gap, closed**: the type fields, plus the first real
categories that use them (team-defense scoring).

## G8 — Team Defense / Special Teams (DST) scoring

`NFL_SCORING_BASE` (`lib/sportConfig/configs/nfl.ts`, `group: 'team_def'`) adds the counting-stat
categories every DST-scoring league expects, all commissioner-toggleable
(`isToggleable: true`) with sensible defaults:

| Category | Stat key | Default pts |
|---|---|---|
| Sack | `def_sack` | 1 |
| Interception | `def_int` | 2 |
| Fumble recovery | `def_fr` | 2 |
| Safety | `def_safety` | 2 |
| Blocked kick | `def_blk_kick` | 2 |
| Defensive TD | `def_td` | 6 |
| Special-teams / return TD | `def_st_td` | 6 |

Plus **points-allowed tiers** — a team-defense roster row carries one `def_points_allowed`
value; exactly one tier category matches it via the new `tierStatKey`/`tierMin`/`tierMax` fields
(`def_pa_0` = 10 pts for 0 allowed, down to `def_pa_35_plus` = −4 pts for 35+ allowed — see the
source array for the full ladder).

These score directly off raw team-defense stats, not through the per-player
`SportAdapter.parseRawStats` parser — `__tests__/redraft-sport-adapter-parity.test.ts` was
updated to exempt `group: 'team_def'` categories from that check accordingly (they intentionally
never appear in a per-player `parsed` stats object).

**Status:** wired into the scoring runtime (`categoryPoints()`, already on `main`) and covered
end-to-end by the existing `lib/e2e/seedG8League.ts` harness (creates a real league through the
canonical creation pipeline, rosters a team defense, seeds weekly DEF scores, and exercises the
commissioner scoring-override path via `saveLeagueNflScoringConfig`).

## G9 — Return yardage (optional, off by default)

`def_kr_yd` (kick-return yards) and `def_pr_yd` (punt-return yards) exist in the config with
`defaultPoints: 0` and `unit: 'per_yard'` — present so a commissioner *can* enable per-yard return
scoring, but inert until they do. This is a deliberate, honest default: no provider-verified
return-yardage feed has been certified for this yet, so it ships off rather than guessing a
default value.

## Yards-allowed tiers (present, inert until a provider feeds them)

`def_ya_*` tier categories (0–99 up to 450+ yards allowed) are defined with `defaultPoints: 0`
and `tierStatKey: 'def_yds_allowed'`. Same posture as G9: the scoring contract has a slot for
this, but nothing currently populates `def_yds_allowed` on a roster row, so these stay inert
(never silently scoring on absent data — `categoryPoints()` returns 0 when `tierStatKey` isn't
present in `rawStats`).
