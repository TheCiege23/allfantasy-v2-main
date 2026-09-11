/**
 * The undersized-target ratchet's comparison, as a pure function.
 *
 * WHY THIS IS NOT INLINE IN THE SPEC ANY MORE. It was, and the regression half
 * could not be proven. Forcing it red needs a browser, a dev server, a database
 * and a page that happens to contain a control nobody has baselined — and three
 * attempts to arrange that were each defeated by the environment rather than by
 * the code: MSYS rewrote a `--grep` argument into a Windows path so
 * `Error: No tests found` exited 1 and read like a result, then a dev-server 500
 * failed the run before the assertion, then the box got too slow to finish.
 *
 * 🛑 A CHECK THAT HAS NEVER BEEN SEEN RED IS NOT EVIDENCE, and a control that
 * can only be run when four moving parts cooperate will not be run. Pulling the
 * decision out to a pure function makes both branches provable in milliseconds,
 * deterministically, with no browser and no network — see
 * `__tests__/mobile/target-ratchet.test.ts`.
 *
 * ⚠ AND A UNIT TEST OF THIS FILE DOES NOT PROVE THE SPEC USES IT. That is the
 * "helper tests pass on an unwired feature" trap. The spec imports `compareTargets`
 * and asserts on what it returns, so the two move together; if anyone reinlines
 * the logic, the unit test keeps passing while protecting nothing. The wiring is
 * held by the spec importing this module and nothing else.
 */

/** A control measured as under the minimum tap size, in the first phone screen. */
export type MeasuredTarget = {
  tag: string
  cls: string
  label: string
  w: number
  h: number
}

/** One line of `undersized-target-baseline.json`. */
export type BaselineTarget = {
  cls: string
  label: string
  /** Recorded for the reader; deliberately NOT part of the identity. */
  seen?: string
}

export type RatchetResult = {
  /** Undersized now, and not baselined: a NEW defect. Fails the gate. */
  regressions: MeasuredTarget[]
  /** Baselined, but no longer undersized: a dead entry. Also fails the gate. */
  stale: string[]
}

/*
 * Identity is class + label, NOT size.
 *
 * Size is excluded on purpose: a baselined control that shrinks further must
 * still match its entry, or every CSS tweak to known debt would read as a brand
 * new defect and push people to re-baseline — which is how a ratchet turns into
 * a rubber stamp. Shrinkage is real but it is not what this gate is for.
 */
export function targetKey(t: { cls: string; label: string }): string {
  return `${t.cls}|${t.label}`
}

export function compareTargets(
  found: readonly MeasuredTarget[],
  baseline: readonly BaselineTarget[],
): RatchetResult {
  const known = new Set(baseline.map(targetKey))
  const stillSmall = new Set(found.map(targetKey))

  return {
    regressions: found.filter((t) => !known.has(targetKey(t))),
    stale: [...known].filter((k) => !stillSmall.has(k)),
  }
}
