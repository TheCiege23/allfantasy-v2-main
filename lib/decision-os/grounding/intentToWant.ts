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
 * ⚠ FOUR FLAGS, NOT SEVEN. `waiverDecision` has no producer anywhere in `packet.ts` — mapping
 * `waiver` intent to it would request a slice nothing can ever fill. `idpKicker` is deliberately
 * excluded too: its own doc comment names it "the one slice that cannot join the concurrent
 * wave" — a serialized second hop with its own cost profile — and turning it on for every
 * player_value question is a real latency decision that deserves its own measurement, not a
 * rider on this fix.
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
    'lineupDecision' | 'commissionerHealthDecision' | 'psychologyConsistency' | 'rosterValueGrade'
  >
>

export function deriveWantFromIntent(intent: ChimmyOrchestrationIntent): IntentDerivedWant {
  return {
    lineupDecision: intent === 'start_sit',
    commissionerHealthDecision: intent === 'commissioner',
    psychologyConsistency: intent === 'manager_psychology',
    rosterValueGrade: intent === 'player_value',
  }
}
