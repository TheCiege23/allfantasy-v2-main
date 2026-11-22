import type { SGExpansion } from './types'

/** Absolute layouts make retries and catch-up safe; previously applied increments never compound. */
export function sgRosterAtPeriod(expansion: SGExpansion, period: number, inheritedBench: number) {
  const slots: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 }
  let bench = expansion.openingBenchSlots ?? inheritedBench
  for (const step of expansion.steps) if (step.period <= period) {
    slots[step.slot] = (slots[step.slot] ?? 0) + step.count
    bench += expansion.benchPerExpansion
  }
  return { slots, bench, starters: Object.values(slots).reduce((a, b) => a + b, 0),
    next: expansion.steps.find(step => step.period > period) ?? null }
}
