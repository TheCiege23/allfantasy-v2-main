# Import Batch A/A.1 — corrections to claims made in this branch

Written 2026-09-10, after an external review of the Batch A closeout. Commit messages are
history and are not being rewritten; this file is the correction of record. Every claim below
was re-measured at `c318ae8f3` before being contradicted.

---

## 1. `f665943c7` — "which is why it carries its own positive control"

**The claim.** That commit repaired the registry scanner for the second time, observed that
"twice is a pattern: a scanner that answers *nothing found* is indistinguishable from one that
is not looking", and said the guard therefore "carries its own positive control".

**What was wrong.** The positive control it added
(`the guard is capable of finding something — it is not a dead scan`) **never invoked the
scanner.** It re-implemented a one-line regex sweep of `lib/` and asserted the sweep saw more
than 20 files. It proved that `walk()` reached `lib/` and that the string
`leagueTeam.findMany(` occurs in the tree. It proved nothing whatsoever about
`findUnguardedEnumerations`.

**Measured.** With the old `findUnguardedEnumerations` mutated to `return hits` before its loop
— a scanner that reports nothing, ever — the suite exits **0 with 4/4 passing**, the positive
control among them.

That is the same defect class the commit was written to fix, in the very mechanism written to
prevent a third instance. A third instance was in fact present the whole time (§2).

**Corrected.** The scanner now takes its sources as an argument, and the control runs the
production function against planted fixtures — including the two shapes that previously defeated
it. Blinding it in any of the three ways it has actually been blinded turns the suite red;
each was applied and measured.

---

## 2. The blindness nobody had found: a call wrapped across two lines

**Not previously claimed, and the most consequential finding of the review.**

The scanner iterated lines and tested each against a per-line pattern. Prettier wraps a long
Prisma call onto two lines:

```ts
prisma.leagueTeam
  .count({ where: { leagueId: l.id } })
```

The receiver and the verb are then on different lines and the call is **invisible**.

| | call sites |
|---|---|
| `leagueTeam.findMany`/`count`, per-line (what the guard saw) | 120 |
| the same, multiline-aware | **175** |

**55 of 175 — 31% — were outside the guard entirely.** Correcting it surfaced **30 unfiltered
league-wide enumerations across 27 files** that no previous pass had seen, concentrated in
`lib/core-app/` — the live `/core` surface.

### This branch caused one of them itself

`48a0d46ad` added `ACTIVE_TEAM_WHERE` to `lib/chimmy/tools/leagueByName.ts`. That pushed the
line over the width limit, Prettier wrapped it, and **the call site left the guard's sight**.
Remove the filter again today and nothing goes red. The fix removed its own call site from the
guard that polices it.

That single call is also the entire discrepancy between the census's `146` files and a fresh
same-line rescan's `145`.

---

## 3. `f665943c7` — "surfaced 18 league-wide enumerations"

**The claim.** Scoping the narrowing-key test to the `where` clause "surfaced 18 league-wide
enumerations the guard had been silently passing over."

**Measured.** That change surfaced **34 call sites across 31 files**. `18` is a different
quantity — the readers newly *classified* in that commit (9 registered + 5 fixed + 4 deferred).
Both numbers are used for both quantities in the same message. The commit's own body is
internally consistent about the 9/5/4 split; the sentence quoted above is not.

---

## 4. `f665943c7` — "Zero disagreements across all 18"

Contradicted by the next commit. `c318ae8f3` is titled *"correct two registry reasons from the
adversarial challengers"* and rewrites the recorded reason for `leagueWarehouseReads` and
`userOsContext`. Agreement on the verdict is not zero disagreement about the reason, and the
reason is what the registry stores.

---

## 5. `c318ae8f3` / closeout §4.2 — the `userOsContext` counterexample is false

**The claim.** Filtering `userOsContext`'s standings was "DEMONSTRABLY UNSAFE" because
"`activeLeagueContext` resolves `viewerTeam` from the UNFILTERED set, so an archived-but-claimed
viewer is absent from a filtered standings array while `viewerTeam` is still non-null",
producing `rankIndex === -1`, a percentile above 1, and *"#0 of 11 (109th percentile)"*.

**What the code does.** `lib/shared-services/league-hub/userOsContext.ts:166`:

```ts
const viewerTeam = standings.find((s) => s.isViewerTeam) ?? null
```

`viewerTeam` is derived **from `standings`**, which is derived from the same query. It cannot be
non-null while its row is absent — the `?? null` is the whole point. Filter the query and
`viewerTeam` is `null` exactly when the seat is archived, and both generators return early:

- `generators/playoffRecommendations.ts:20` — `if (… || !context.teamId || !context.viewerTeam) return []`
- `generators/strategyRecommendations.ts:41` — `if (!context.viewerTeam || context.standings.length < 2) return null`

The scenario is unreachable. `activeLeagueContext` supplies `active.teamId`, which is only used
to *set* the `isViewerTeam` flag; it never re-introduces the row.

**Consequence.** This read was never MIXED — `standings` is its only consumer. It is a plain
active enumeration and is now filtered at the query, with the generators' early return pinned by
a guard so the property the filter depends on cannot silently disappear.

🛑 **AND THE GENERALISATION DRAWN FROM IT WAS WRONG. `eb7914760`'s message and the A.1 closeout
both say "three of the four MIXED reads were not mixed". Only ONE was.**

`userOsContext` is the single case where the *classification* was mistaken: one consumer, no
historical half, so "MIXED" never described it. The other two are **genuinely mixed and remain
so** — the fix was to filter the CURRENT consumer while leaving the historical one on the
unfiltered array, which is the correct treatment *of a mixed read*, not evidence it was never
mixed:

| file | current consumer (now filtered) | historical consumer (deliberately unfiltered) |
|---|---|---|
| `lib/ai-tools-start-sit/opponentMatchup.ts` | `paSorted`, `n`, the `< 2` guard | `oppTeam` — a past week can name a departed opponent |
| `lib/trade-value-console/roster-context-loader.ts` | `opponentTeams`, the selectable partner list | the `externalId → platformUserId` resolver |

Both still hold two consumers that disagree, and both would break if the query were filtered.
Calling them "not mixed" reads as though the deferral had been a bookkeeping error in all three
cases; in two of the three the deferral was a correct reading of the code and only the *remedy*
was available sooner than claimed. Batch A.2 filters the fourth, `dynasty-projections`, the same
consumer-level way.

---

## 6. `f418ed68b` and the `BroadcastModeEngine` source comment — right fix, wrong reason

**The claim.** The query must stay unfiltered because the identity maps "resolve `dramaEvents`
and `rivalries` back to a name", and filtering meant "the event rendered against an unresolvable
id."

**What the code does.**

| consumer | map used | on a miss |
|---|---|---|
| `matchups` (`:80-81`) | `teamById`, `teamByExternalId` | `?? m.teamA` — renders a raw team id |
| `rivalriesWithNames` (`:106-107`) | `ownerNameByManagerId` | `?? r.managerAId` — renders a raw manager id |
| `storylines` (`:96`) | **none** | unaffected |

`dramaEvents` touches no team map at all. The genuinely map-dependent consumer is `matchups`,
which the claim does not mention. And nothing becomes "unresolvable": every lookup has a `??`
fallback, so the cost is a **name degrading to an id**, not a dropped row or a throw.

**The fix itself was correct** and is unchanged. Only the stated reason was wrong, in the source
comment, in the commit message, and in closeout §5. The source comment is corrected here.

---

## 7. Closeout §2 / the census — "No reader is left unclassified"

False, by the mechanism in §2. The census generator used the same same-line regex, so a large
share of the population was never examined.

⚠ **The size of that share was stated with two different denominators bolted together, and this
is the corrected arithmetic.** Both comparisons are over `lib/` + `app/` + `scripts/`:

| comparison | difference | what it means |
|---|---|---|
| 263 multiline-aware vs **193** same-line rescan | **70** | call sites a same-line scan of the tree **today** cannot see |
| 263 multiline-aware vs **194** census table | **69** | call sites missing from the census **as written** |

The two differ by one because the census table still lists
`lib/chimmy/tools/leagueByName.ts`, which a same-line rescan no longer sees — the wrapped call
of §2. Writing "70 … vs 194" pairs a difference with the wrong operand; **69** is the number of
rows the census is short.

`LEAGUETEAM_READER_CENSUS.md` carries the retraction and the reconciliation of the three figures
in circulation (146/194, 139/186, 145/193).

---

## 8. The integration gates the closeout reported on had not completed

`broad-int.txt`, the branch-tip vitest run, ends with **`DONE=4` and no summary block** — 235 KB
against the baseline run's 1.1 MB. `ratchet-f665.txt`, the TypeScript ratchet at the final two
commits, is **0 bytes**. Neither measured the tested SHA, so no baseline-versus-tip comparison
existed for `f665943c7` or `c318ae8f3`.

⚠ **WHAT THAT EVIDENCE DOES AND DOES NOT ESTABLISH — AND THIS FILE OVERREACHED ONCE ALREADY.**
An earlier version of this section said the run "was terminated before Vitest reported", and the
A.1 closeout went further and named Vitest as the failing component. The artifacts support
neither claim.

What they establish: the run **did not complete normally**. Vitest exits 0 on pass and 1 on test
failures; `DONE=4` is neither, and the summary block Vitest always prints is absent. So the
output is incomplete and the exit status is abnormal, and **no result may be read from it** —
which is the only thing the gate decision needed.

What they do NOT establish: *why*. Exit 4 could be an internal Vitest error, a killed child, a
crashed worker pool, or the wrapper losing the process; the artifacts cannot separate those, and
nothing was captured at the time that would. Attributing it to a specific component was an
inference presented as a measurement — the same move this document exists to correct elsewhere.

**The rule: an abnormal status plus truncated output is sufficient to reject a result and
insufficient to diagnose a cause.** Rejecting it needed no cause.

---

## What this file does not do

It does not re-classify the 27 files in `PENDING_CLASSIFICATION`. They are suppressed and
counted so the guard is usable and the backlog cannot grow; they have not been read. That is the
largest outstanding item in this branch and it is deliberately not being closed by assertion.
