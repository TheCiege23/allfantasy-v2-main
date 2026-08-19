import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { cancelAfLeagueTrade, getAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { prisma } from '@/lib/prisma'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedTradeIntegrationService, extractTradePlayerRefs, type CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/tradeIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const trade = await getAfLeagueTrade(leagueId, tradeId)
  if (!trade) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Gated, informational certified schedule context for the traded players. Analysis surface only — it never
  // changes valuation, fairness, recommendation, or roster reconstruction. Wrapped so it can never fail the read.
  let sportsContext: CertifiedScheduleDescription | undefined
  if (isSportsDataEnabled('trade')) {
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
      if (league && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
        const refs = extractTradePlayerRefs((trade.items ?? []).map((i) => ({ itemType: i.itemType, itemReference: i.itemReference })))
        sportsContext = await new CertifiedTradeIntegrationService().describeTradeSportsContext({
          season: String(league.season ?? new Date().getFullYear()),
          week: String(weekFromLeagueSettingsForLineup(league.settings)),
          players: refs,
        })
      }
    } catch {
      sportsContext = undefined
    }
  }

  return NextResponse.json({ trade, ...(sportsContext ? { sportsContext } : {}) })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  try {
    await cancelAfLeagueTrade({ tradeId, leagueId, userId })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
