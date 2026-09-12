import type { ChimmyOrchestrationIntent } from '@/lib/chimmy-orchestration/types'
import type { GroundingPacketArgs } from '@/lib/decision-os/grounding/packet'

/**
 * The intent router — R2/R3.1/R3.3/R4b.5 built four opt-in packet slices, wired them end to end,
 * and nothing decided per question whether any of them was worth asking for. The live chat route
 * hardcoded `want` to four always-on flags; every opt-in slice defaulted to never-requested.
 *
 * PURE. No I/O and no runtime dependency on the packet — the one `packet` import is `import
 * type`, erased at compile time, and exists solely so the flag NAMES are compiler-checked (see
 * below). This file does not know what a `DecisionOsGroundingPacket` is, only which of its
 * opt-in slices each Chimmy intent should turn on.
 *
 * ⚠ FIVE FLAGS, NOT SEVEN — and `waiverDecision` was originally mapped for a reason that was NOT
 * "it works". It had no producer, so asking for it returned an honest `no_producer` gap naming the
 * missing input and pointing at the waiver surface that COULD answer. That was strictly better
 * than the silence it replaced: unmapped, a waiver question got no waiver fact AND no explanation,
 * so the model had nothing to be honest about. Mapped, the refusal was grounded.
 *
 * 🛑 THAT IS NO LONGER TRUE, AND THE PARAGRAPH ABOVE IS KEPT ONLY FOR ITS REASONING.
 * `loadWaiverDecisionSlice` in `grounding/decisionBridge.ts` is a real producer now: it resolves
 * world facts, loads the league's available pool through `waiver/pool.ts`, and runs the actual
 * claim engine. "It still has no producer" was the live text here until 2026-09-12 and would send
 * a reader hunting a gap that no longer fires.
 *
 * ⚠ AND IT MUST STAY OPT-IN FOR EXACTLY THAT REASON. The gap is only surfaced when the intent
 * asked for it; on every other turn the slice is `not_requested` and never renders. An
 * always-on "no waiver decision" line would teach a reader to skim the gap block — the failure
 * R1.6 spent a commit removing.
 *
 * `idpKicker` remains excluded: its own doc comment names it "the one slice that cannot join the
 * concurrent wave" — a serialized second hop with its own cost profile — and turning it on for
 * every player_value question is a real latency decision that deserves its own measurement.
 *
 * ⚠ REUSES `chimmy-orchestration`'s classifier, not `chimmy-context`'s. Two intent classifiers
 * share the name `classifyChimmyIntent` in this codebase (`lib/chimmy-context/intent/
 * IntentClassifier.ts` and `lib/chimmy-orchestration/intent-classifier.ts`) and answer different
 * questions with different vocabularies. The chimmy-context one has zero real callers found by
 * census; the chimmy-orchestration one is already called from the live chat route for an
 * unrelated purpose (labelling the turn for orchestration) — reusing ITS result, computed a
 * second time with only `message` available this early, is what this file exists to do.
 */

/**
 * 🛑 DERIVED FROM THE PACKET'S OWN `want`, NOT HAND-WRITTEN, AND THE REASON IS A SILENT FAILURE.
 * The route SPREADS this into the `want` object literal, and TypeScript does NOT excess-property-
 * check a spread. Measured: a typo'd key written inline is `TS2561 ... Did you mean 'lineupDecision'?`,
 * and the SAME typo arriving via spread compiles completely clean. So a hand-written interface here
 * would let a rename of any packet flag — or a typo in a fifth mapping added later — silently stop
 * requesting the slice, with no error and no failing test. That is precisely the bug this file
 * exists to fix, so it must not be reachable from inside the fix.
 *
 * `Pick` makes a wrong key `TS2344` at the definition site (and enumerates the valid ones);
 * `Required` keeps all four mandatory, so dropping one is `TS2741` rather than a silent `undefined`.
 * Both verified against a planted failure before being relied on.
 */
type PacketWant = NonNullable<GroundingPacketArgs['want']>

export type IntentDerivedWant = Required<
  Pick<
    PacketWant,
    | 'lineupDecision'
    | 'commissionerHealthDecision'
    | 'psychologyConsistency'
    | 'rosterValueGrade'
    | 'waiverDecision'
  >
>

export function deriveWantFromIntent(intent: ChimmyOrchestrationIntent): IntentDerivedWant {
  return {
    /*
     * 🛑 ALWAYS FALSE, AND THE MEASUREMENT IS THE WHOLE REASON — 2026-09-07.
     *
     * This was `intent === 'start_sit'`, which is the obviously correct mapping and was also the
     * most expensive line in the packet. Built against a real 13-roster Sleeper league with the
     * live route's own arguments:
     *
     *     general       1,615 ms      waiver     1,004 ms      player_value  643 ms
     *     start_sit    37,256 ms   (warm; 38,528 ms on a second warm run, 56,729 ms cold)
     *
     * The chat route caps the packet at 3s, so start/sit — the most common question in the
     * product — lost its grounding on EVERY turn. It did not merely fail to help.
     *
     * ⚠ THE CEILING IS A `Promise.race`, WHICH ABANDONS THE RESULT WITHOUT CANCELLING THE WORK.
     * All 37s of reads still complete and are still billed, so requesting this slice made
     * start/sit strictly worse than not requesting it: same empty prompt section, plus 3s of
     * user-visible latency and 37s of database work. The route says so in its own words — "a
     * packet that is routinely late is therefore strictly WORSE than one that is switched off".
     *
     * ⚠ THIS IS NOT A JUDGEMENT THAT A LINEUP DECISION IS UNWANTED. It is the one slice whose
     * cost exceeds the budget it has to fit in. The cost lives in `loadLineupSetInputs` +
     * `runLineupSetDecision` (see `decisionBridge.ts`), which is the same engine the standing
     * rule already forbids calling from a page render. Fix the bridge and this mapping comes
     * back; restoring it first only re-buys the 37s.
     *
     * ⚠ KEPT AS AN EXPLICIT `false` RATHER THAN DROPPED FROM THE `Pick` ABOVE. `Required` makes a
     * missing key `TS2741`, and that guard is what stops the OTHER four being silently lost to a
     * rename — see the header. Removing the key to express "never" would spend a compiler check
     * that is protecting unrelated flags.
     */
    lineupDecision: false,
    commissionerHealthDecision: intent === 'commissioner',
    psychologyConsistency: intent === 'manager_psychology',
    /*
     * 🛑 ALSO ALWAYS FALSE — SAME CEILING, WEAKER ARGUMENT, STATED HONESTLY — 2026-09-07.
     *
     * This was `intent === 'player_value'`. Profiled against the same live 13-roster league, using
     * the packet's own `meta.sources` (median of 3, quiet box):
     *
     *     player_value   total 4,593 ms   rosterValueGrade completes at 4,590 ms
     *     general        total 4,511 ms   marketValues     completes at 2,995 ms
     *
     * ⚠ `kick()` MEASURES ELAPSED FROM THE START OF THE CONCURRENT WAVE, not a slice's exclusive
     * duration. So 4,590 of 4,593 ms does not mean this slice "takes" 4.6s in isolation — it means
     * it is the LAST thing to finish, i.e. it IS the critical path. Nothing else is waited on.
     *
     * ⚠ AND THE CASE IS GENUINELY WEAKER THAN `lineupDecision`'S ABOVE. That slice was 37s against
     * a 3s ceiling and was therefore discarded on EVERY turn — removing it cost nothing at all.
     * This one is ~4.6s: over the ceiling most of the time, but not always. So this is a
     * MITIGATION, not a free win, and it is worth saying which one it is.
     *
     * The reason it still goes: the ceiling discards the WHOLE packet, not the slow slice. Asking
     * for this trades the other fifteen feeds — values, projections, psychology, portfolio, league
     * intelligence, import state — against one roster grade, on the roll of whether the build lands
     * under 3s. That is a bad trade at any hit rate.
     *
     * ⚠ THIS DOES NOT MAKE player_value FAST, AND NOTHING HERE SHOULD BE READ AS CLAIMING IT DOES.
     * With this off, the intent inherits the base packet's own cost, which is `marketValues`
     * serialised behind `leagueRules` — measured at 2,995 ms median and itself over the ceiling
     * under load. The real fix is that read (`prisma.playerValueSnapshot` + `resolvePlayers`,
     * already DB-first, so it wants indexing or warming rather than caching) and breaking the
     * `pRules -> pValueFormat -> pMarket` chain. Until that lands, restoring this mapping only
     * re-buys the drop.
     */
    rosterValueGrade: false,
    /*
     * ✅ STAYS ON, AND THIS LINE IS THE MEASUREMENT — 2026-09-12.
     *
     * Measured on production through `/api/admin/decision-os/grounding-proof`, with a real league
     * and `?q=who should I add off the waiver wire` so the intent router selects this slice the way
     * a live chat turn does:
     *
     *     buildMs 812      exceedsChatCeiling false      (ceiling 3,000 ms)
     *
     * That is the WHOLE packet, every slice included, so this one costs at most 812 ms. Roughly
     * 3.7x of headroom. Nothing is being discarded.
     *
     * 🛑 TWO EARLIER FIGURES POINT THE OTHER WAY AND BOTH ARE DEAD. Do not restore either.
     *
     *   `waiver 1,004 ms` in the 2026-09-07 table below was taken while this slice resolved
     *   INSTANTLY to a `no_producer` gap that read nothing. It measured the absence of the work,
     *   not the work, and it cannot be compared with the number above.
     *
     *   An unlanded commit (2026-09-08 23:18) set this line to `false` on the grounds that the
     *   slice "costs ~6.6s". ⚠ THAT WAS PROFILED THE DAY BEFORE BOTH RAILWAY SERVICES MOVED FROM
     *   `sfo` TO VIRGINIA to sit beside the `us-east-1` database — the change that took
     *   `/core/waivers` p90 from 6,216 ms to 1,264 ms. It was measuring a coast-to-coast round trip
     *   per query, against a DIFFERENT producer implementation that never landed. 812 vs 6,600 is
     *   that migration, not this slice.
     *
     * ⚠ WHAT WOULD MAKE THIS WRONG AGAIN, stated so the next reader can check rather than assume:
     * one sample, one league, and `waiver/pool.ts` reads through a DB-backed cache, so a cold
     * `getPlayerPoolForSport` scan (~24k NFL rows, ~74k NCAAF) costs more than a warm one. The
     * headroom absorbs that today. Re-measure with the proof route before changing this line —
     * it reports `exceedsChatCeiling` directly, and that boolean is the decision, not the raw ms.
     */
    waiverDecision: intent === 'waiver',
  }
}
