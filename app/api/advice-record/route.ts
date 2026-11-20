import { NextResponse } from 'next/server'
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { ledgerRecordFor } from '@/lib/chimmy-outcomes/ledgerRecord'
import { inactiveFlagView } from '@/lib/commissioner-hub/inactiveFlagView'

/**
 * GET /api/advice-record — AllFantasy's graded record across everyone: My Team's bench check, the waiver
 * panel's #1 pickup and the trade letters (`lib/chimmy-outcomes/ledgerRecord.ts`). The advice surfaces show
 * it beside their own call (`lib/chimmy-outcomes/engineRecord.ts`).
 *
 * Counts only: the per-user map is dropped before the view is built, so no one's own calls leave here. The
 * read is the outcome snapshot's one cache row (rebuilt every six hours by the maintenance cron), memoised
 * per instance — no provider, no per-request work.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const snapshot = await readAdviceLearningSnapshot()
  const ledger = snapshot?.ledger
  const record = ledger ? ledgerRecordFor({ ...ledger, users: {} }, null) : null
  // The commissioner "inactive" flag's record: counts only, across every native league.
  const inactiveFlags = inactiveFlagView(snapshot?.inactiveFlags)
  return NextResponse.json(
    { record, inactiveFlags },
    { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
  )
}
