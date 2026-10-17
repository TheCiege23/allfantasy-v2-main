import { prepareSeasonOpeningRosters } from '@/lib/tournament/seasonRosterPreparation'
import { reviewSeasonOpeningDraft } from '@/lib/tournament/seasonOpeningReadiness'
import { checkSeasonDraftReadiness } from '@/lib/tournament/seasonDraftReadiness'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { loadSeasonNativeSetup, provisionNextSeasonLeague } from '@/lib/tournament/seasonNativeProvisioning'
import { reviewSeasonPublishedSchedule } from '@/lib/tournament/seasonScheduleReview'
import { sampleSeasonGameStart } from '@/lib/tournament/seasonActualStartStore'
import { reviewSeasonPeriodLiveFeed } from '@/lib/tournament/seasonPeriodLiveReview'
import { releaseSeasonOpeningDraft } from '@/lib/tournament/seasonDraftRelease'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const id = z.string().trim().min(1).max(200)
const command = z.object({ action: z.enum(['provision', 'check_draft', 'review_draft', 'prepare_rosters', 'review_schedule', 'observe_start', 'refresh_period', 'release_draft']).default('provision'), tournamentId: id, freezeId: id, key: id.optional(), gameId: id.optional(), period: z.number().int().positive().optional() })
async function user() { const s = await getServerSession(authOptions as never) as { user?: { id?: string } } | null; return s?.user?.id }
function failure(e: unknown) {
  if (e instanceof BlueprintOperationError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof z.ZodError) return NextResponse.json({ error: 'Check the opening setup fields.' }, { status: 400 })
  return NextResponse.json({ error: 'Opening setup failed. Retry to resume from saved progress.' }, { status: 500 })
}
const privateHeaders = { 'Cache-Control': 'no-store' }
export async function GET(req: NextRequest) {
  const userId = await user()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ setup: await loadSeasonNativeSetup(userId, id.parse(req.nextUrl.searchParams.get('tournamentId'))) }, { headers: privateHeaders }) } catch (e) { return failure(e) }
}
export async function POST(req: NextRequest) {
  const userId = await user()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    let raw: unknown
    try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const input = command.parse(raw)
    if (input.action === 'release_draft') {
      if (!input.key) return NextResponse.json({ error: 'Select a frozen opening league.' }, { status: 400 })
      return NextResponse.json(await releaseSeasonOpeningDraft(userId, input.tournamentId, input.freezeId, input.key), { headers: privateHeaders })
    }
    if (input.action === 'review_schedule') return NextResponse.json(await reviewSeasonPublishedSchedule(userId, input.tournamentId, input.freezeId), { headers: privateHeaders })
    if (input.action === 'refresh_period') {
      if (!input.period) return NextResponse.json({ error: 'Choose a published scoring period.' }, { status: 400 })
      return NextResponse.json(await reviewSeasonPeriodLiveFeed(userId, input.tournamentId, input.freezeId, input.period, input.key), { headers: privateHeaders })
    }
    if (input.action === 'observe_start') {
      if (!input.gameId) return NextResponse.json({ error: 'Choose a published game.' }, { status: 400 })
      return NextResponse.json(await sampleSeasonGameStart(userId, input.tournamentId, input.freezeId, input.gameId), { headers: privateHeaders })
    }
    if (input.action === 'prepare_rosters') {
      if (!input.key) return NextResponse.json({ error: 'Select an opening league.' }, { status: 400 })
      return NextResponse.json(await prepareSeasonOpeningRosters(userId, input.tournamentId, input.freezeId, input.key), { headers: privateHeaders })
    }
    if (input.action === 'review_draft') {
      if (!input.key) return NextResponse.json({ error: 'Select an opening league.' }, { status: 400 })
      return NextResponse.json(await reviewSeasonOpeningDraft(userId, input.tournamentId, input.freezeId, input.key), { headers: privateHeaders })
    }
    if (input.action === 'check_draft') return NextResponse.json(await (input.key ? checkSeasonDraftReadiness(userId, input.tournamentId, input.freezeId, input.key) : checkSeasonDraftReadiness(userId, input.tournamentId, input.freezeId)), { headers: privateHeaders })
    return NextResponse.json(await provisionNextSeasonLeague(userId, input.tournamentId, input.freezeId, input.key), { headers: privateHeaders })
  } catch (e) { return failure(e) }
}
