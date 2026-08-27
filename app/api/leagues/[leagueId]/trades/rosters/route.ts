import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { listProposablePicks } from '@/lib/league-trade-engine/tradeValidationService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export const dynamic = 'force-dynamic'

export type TradeableRosterPlayer = { id: string; name: string; position: string | null }

/**
 * A pick the picker may offer, already carrying the item type the trade engine
 * expects.
 *
 * ⚠ THE ITEM TYPE IS DECIDED HERE, NOT ON THE CLIENT, because it turns on the
 * league's own season and the client does not have it. Both types are gated by
 * the same `draftPickTradingAllowed` setting today, so the distinction is a
 * label rather than a permission — but it is stored on the trade item and read
 * later, so it should be right rather than uniform.
 */
export type TradeableRosterPick = {
  pickId: string
  season: number | null
  round: number | null
  label: string
  itemType: 'rookie_pick' | 'future_pick'
}
export type TradeableRoster = {
  rosterId: string
  platformUserId: string
  players: TradeableRosterPlayer[]
  /**
   * Picks with a stored id. A pick without one cannot be referenced by a
   * proposal at all — see `listProposablePicks`, which the engine's own
   * ownership check uses, so this list and that check cannot disagree.
   */
  picks: TradeableRosterPick[]
  /**
   * `LeagueTeam.externalId` for this roster's owner.
   *
   * This is the id the trade analyzer means by `opponentTeamExternalId`, and
   * without it the counterparty layer — their roster holes, the waiver wire
   * they would replace from, how they have historically paid for the position —
   * never runs. It is NOT `rosterId` and it is NOT `platformUserId`.
   */
  teamExternalId: string | null
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

  /* The league's own season decides rookie-vs-future on every pick below. */
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { season: true } })
    .catch(() => null)
  const currentSeason = Number(league?.season) || null

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
      .findMany({
        where: { leagueId },
        select: { platformUserId: true, teamName: true, externalId: true },
      })
      .catch(() => []),
  ])
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const namedTeams = teams.filter(
    (t) => typeof t.platformUserId === 'string' && t.platformUserId.length > 0,
  )
  const teamNameByPlatformId = new Map(
    namedTeams.map((t) => [String(t.platformUserId), t.teamName]),
  )
  const externalIdByPlatformId = new Map(
    namedTeams.map((t) => [String(t.platformUserId), String(t.externalId)]),
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
        picks: listProposablePicks(r.playerData).map((p) => ({
          ...p,
          itemType:
            currentSeason != null && p.season != null && p.season > currentSeason
              ? ('future_pick' as const)
              : ('rookie_pick' as const),
        })),
        teamExternalId: externalIdByPlatformId.get(r.platformUserId) ?? null,
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
   * ⚠ TWO DIFFERENT QUESTIONS, AND ANSWERING BOTH WITH ONE FIELD IS A BUG.
   *
   * `viewerRosterId` — CAN I PROPOSE FROM THIS ROSTER. `createAfLeagueTrade`
   * throws unless `proposer.platformUserId` equals the proposing user id, so
   * this uses that exact equality and nothing looser. Anything looser lights up
   * a Propose button the write then refuses.
   *
   * `viewerTeamRosterId` — WHICH TEAM IS MINE ON SCREEN. On an imported league
   * `Roster.platformUserId` holds the SLEEPER user id, so the strict predicate
   * above is null for every imported league in the product. A UI that filtered
   * "everyone but me" by it filtered nothing, and offered the manager their own
   * team as a trade partner. This resolves identity the way the rest of the
   * league surfaces do — claimed LeagueTeam first, then the linked Sleeper id.
   *
   * They are deliberately separate fields. Collapsing them either breaks the
   * counterparty list on imports or breaks the propose gate on natives.
   */
  const viewerRosterId = rosters.find((r) => r.platformUserId === userId) ?? null

  const identityIds = await (async () => {
    const ids = new Set<string>([userId])
    const claimed = await prisma.leagueTeam
      .findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: { platformUserId: true },
      })
      .catch(() => null)
    if (claimed?.platformUserId) ids.add(claimed.platformUserId)
    const profile = await prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
    if (profile?.sleeperUserId) ids.add(profile.sleeperUserId)
    return ids
  })()

  const viewerTeamRosterId =
    viewerRosterId?.id ?? rosters.find((r) => identityIds.has(r.platformUserId))?.id ?? null

  return NextResponse.json({
    rosters: result,
    viewerRosterId: viewerRosterId?.id ?? null,
    viewerTeamRosterId,
  })
}
