import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { handleStatCorrection } from '@/lib/guillotine/statCorrectionHandler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Manually re-check one chopped period's stat corrections (`handleStatCorrection`): the same pass
 * score-sync runs hourly, past its window and throttle. By the published policy it updates the
 * period's scores, running totals and survival history and NEVER reverses the chop or a champion —
 * `reversed` is always false; a chop the corrected scores would have changed is logged for the
 * commissioner instead.
 */

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { seasonId?: string; scoringPeriod?: number; correctedPlayerIds?: string[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.seasonId || body.scoringPeriod == null || !body.correctedPlayerIds) {
    return NextResponse.json({ error: 'seasonId, scoringPeriod, correctedPlayerIds required' }, { status: 400 })
  }

  const result = await handleStatCorrection(body.seasonId, body.scoringPeriod, body.correctedPlayerIds)
  return NextResponse.json(result)
}
