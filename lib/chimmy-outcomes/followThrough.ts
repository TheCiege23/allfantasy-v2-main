/**
 * DID YOU TAKE CHIMMY'S ADVICE — explicit votes and what the platform shows, as one tally.
 *
 * User decision 2026-09-16 ("Buttons + inferred"): the /core drawer's "Did it / Not doing it"
 * buttons record `recommendation_accepted` / `recommendation_rejected` with the advice's key, and
 * the outcome loop infers the rest from Sleeper (`learningSnapshot.ts`).
 *
 * 🛑 ONE VOTE PER PIECE OF ADVICE. Tapping "Did it" twice, changing your mind, or tapping it for
 * an add Sleeper also shows you made is still one piece of advice:
 * - explicit votes are read newest first, and only the newest per key counts;
 * - an inferred verdict counts only for a key you did not vote on — you know better than a sync;
 * - an event with no key (older surfaces) counts on its own, as it always did.
 *
 * Each vote is weighted by age (BEHAVIOR_HALF_LIFE_DAYS), and the minimum sample stays a count of
 * real votes — see `shrunkWeightedRate`.
 */

import { MAX_ADVICE_KEY_LENGTH } from '@/lib/chimmy-advice/adviceKeys'
import { decayWeight } from './shrinkage'

export const BEHAVIOR_HALF_LIFE_DAYS = 60

export const ACCEPTED_EVENT = 'chimmy_recommendation_accepted'
export const REJECTED_EVENT = 'chimmy_recommendation_rejected'

export type FeedbackEventRow = { actionType: string; result: unknown; createdAt?: Date | null }

export type FollowThroughTally = {
  /** Decayed weight of accepted and rejected votes, and of both. */
  accepted: number
  rejected: number
  total: number
  /** Votes counted, before weighting. */
  rawN: number
  /** How many of those came from the platform rather than a button. */
  inferred: number
}

export function adviceKeyOf(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const key = (result as Record<string, unknown>).adviceKey
  if (typeof key !== 'string') return null
  const trimmed = key.trim()
  return trimmed && trimmed.length <= MAX_ADVICE_KEY_LENGTH ? trimmed : null
}

export function tallyFollowThrough(
  /** Newest first, as `aIUserFeedback` is read. */
  events: readonly FeedbackEventRow[],
  inferred: ReadonlyArray<{ key: string; followed: boolean; weight: number }>,
  now: Date,
): FollowThroughTally {
  const tally: FollowThroughTally = { accepted: 0, rejected: 0, total: 0, rawN: 0, inferred: 0 }
  const voted = new Set<string>()
  const add = (accepted: boolean, weight: number) => {
    const w = Number.isFinite(weight) && weight >= 0 ? weight : 1
    if (accepted) tally.accepted += w
    else tally.rejected += w
    tally.total += w
    tally.rawN += 1
  }

  for (const e of events) {
    const accepted = e.actionType === ACCEPTED_EVENT
    if (!accepted && e.actionType !== REJECTED_EVENT) continue
    const key = adviceKeyOf(e.result)
    if (key) {
      if (voted.has(key)) continue
      voted.add(key)
    }
    const at = e.createdAt instanceof Date ? e.createdAt.getTime() : Number.NaN
    add(accepted, decayWeight((now.getTime() - at) / 86_400_000, BEHAVIOR_HALF_LIFE_DAYS))
  }

  for (const v of inferred) {
    if (!v.key || voted.has(v.key)) continue
    voted.add(v.key)
    add(v.followed, v.weight)
    tally.inferred += 1
  }
  return tally
}
