# Four Horsemen — a real league the value engine gets wrong in 11 ways

Worked example against the actual rules PDF (2026-09-01). Every number below is measured against
the shipped code, not estimated.

**Why this document exists.** My probes tested formats I could name from the codebase. This league
is a *real one*, and its rules break the engine in ways no synthetic probe reached — because the
breakages come from settings I did not think to vary: **4 teams**, **10 flex slots**, **a 10-round
rookie draft**, and **scoring categories the engine has no vocabulary for at all**.

---

## The league, from the rules

| Setting | Value |
|---|---|
| Teams | **4** |
| Starters | 4 QB · 4 RB · 6 WR · 4 TE · **10 FLEX** = **28** |
| Bench / Taxi / IR | 32 / 10 / 10 → **80 roster spots per team, 320 rostered leaguewide** |
| Format | Dynasty |
| TE premium | **0.75/reception** on top of full PPR |
| Rookie draft | **10 rounds**, 4 picks/round |
| Startup draft | 70 rounds |
| Trade window | closed weeks 13–17 |
| Fairness authority | **KeepTradeCut**, 5000 pts or 50% triggers a reversal poll |
| Side game | **Eliminator** — lowest weekly score gets a strike; 4 strikes = out |

---

## What breaks

### 1. 🛑 Rookie rounds 6–10 all price identically at 100

`PICK_ROUND_BASE = pickRoundTable(2500)` and `pickRoundTable(firstRoundValue, rounds = 5)` — the
table has **five entries**. `normalizedPickValue` then does `PICK_ROUND_BASE[round] ?? 100`.

Measured:

| round | value | overall # (4-team) | overall # (12-team) |
|---|---|---|---|
| 1 | 2500 | 1 | 1 |
| 2 | 1200 | 5 | 13 |
| 3 | 600 | 9 | 25 |
| 4 | 320 | 13 | 37 |
| 5 | 180 | 17 | 49 |
| **6** | **100** | 21 | 61 | ← off the table |
| **7** | **100** | 25 | 73 | ← off the table |
| **8** | **100** | 29 | 85 | ← off the table |
| **9** | **100** | 33 | 97 | ← off the table |
| **10** | **100** | 37 | 109 | ← off the table |

**Half this league's rookie draft is priced at a flat floor.** A 6th and a 10th are the same asset
to the engine.

### 2. 🛑 Pick value ignores league size — and the league's own rules say so

`normalizedPickValue({ round, pickSeason, currentSeason })` takes **no league size and no pick slot
within the round**. A round-3 pick is 600 whether it is overall #9 or overall #25.

The rules document says this in plain words:

> "A 3rd round pick here is a 1st rounder in a typical 12 team league. It would fall somewhere in
> the 1.9-1.12 range."

A late 1st is worth roughly 1500–2000 in this scale. The engine says **600**. **Understated ~3×**,
and the commissioner already wrote the correction into the rules because managers kept getting it
wrong. **The fix is to key the curve on overall pick number, not round** — `overall = (round − 1) ×
teams + slot`. That makes it correct for 4-, 10-, 12- and 14-team leagues at once.

### 3. 🛑 Scoring categories the projection engine cannot express

`ScoringFormat` is `'ppr' | 'half_ppr' | 'std'`. This league scores:

| Rule | Expressible? |
|---|---|
| −1 per **incompletion** | ❌ no vocabulary |
| +0.5 per **completion** | ❌ |
| +1 per **rushing first down** | ❌ |
| +1 per **receiving first down** | ❌ |
| +1 per 40+ yd completion, +2 per 40+ yd pass TD | ❌ |
| +2 / +3 per 40+ yd rush / rush TD | ❌ |
| 100–199 / 200+ yd rushing & receiving bonuses | ❌ |
| 300–399 / 400+ yd passing bonuses | ❌ |
| −4 per INT, −2 per pick-six | ❌ |
| 0.04/pass yd, 0.1/rush yd, 1 PPR | ✅ approximated by `ppr` |

**The incompletion penalty alone reinvents quarterback value.** A 40-attempt, 60%-completion QB
loses 16 points a game to incompletions and gains 12 for completions — a −4 swing per game that
full-PPR scoring puts at zero. A high-volume, low-accuracy QB is a materially different asset here,
and the engine cannot see the category at all.

### 4. 🛑 10 FLEX slots — a third of the lineup has no address

`starterNeedsFromSlots` counts flex but deliberately does not distribute it:

> "a flex is a requirement without an address, and splitting it would invent a per-position number
> the roster never asked for."

That is a good decision at 1–2 flex. At **10 of 28 starters** it means the engine has no opinion
about 36% of the lineup. `weakPositions` / `strongPositions` are computed against `needs` that omit
the largest single block of demand in the league.

### 5. 🛑 4 teams, and the default is 12

`leagueSize ?? 12` in `captureSnapshot.ts` and `buildTeamProfile`. Here it is **4** — a 3× error in
the one input that sets replacement level. And `seedTopHalf` uses `Math.ceil(leagueSize / 2)`, so
with 4 teams "top half" is seeds 1–2, i.e. exactly the playoff field. Stance classification is
measuring something different from what it does in a 12-team league.

### 6. TE premium 0.75 is capped into near-irrelevance

`TE_PREMIUM_PER_POINT = 0.18`, so 0.75 × 0.18 = **1.135×**. But this league starts **4 TEs plus 10
flex**, in a 4-team league — so TE demand is extreme *and* the premium is real money. A 1.135×
nudge does not describe a format where a startable TE is among the scarcest assets on the board.

### 7. Taxi (10) and IR (10) are invisible

20 free stash slots per team. A stashed rookie or an injured star costs a Horsemen manager nothing
to hold, and costs a 12-team redraft manager a bench spot. `ScoringContext` has no field for either.

### 8. Trade deadline weeks 13–17 not modelled

After week 13 a win-now rental has no remaining trade utility. The engine has no deadline input.

### 9. The Eliminator is a second, parallel value system

Lowest weekly score earns a strike; 4 strikes and your scores stop counting. That is a **floor**
game running beside a **ceiling** game: for Eliminator survival a manager wants weekly floor, while
the championship rewards totals. The same roster has two different values depending on which pot is
live, and a manager with 3 strikes values a safe floor far above a boom/bust ceiling.

### 10. The league's fairness authority is KeepTradeCut, not us

> "If a trade has a difference of 5000 points (or 50%) or more according to keeptradecut.com
> (while using standard settings with a TE+++ bonus), a poll will be created…"

They already have a numeric fairness rule with a threshold and a tool. Our grade competes with it.
Worth deciding whether AF should **reproduce** that threshold (5000 / 50%, TE+++) so the commissioner
tooling agrees with the written rule, rather than offering a rival number.

### 11. Trades require dues paid on future picks

> "trading away future draft picks isn't allowed unless the owner has paid their league dues for the
> year of the draft pick being traded away."

A pick's *tradeability* is conditional on a payment state. Not a valuation problem — a **trade
legality** problem the commissioner tooling could enforce.

---

## What this changes about the plan

You said **"pirate needs something different — honestly I think they all need something different."**
This document is the evidence for that, and I now agree. My earlier suggestion — one elimination
model with per-format parameters — was wrong. Four Horsemen is not even an *elimination* format and
it still breaks the engine in 11 places, most of them from ordinary settings.

So the architecture should be a **registry of per-format value modules**, not one parameterised
model:

```ts
export interface FormatValueModel {
  formatId: string                       // 'four_horsemen' | 'pirate' | 'guillotine' | …

  /** Multiplier + REASON applied on top of the base market value. Never folded in silently. */
  adjust(input: {
    base: number
    player: { position: string; age?: number | null }
    league: LeagueShape                  // teams, starters by pos, flex, bench, taxi, IR, deadline
    teamState?: unknown                  // format-specific: strikes, throne, eviction, plunder
  }): { multiplier: number; reason: string } | null

  /** Asset kinds this format can trade that others cannot (idol, steal rights, cap space). */
  extraAssetKinds?: readonly string[]

  /** Format-specific trade legality (dues paid, deadline, elimination). */
  canTrade?(input: unknown): { ok: boolean; reason: string }
}
```

**Two things must be shared, not per-format**, because they are wrong for everyone right now:

1. **`LeagueShape`** — teams, starters by position, flex count, bench/taxi/IR, deadline. Every
   format needs it; none of it reaches the engine today.
2. **Overall-pick-number pick curve.** Round-keyed is wrong in any league that is not 12 teams,
   which is most of yours.

Those two are Phase 1.7, and they fix Four Horsemen's items 1, 2, 4, 5, 7 and 8 — **six of eleven —
without writing a single format-specific module.**

---

## Questions this raised

1. **Is Four Horsemen on Sleeper?** The rules mention Sleeper scheduling and LeagueSafe. If so, do
   we import these settings today, or does the importer flatten them?
2. **Should AF reproduce the KeepTradeCut 5000/50% rule** for this league's veto tooling, or offer
   its own grade alongside?
3. **How many of your leagues are non-12-team?** That decides whether the overall-pick curve is a
   Four-Horsemen fix or a fix for most of the platform.
4. **Do you want the Eliminator modelled as floor-vs-ceiling value**, or just surfaced as context
   ("you have 3 strikes — prioritise a safe floor this week")?
5. **Which format should I build first as the reference module?** Four Horsemen is the richest test
   case because it is ordinary settings pushed to extremes; pirate is the most *different*.
