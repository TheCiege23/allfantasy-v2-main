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
 * `idpKicker` is not mapped HERE: since 2026-11-16 the chat route requests it on every turn, because its
 * own exit stops before any query in a league that rosters no IDP or kicker, and it is bounded by the
 * packet's clock (`IDP_KICKER_DEADLINE_MS` in packet.ts) so the serialized hop can cost only itself.
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
 * `Required` keeps every one mandatory, so dropping one is `TS2741` rather than a silent `undefined`.
 * Both verified against a planted failure before being relied on.
 */
type PacketWant = NonNullable<GroundingPacketArgs['want']>

type IntentDerivedWant = Required<
  Pick<
    PacketWant,
    | 'commissionerHealthDecision'
    | 'rosterValueGrade'
    | 'waiverDecision'
    | 'myTeamLineup'
    | 'pendingTrades'
    | 'draftBoard'
  >
>

export function deriveWantFromIntent(intent: ChimmyOrchestrationIntent): IntentDerivedWant {
  return {
    /*
     * `lineupDecision` and `psychologyConsistency` USED TO BE MAPPED HERE, both to a hard `false`.
     * Both slices were deleted from the packet on 2026-11-17: the lineup one cost 37s against a 3s
     * ceiling and duplicated My Team's `optimizeLineup` (the one start/sit answer, owner decision
     * 2026-09-29), and the psychology one had no renderer. Manager facts reach Chimmy through the
     * paid `get_manager_record` tool instead.
     */
    commissionerHealthDecision: intent === 'commissioner',
    /*
     * My Team's best lineup, on a lineup question (2026-11-20). The one optimizer the screen runs, read the way the
     * lineup tool reads it, so a "who should I start" turn has the answer in its packet as well as its tool.
     */
    myTeamLineup: intent === 'start_sit',
    /*
     * The trades waiting on the asker, graded, on a trade question (2026-11-20). The trade tool reads the same inbox
     * with the same engine; in the packet, "should I take this offer?" has the offer and its grade without the model
     * having to think of calling it.
     */
    pendingTrades: intent === 'trade',
    /*
     * The draft board with Draft OS's pick for the asker, on a draft question (2026-11-20). The same read as the
     * draft board tool; the route turns it off inside the draft room, which already hands the loop that board.
     */
    draftBoard: intent === 'draft',
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
     * ⚠ AND THE CASE IS GENUINELY WEAKER THAN THE OLD `lineupDecision` ONE. That slice was 37s
     * against a 3s ceiling and was therefore discarded on EVERY turn — removing it cost nothing.
     * This one is ~4.6s: over the ceiling most of the time, but not always. So this is a
     * MITIGATION, not a free win, and it is worth saying which one it is.
     *
     * The reason it still goes: the ceiling discards the WHOLE packet, not the slow slice. Asking
     * for this trades the other fifteen feeds — values, projections, portfolio, league
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
     *
     * ✅ BACK ON FOR player_value — 2026-11-16 (re-score item 8), BECAUSE THE PACKET NO LONGER WAITS ON IT. The
     * packet now reads `loadRosterValueGradeSliceCached`: a cached grade (15 min) is served at once, and a miss
     * starts the compute in the background and returns a "being computed" gap. The 4.6 s above is never on the
     * critical path again, so the trade described above no longer exists.
     */
    rosterValueGrade: intent === 'player_value',
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
