/**
 * A scope that WROTE successfully but cannot be called complete — IMP-02 / IMP-04.
 *
 * 🛑 THE FALSE-GREEN THIS EXISTS TO KILL. Two independent repairs in this batch preserve
 * last-good data when part of a refresh fails: the canonical-settings rebuild keeps the
 * previous rules, and a failed roster fetch keeps the stored roster. Both are correct, and
 * both were silent — the scope completed, `lastSuccessfulSyncAt` advanced, and every reader
 * downstream was told the league's rules and rosters were current when they were whatever
 * survived from the last genuinely successful run.
 *
 * ⚠ IT IS THROWN AFTER PERSISTENCE, ON PURPOSE. The rows that did succeed are good and stay
 * written; this only denies the scope its completion mark. Rolling back would throw away
 * correct data to punish an unrelated failure.
 *
 * ⚠ AND IT IS DURABLE, so `runner.ts` does not retry it. Re-applying the same payload
 * produces the same incompleteness — the condition is in the data, not in the network, and
 * retrying only spends time to reach the identical answer.
 *
 * The message carries the scope and the reasons and nothing else: it reaches
 * `LeagueSyncState.lastError`, `SyncJobRun.errorMessage` and operator diagnostics, so it must
 * never carry a credential, a league name, or a manager identity.
 */
export class ScopeIncompleteError extends Error {
  readonly scope: string
  readonly reasons: string[]
  /** Tells `runner.ts` this will fail identically on retry — see `isDurableSyncError`. */
  readonly durable = true as const

  constructor(scope: string, reasons: string[]) {
    super(
      `scope "${scope}" persisted what it could but is INCOMPLETE: ${reasons.join('; ')}. ` +
        `Last-good data was preserved and freshness was not advanced.`,
    )
    this.name = 'ScopeIncompleteError'
    this.scope = scope
    this.reasons = reasons
  }
}
