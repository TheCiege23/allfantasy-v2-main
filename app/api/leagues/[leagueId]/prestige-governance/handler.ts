import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import {
  buildAIPrestigeContext,
  buildPrestigeGovernanceSnapshot,
  getUnifiedManagerSummary,
  getUnifiedTeamSummary,
} from '@/lib/prestige-governance'

export const dynamic = 'force-dynamic'

function parseBoolean(value: string | null | undefined, fallback = false): boolean {
  if (value == null) return fallback
  const next = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(next)) return true
  if (['0', 'false', 'no', 'off'].includes(next)) return false
  return fallback
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const sport = url.searchParams?.get('sport') ?? undefined
    const managerId = String(url.searchParams?.get('managerId') ?? '').trim()
    const entityType = String(url.searchParams?.get('entityType') ?? '').trim().toUpperCase()
    const entityId = String(url.searchParams?.get('entityId') ?? '').trim()
    const includeSnapshot = parseBoolean(url.searchParams?.get('includeSnapshot'), true)
    const summaryLimit = Number.parseInt(url.searchParams?.get('summaryLimit') ?? '12', 10)

    const commissioner = await isCommissioner(leagueId, userId)
    const aiContext = await buildAIPrestigeContext(leagueId, sport)

    const [snapshot, managerSummary, teamSummary] = await Promise.all([
      includeSnapshot && commissioner
        ? buildPrestigeGovernanceSnapshot(leagueId, {
            sport,
            limitSummaries:
              Number.isFinite(summaryLimit) && !Number.isNaN(summaryLimit)
                ? Math.max(1, Math.min(summaryLimit, 30))
                : 12,
          })
        : Promise.resolve(null),
      managerId ? getUnifiedManagerSummary(leagueId, managerId, aiContext.sport).catch(() => null) : Promise.resolve(null),
      entityId && (entityType === 'TEAM' || entityType === 'FRANCHISE')
        ? getUnifiedTeamSummary(leagueId, entityId, entityType, aiContext.sport).catch(() => null)
        : Promise.resolve(null),
    ])

    return NextResponse.json({
      leagueId,
      sport: aiContext.sport,
      aiContext,
      commissionerContext: commissioner ? snapshot?.commissionerContext ?? undefined : undefined,
      snapshot: commissioner ? snapshot ?? undefined : undefined,
      managerSummary,
      teamSummary,
    })
  } catch (e) {
    console.error('[prestige-governance GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load prestige governance context' },
      { status: 500 }
    )
  }
}
