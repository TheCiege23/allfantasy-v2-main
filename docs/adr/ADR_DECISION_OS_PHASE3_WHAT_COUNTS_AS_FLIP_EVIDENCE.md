# ADR — Phase 3: what counts as evidence for a surface flip

**Status:** Proposed — awaiting Guap's decision. **No surface has been flipped and no gate code changed by this ADR.**
**Date:** 2026-09-06
**Governs:** any decision to set a `DECISION_OS_*_LIVE` flag on the strength of `flipReadiness` output; `lib/decision-os/core/parity/flipReadiness.ts` is described here, not modified.
**Required by:** AF_TRADE_UNIFICATION_BRIEF Phase 3 — "flip a surface when agreement holds at ≥95% over ≥50 real comparisons". That sentence defines the *threshold*. It does not define what a comparison has to BE, and this ADR is that missing half.
**Follows:** the three emit fixes that made the counts trustworthy in the first place — `e22b625c8` (lineup duplicate emit), `e028e39f7` (commissioner uncountable), `eda57aa7b` (trade proposal shadow). Before those, two of three surfaces could not produce a countable comparison at all.

---

## 1. Problem statement

`summarizeFlipReadiness` is pure arithmetic: `verdicts >= 50 && agreementRate >= 0.95 → 'ready'`. It has no opinion about what the two compared engines were fed, and it cannot have one — the flags it reads carry a verdict, not a provenance.

**`manager.lineup.set` reads `ready` today.** Measured in production 2026-09-05 (`decision_parity_record`, read-only probe): **2,817 comparisons, 2,808 agreements, 9 disagreements, 99.68%** — past both bars, several times over.

That number is not evidence that the Decision OS decides well, and a reasonable person reading `readiness: 'ready'` off `/api/admin/decision-os/parity-readiness` would conclude that it is. This ADR exists so nobody flips a surface on it by accident.

## 2. What the lineup number actually measures — read from the code, not inferred

`lib/decision-os/lineup/shadow.ts`:

```ts
const memo = args.legacySummary
const result = await runLineupSetDecision(input, {
  decision: { recommend: async () => memo, ruleDeps, newId: deps.newId },
  shadow:   { legacyRecommend: async () => memo },
})
```

**The decision's recommender and the legacy shadow return the same object.** `decideLineupSet` (`lib/decision-os/lineup/decision.ts:50`) takes `deps.recommend(...)`, filters its actions to the league, applies rules, and builds the decision from that; `compareLineupParity` then compares the result against the memo it was derived from.

The repo already says this in one line, and the line is easy to scroll past —
`lib/decision-os/core/parity/telemetry.ts:5`:

```
decision.shadow_parity → Decision OS recommendation vs legacy (wrapper-drift / equivalence)
```

So 99.68% means **"the wrapper does not alter the legacy answer."** That is a real, useful, load-bearing property: it is exactly what you want to know before you replace a call site, and 9 disagreements out of 2,817 is a genuinely reassuring wrapper-drift result. It is *not* a claim that the answer is good, because the same engine produced both sides.

⚠ This is the same shape as a defect already recorded against the trade console path: the canonical engine is handed the console's own market value, so when both price from market their agreement is partly tautological. Lineup is the fully-collapsed version of it.

## 3. The trade surfaces are NOT equal, and the gate cannot tell them apart

After `eda57aa7b`, `manager.trade.evaluate` emits three distinct surfaces. They carry different strengths of evidence and must never share a bucket:

| surface | inputs | independent? | what agreement proves |
|---|---|---|---|
| `proposal_wrap_fidelity` | the SAME persisted deterministic snapshot it is then graded against | **no, by design** | the wrapper introduces no drift |
| `console` | the console's own `marketValue` / `pricedSource`; `adpValue` and `idpValue` hardcoded null | **partly** — tautological whenever both sides price from market | little, when market-priced |
| `proposal` | resolves its own ADP and position data via `resolveTradeEnrichment` (`adp_data`, SportsPlayer cache) | **yes** | two engines that were fed different inputs reached the same answer |

Only the third is evidence about the *decision*. The first two are evidence about the *plumbing*.

🛑 **This is why the surface labels are load-bearing rather than cosmetic.** `flipReadiness.ts:68` groups on `flags.surface` with a literal `'default'` fallback. Had all three landed in one bucket, weaker evidence could top the stronger up to fifty and satisfy the gate while proving less than it claims — the exact conflation the per-surface gate exists to prevent, arriving through the back door. A mislabelled sample is also unfixable after the fact: it is harmless at zero rows and cannot be re-attributed at fifty.

## 4. Options considered

| Option | Assessment |
|---|---|
| **Flip on the gate as written** — `ready` is `ready` | **Rejected.** Lineup would flip today on a 99.68% self-comparison. The gate's arithmetic is correct and its inputs are unlabelled; treating the output as a decision delegates a judgement to a function that was never given the information to make it. |
| **Change `flipReadiness` to refuse wrap-fidelity surfaces** | **Rejected for now.** It hardcodes a policy into a summariser that today only *reports*, and it would have to encode "which surfaces are tautological" — a fact about wiring that changes when the wiring changes, in a file that would not be updated alongside it. The distinction belongs in the surface NAME (where it now is) and in the reader's head (where this ADR puts it). |
| **Require independence per surface, and say so out loud** | **Proposed.** Costs nothing, changes no code, and is checkable: the surface name states which kind of evidence it is. |
| **Do nothing and decide at fifty comparisons** | **Rejected.** Deciding early is free; deciding at fifty means throwing a sample away, because a sample gathered under one definition of "comparison" cannot be reinterpreted under another. |

## 5. Decision (proposed)

1. **`ready` is a precondition for a flip, never a trigger.** Nothing auto-flips today (`flipReadiness`'s only consumer is the admin route that displays it) and nothing should. A human reads the surface, the input wiring, and then decides.

2. **Only a surface fed independent inputs may flip on its own agreement rate.** Today that is exactly one: `manager.trade.evaluate | proposal`. A wrap-fidelity surface reaching 50/95% licenses replacing the call site — it does not license trusting the recommendation.

3. **`manager.lineup.set` does not flip on its current evidence**, notwithstanding `readiness: 'ready'`. If lineup is to flip, it needs a comparison where the Decision OS path and the legacy path are fed independently — which does not exist today and would be new work, not more waiting.

## 6. Consequences

- The Phase 3 bar gets **harder**, not easier: one surface qualifies instead of two, and the qualifying one has zero comparisons so far.
- The honest position on trade is that it has **no** usable evidence yet: `console` stands at 2 verdicts, and the single earlier one predates the zero-confidence guard and is the exact false positive that guard was written to reject.
- `commissioner.league.health` restarts from zero. Its 80 historical rows keep no `ran` in their stored flags and are not retroactively countable — correct, and worth stating so nobody reads `e028e39f7` as a flip.

## 7. What this ADR does NOT say

- It does not say wrap-fidelity telemetry is worthless. It is the cheapest available proof that a wrapper is safe to install, and lineup's 9 disagreements in 2,817 are a real finding.
- It does not say the gate is broken. `flipReadiness` computes exactly what it claims to; the gap is that "comparison" was never defined.
- ⚠ It does not claim the surface labels are complete. `manager.lineup.set` and `commissioner.league.health` still emit **no** `surface` and bucket as `'default'`. That is deliberate and currently harmless — each of those decision types has exactly one surface, so there is no collision — but it stops being harmless the moment either gains a second one, at which point the historical rows cannot be attributed. Label them BEFORE adding a second surface, not after.

---

## 8. Why the one bucket that can flip a surface is not filling — measured 2026-09-06

Rule 2 above says only `manager.trade.evaluate | proposal` may flip on its own agreement rate.
`DECISION_OS_TRADE_SHADOW` has since been enabled in production and that bucket is still empty.
**This is not a traffic problem, and the reason is worth writing down because it looked cheap to fix
twice.**

**The Trade Center is not instrumented on the path that matters.** Its "Propose this trade" posts to
`/api/leagues/[leagueId]/trades`; `runTradeShadowForProposal` runs only in
`/api/redraft/trade-proposals`. The *analyse* path IS instrumented — `/api/trade-value/analyze` calls
`recordTradeSurfaceShadow({ surface: 'console' })` — so trade evidence is not zero, it is
**console-only**, which by rule 2 cannot flip anything.

**Wiring the propose path is blocked on an id-space split, not on effort.** The shadow needs a
`TradeValueSnapshot`, and `computeRedraftTradeValueSnapshot` prices from `prisma.redraftRoster`. The
Trade Center holds `Roster` ids. The bridge is the nullable `Roster.redraftRosterId`. Measured with a
read-only probe:

| | |
|---|---|
| leagues with ≥2 reachable rosters (i.e. *could* trade natively) | **59** |
| of those, leagues that could produce a shadow row | **0** |
| reachable rosters | 350 |
| reachable **and** linked to a redraft roster | **4** |
| *control* — link rate across all rosters | 2,855 / 3,408 = **83.8%** (schema documents 84.5%) |

⚠ **THE INVERSION IS THE FINDING.** Rosters that belong to real AllFantasy accounts are almost
exactly the ones WITHOUT redraft counterparts. The control matters: the overall link rate is high, so
a low number here is a property of the *reachable* subset, not a broken join.

⚠ **AND THE CHEAP REPAIR DOES NOT EXIST.** 58 of the 59 leagues do have redraft rosters, so the model
is present — but **zero** of the 346 unlinked reachable rosters would link on the semantic pair the
schema itself names (`Roster.platformUserId` ↔ `RedraftRoster.ownerId`). The two sides key teams by
different identities in both directions, so there is no derivable backfill.

**Consequence.** Instrumenting the propose path as it stands would ship a code path that can never
execute — the same shape as `ingestCFBDStats`, where a surface was pointed at a table nothing
refreshed. Doing it properly means teaching the value engine to price from the AF-native roster
model. That is a project, not a wiring change, and it should be scoped as one.

⚠ **RECORD THE ESTIMATE THAT WAS WRONG, because it will look cheap again.** This was scoped as "one
handler edit plus a snapshot-shape check" and abandoned only after the id spaces were measured. The
`redraftRosterId` bridge is invisible from the route, from the panel, and from the shadow's own
signature — it only appears once you read what `computeRedraftTradeValueSnapshot` actually queries.

⚠ One useful property found on the way: `Roster.platformUserId` holds an AF user id on native leagues
and a **Sleeper** id on imported ones, and a Sleeper id can never match `app_users.id`. So the join to
`app_users` IS the native-league test — no separate "is this imported" filter is needed, and
`canReceiveProposal` in `trades/rosters` is that same predicate.
