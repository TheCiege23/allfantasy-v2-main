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
export type TradeableRoster = {
  rosterId: string
  platformUserId: string
  players: TradeableRosterPlayer[]
  /** Team name where the league has one, else the AllFantasy account's name. */
  ownerName: string | null
  /**
   * True only when `platformUserId` is an AllFantasy account id.
   *
   * ⚠ THIS IS THE WHOLE REACH QUESTION FOR A NATIVE PROPOSAL. `platformUserId`
   * holds an AF user id on native leagues and the SLEEPER user id on imported
   * ones, so on an imported league nobody here is reachable — a proposal would
   * be written to a row the counterparty can never open. False means "do not
   * offer to send them anything", not "this roster is unimportant".
   */
  canReceiveProposal: boolean
}

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

  /*
   * Who among these rosters is an actual AllFantasy account, and what to call
   * them. Two lookups rather than one because the two facts come from different
   * places: reachability is an AppUser row, the NAME is the league's own team
   * name where it has one.
   */
  const platformIds = [...new Set(rosters.map((r) => r.platformUserId).filter(Boolean))]
  const [accounts, teams] = await Promise.all([
    prisma.appUser
      .findMany({
        where: { id: { in: platformIds } },
        select: { id: true, displayName: true, username: true },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({ where: { leagueId }, select: { platformUserId: true, teamName: true } })
      .catch(() => []),
  ])
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const teamNameByPlatformId = new Map(
    teams
      .filter((t) => typeof t.platformUserId === 'string' && t.platformUserId.length > 0)
      .map((t) => [String(t.platformUserId), t.teamName]),
  )

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
      const account = accountById.get(r.platformUserId)
      return {
        rosterId: r.id,
        platformUserId: r.platformUserId,
        players,
        ownerName:
          teamNameByPlatformId.get(r.platformUserId) ||
          account?.displayName ||
          account?.username ||
          null,
        canReceiveProposal: Boolean(account),
      }
    }),
  )

  /*
   * ⚠ THE SAME PREDICATE THE ENGINE ENFORCES, NOT A LOOSER ONE.
   * `createAfLeagueTrade` throws unless `proposer.platformUserId` equals the
   * proposing user id. Resolving the viewer's roster any other way — by claimed
   * team, by linked Sleeper id — would light up a Propose button that the write
   * then refuses, which is the failure mode worth avoiding most.
   */
  const viewerRosterId = rosters.find((r) => r.platformUserId === userId)?.id ?? null

  return NextResponse.json({ rosters: result, viewerRosterId })
}
