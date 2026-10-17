import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { buildCommissionerSetupChecklist } from '@/lib/league/commissioner-setup-checklist'

export const dynamic = 'force-dynamic'

/** Read committed setup only; opening the checklist never creates or starts a draft. */
export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { leagueId } = await ctx.params
    await requireCommissionerRole(leagueId, userId)
    const [league, settings, draft, roster, rosters] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: {
        leagueSize: true, scoring: true, scoringPresetId: true, settings: true,
        teams: { select: { claimedByUserId: true, platformUserId: true, isOrphan: true } },
      } }),
      prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true } }),
      prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { draftType: true, rounds: true, slotOrder: true } }),
      getEffectiveLeagueRosterTemplate(leagueId),
      prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    ])
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    const json = (league.settings ?? {}) as Record<string, unknown>
    const scoringConfigured = [league.scoring, league.scoringPresetId, json.scoring_format, json.scoring_format_type]
      .some(value => typeof value === 'string' && value.trim().length > 0)
    const rosterConfigured = roster.hasPersistedRosterSchema && roster.template.slots.some(slot =>
      [slot.starterCount, slot.benchCount, slot.reserveCount, slot.taxiCount, slot.devyCount].some(count => (count ?? 0) > 0))
    return NextResponse.json(buildCommissionerSetupChecklist({
      teamCount: league.leagueSize ?? league.teams.length, teams: league.teams,
      rosterConfigured, scoringConfigured, rosterIds: rosters.map(row => row.id), draft,
      draftDate: settings?.draftDateUtc?.toISOString() ?? null,
    }), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('[setup/checklist] Failed to load setup', error)
    return NextResponse.json({ error: 'Could not load league setup' }, { status: 500 })
  }
}
