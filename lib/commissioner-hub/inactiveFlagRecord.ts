import 'server-only'

import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { INACTIVE_FLAG_HELD_UP, INACTIVE_FLAG_LOW, inactiveFlagPrecision } from '@/lib/decision-os/commissioner-health/rules'
import { inactiveFlagView, type InactiveFlagView } from './inactiveFlagView'

/**
 * The commissioner "inactive" flag's graded record, read ONCE for every surface that tunes its warning by it — Chimmy's
 * health decision (`grounding/decisionBridge.ts`) and the hub's flag (`lib/core-app/commissionerHub.ts`) — so the two
 * can never quote different numbers (2026-11-20). Memoised by its store. Null on any failure.
 */
export async function loadInactiveFlagRecord(): Promise<InactiveFlagView | null> {
  const snapshot = await readAdviceLearningSnapshot().catch(() => null)
  return inactiveFlagView(snapshot?.inactiveFlags)
}

export type InactiveFlagStanding = 'held_up' | 'mixed' | 'low'

/** What the hub's flag needs: the counts and which of the decision's three bands the record falls in. */
export type InactiveFlagHubRecord = { standing: InactiveFlagStanding; stayedAway: number; graded: number }

/**
 * PURE. The record as the hub's flag uses it, by the SAME precision and thresholds the health decision applies
 * (`commissioner-health/rules.ts`). Null under the record's floor, when the warning reads exactly as before.
 */
export function inactiveFlagHubRecord(record: InactiveFlagView | null | undefined): InactiveFlagHubRecord | null {
  const precision = inactiveFlagPrecision(record)
  if (precision == null || !record) return null
  const standing: InactiveFlagStanding = precision >= INACTIVE_FLAG_HELD_UP ? 'held_up' : precision >= INACTIVE_FLAG_LOW ? 'mixed' : 'low'
  return { standing, stayedAway: record.stayedAway, graded: record.graded }
}
