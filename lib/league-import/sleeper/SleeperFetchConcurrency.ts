import pLimit from 'p-limit'

/**
 * Keep provider fan-out small enough for bulk imports while allowing independent
 * league weeks and draft boards to overlap.
 */
export const SLEEPER_HISTORY_FETCH_CONCURRENCY = 4
export const SLEEPER_DRAFT_FETCH_CONCURRENCY = 4

/** Shared across concurrently imported leagues so their individual lanes cannot multiply unchecked. */
const sleeperHistoricalRequestLimit = pLimit(8)

export function withSleeperHistoricalRequestLimit<T>(work: () => Promise<T>): Promise<T> {
  return sleeperHistoricalRequestLimit(work)
}
