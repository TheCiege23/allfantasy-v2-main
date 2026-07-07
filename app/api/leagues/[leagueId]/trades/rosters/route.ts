import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export const dynamic = 'force-dynamic'

export type TradeableRosterPlayer = { id: string; name: string; position: string | null }
export type TradeableRoster = { rosterId: string; platformUserId: string; players: TradeableRosterPlayer[] }

/**
 * Every roster's tradeable player list, for the native trade-proposal UI. Gated by league
 * membership (not the narrower owner-only check on `/api/league/roster?userId=`) since roster
 * composition is not sensitive within a league — every member can already see opponents' lineups
 * on the Matchups tab.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, playerData: true },
  })

  const result: TradeableRoster[] = await Promise.all(
    rosters.map(async (r) => {
      const playerIds = getRosterPlayerIds(r.playerData)
      let players: TradeableRosterPlayer[] = playerIds.map((id) => ({ id, name: id, position: null }))
      try {
        const rows = await getNormalizedPlayerData({
          surface: 'roster',
          leagueId,
          userId: r.platformUserId,
          limit: 200,
        })
        const byId = new Map(rows.map((row) => {
          const dto = serializeUnifiedPlayerForApi(row)
          return [dto.id, dto] as const
        }))
        players = playerIds.map((id) => {
          const enriched = byId.get(id)
          return { id, name: enriched?.name ?? id, position: enriched?.position ?? null }
        })
      } catch {
        // Enrichment is best-effort; fall back to raw ids (matches the placeholder
        // convention already used elsewhere when player metadata isn't available).
      }
      return { rosterId: r.id, platformUserId: r.platformUserId, players }
    }),
  )

  return NextResponse.json({ rosters: result })
}
