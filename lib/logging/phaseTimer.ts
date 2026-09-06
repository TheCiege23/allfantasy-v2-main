/**
 * phaseTimer — attribute one request's elapsed time to named stages.
 *
 * `createTimer` in ./structured answers "how long did the whole thing take". This answers "where
 * did it go", which is a different question and the one a slow route actually poses.
 *
 * ⚠ BUILT ON `createTimer` RATHER THAN BESIDE IT. That helper already picks `process.hrtime.bigint`
 * where available and falls back to `Date.now`; a second clock here would be a second answer to
 * "what time is it", which is the shape of bug this repo has paid for elsewhere (five spellings of
 * one team-logo rule, two implementations of one name normalizer).
 */
import { createTimer } from './structured'

export interface PhaseTimer {
  /**
   * Charge the time since the PREVIOUS mark (or since creation) to `name`.
   *
   * Repeated names ACCUMULATE. A stage that runs once per trade side would otherwise report only
   * its last invocation and silently halve the figure being investigated.
   */
  mark(name: string): void
  /** A copy of the tally so far, in whole milliseconds. */
  phases(): Record<string, number>
  /** Whole-run elapsed, in whole milliseconds. */
  totalMs(): number
}

export function createPhaseTimer(): PhaseTimer {
  const timer = createTimer()
  const phases: Record<string, number> = {}
  let lastMs = 0

  return {
    mark(name: string): void {
      const now = timer.elapsedMs()
      const delta = now - lastMs
      lastMs = now
      phases[name] = Math.round((phases[name] ?? 0) + delta)
    },
    phases(): Record<string, number> {
      /*
       * A copy. The caller serialises this into telemetry and may well hold it while more work
       * happens; handing out the live object would let a later mark mutate an already-reported
       * number, or let a caller corrupt the tally.
       */
      return { ...phases }
    },
    totalMs(): number {
      return Math.round(timer.elapsedMs())
    },
  }
}

/**
 * The unattributed remainder: whole-run time charged to no phase.
 *
 * 🛑 THIS IS THE NUMBER THAT SAYS THE INSTRUMENTATION IS WRONG. A large remainder means the
 * expensive step has no mark around it — which is precisely the failure phase timing exists to
 * catch. Folding the gap into the nearest phase would produce a plausible attribution that is
 * confidently wrong, and nothing downstream could tell.
 */
export function unattributedMs(t: PhaseTimer): number {
  const sum = Object.values(t.phases()).reduce((a, b) => a + b, 0)
  return Math.max(0, t.totalMs() - sum)
}
