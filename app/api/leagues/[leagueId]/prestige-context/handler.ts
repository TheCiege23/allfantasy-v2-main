/**
 * GET /api/leagues/[leagueId]/prestige-context
 * Returns unified prestige and governance context for AI and commissioner dashboards.
 * Query: sport (optional). If user is commissioner, includes commissionerTrustContext.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { buildAIPrestigeContext } from '@/lib/prestige-governance/AIPrestigeContextResolver'
import { buildCommissionerTrustContext } from '@/lib/prestige-governance/CommissionerTrustBridge'
import { buildPrestigeGovernanceSnapshot } from '@/lib/prestige-governance/PrestigeGovernanceOrchestrator'

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

    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const sport = url.searchParams?.get('sport') ?? undefined
    const includeSnapshot = parseBoolean(url.searchParams?.get('includeSnapshot'), false)
    const summaryLimit = Number.parseInt(url.searchParams?.get('summaryLimit') ?? '12', 10)

    const isComm = await isCommissioner(leagueId, userId)

    const commissionerContext = isComm
      ? await buildCommissionerTrustContext(leagueId, { sport })
      : null
    const aiContext = await buildAIPrestigeContext(leagueId, sport, {
      commissionerContext,
    })

    let snapshot:
      | {
          commissionerContext: unknown
          sampleManagerSummaries: unknown[]
          aiContext: unknown
        }
      | undefined
    if (includeSnapshot) {
      const built = await buildPrestigeGovernanceSnapshot(leagueId, {
        sport,
        limitSummaries:
          Number.isFinite(summaryLimit) && !Number.isNaN(summaryLimit)
            ? Math.max(1, Math.min(summaryLimit, 30))
            : 12,
      })
      snapshot = {
        commissionerContext: built.commissionerContext,
        sampleManagerSummaries: built.sampleManagerSummaries,
        aiContext: built.aiContext,
      }
    }

    return NextResponse.json({
      leagueId,
      sport: aiContext.sport,
      aiContext: {
        governanceSummary: aiContext.governanceSummary,
        reputationSummary: aiContext.reputationSummary,
        legacySummary: aiContext.legacySummary,
        hallOfFameSummary: aiContext.hallOfFameSummary,
        combinedHint: aiContext.combinedHint,
      },
      commissionerContext: commissionerContext ?? undefined,
      snapshot,
    })
  } catch (e) {
    console.error('[prestige-context GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load prestige context' },
      { status: 500 }
    )
  }
}
