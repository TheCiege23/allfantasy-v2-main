/**
 * Commissioner: start a dynasty league's next season.
 *
 * POST { skipRookieDraft?: boolean } — ensures next season and its carried rosters exist, then
 *   activates it: through the rookie draft when that is complete, or directly when the
 *   commissioner skips the rookie draft. Refused while a draft is open. Idempotent: a season that
 *   is already running returns `via: 'already_active'` and changes nothing.
 * GET — the last rollover's housekeeping (taxi/IR players moved to the bench, teams over the
 *   roster limit) for the commissioner panel.
 *
 * Gated as `settings_edit_commissioner`, the same gate "Create next season's draft" uses, because
 * both are commissioner actions taken from the offseason.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { startDynastyNewSeason, type StartNewSeasonCode } from '@/lib/redraft/offseason/startDynastyNewSeason'
import { DYNASTY_ROLLOVER_METADATA_KEY } from '@/lib/redraft/offseason/dynastyRolloverHousekeeping'

export const dynamic = 'force-dynamic'

function statusFor(code: StartNewSeasonCode): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'ACTIVATION_FAILED') return 500
  return 409
}

async function gate(ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { leagueId } = await ctx.params
  if (!leagueId) return { error: NextResponse.json({ error: 'Missing leagueId' }, { status: 400 }) }
  const allowed = await assertLeagueActionGate(leagueId, userId, 'settings_edit_commissioner')
  if (!allowed.ok) {
    return { error: NextResponse.json({ error: allowed.err.error, code: allowed.err.code }, { status: allowed.err.status }) }
  }
  return { leagueId, userId }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const league = await prisma.league.findUnique({ where: { id: g.leagueId }, select: { lifecycleMetadata: true } })
  const meta = league?.lifecycleMetadata
  const rollover =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? ((meta as Record<string, unknown>)[DYNASTY_ROLLOVER_METADATA_KEY] ?? null)
      : null
  return NextResponse.json({ ok: true, rollover })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({}))
  try {
    const result = await startDynastyNewSeason(g.leagueId, g.userId, { skipRookieDraft: body?.skipRookieDraft === true })
    if (!result.ok) {
      return NextResponse.json({ error: result.message, code: result.code }, { status: statusFor(result.code) })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('[season/start-new] failed', { leagueId: g.leagueId, error })
    return NextResponse.json({ error: 'Could not start the new season.' }, { status: 500 })
  }
}
