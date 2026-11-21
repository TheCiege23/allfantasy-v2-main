import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { liveLeagueRosters } from '@/lib/sleeper/liveLeagueFeed'
import { connectedRosterPlayers, type ConnectedRosterPlayer } from '@/lib/core-app/connectedRoster'
import { resolvePairedHalf } from '@/lib/core-app/leaguePairing'
import {
  buildFantraxLists,
  buildSleeperLists,
  type CollegeProLists,
  type CollegeProPlayer,
  type CollegeProRole,
} from './buildSides'
import { decideLeadSide, type LeadReason, type LeadSide } from './leadSide'
import { collegeProFormatOf, collegeSportFor, type CollegeProFormat } from './format'

export type { CollegeProFormat }

/**
 * One roster page for a league that is really two: the pro half and the college half.
 *
 * The owner's ask (2026-11-21): "make these 2 separate leagues feel like 1 league. The top half should
 * show the Pros lineup while the bottom half shows the college lineup." Peach Bowl (C2C) is a Sleeper
 * league whose college half, Cream Bowl, lives on Fantrax. The two are already joined by a
 * `FranchiseLink` (see lib/core-app/leaguePairing.ts), which this reads rather than re-deriving.
 *
 * Applies to a SLEEPER league that is either typed devy / C2C or is the pro half of a franchise
 * with a college half. Every other league answers `applies: false`, and the page keeps its old view.
 */

export type CollegeProSide = CollegeProLists & {
  role: CollegeProRole
  sport: string
  platform: string
  leagueName: string
  teamLabel: string | null
  /** AllFantasy league page for this half, when it has one. */
  leagueHref: string | null
  players: Record<string, CollegeProPlayer>
  /** Why this half's lineup cannot be shown, in words a manager can act on. Null when it can. */
  unavailable: string | null
}

export type CollegeProRosterPayload =
  | { applies: false }
  | {
      applies: true
      format: CollegeProFormat
      lead: LeadSide
      leadReason: LeadReason
      /** Pro first or college first, already ordered for the page. */
      sides: CollegeProSide[]
      fetchedAt: string
    }

const toPlayerMap = (players: ConnectedRosterPlayer[]): Record<string, CollegeProPlayer> =>
  Object.fromEntries(
    players.map((p) => [p.id, { id: p.id, name: p.name, position: p.position, team: p.team, imageUrl: p.imageUrl, logoUrl: p.logoUrl }]),
  )

const emptyLists = (): CollegeProLists => ({ starters: [], bench: [], taxi: [], ir: [] })

export async function loadCollegeProRoster(leagueId: string, userId: string, now = new Date()): Promise<CollegeProRosterPayload> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId, OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
    select: { id: true, name: true, platform: true, platformLeagueId: true, leagueType: true, leagueVariant: true, sport: true },
  })
  if (!league || league.platform !== 'sleeper' || !league.platformLeagueId) return { applies: false }

  const paired = await resolvePairedHalf(leagueId, userId, { includeOperationalSummary: false }).catch(() => null)
  const collegeHalf = paired?.sides.find((s) => s.role === 'college') ?? null
  const typed = collegeProFormatOf(league)
  if (!typed && !collegeHalf) return { applies: false }
  // A pro league paired to a college league scores both halves, which is the C2C shape.
  const format: CollegeProFormat = typed ?? 'c2c'

  const proSport = String(league.sport ?? 'NFL').toUpperCase()
  const collegeSport = collegeHalf?.sport ? String(collegeHalf.sport).toUpperCase() : collegeSportFor(proSport)

  const [pro, games] = await Promise.all([
    loadSleeperProSide(league, userId),
    loadTodaysGames([proSport, collegeSport], now),
  ])

  const college: CollegeProSide = collegeHalf
    ? (() => {
        const players = collegeHalf.players ?? []
        const lists = buildFantraxLists(players.map((p) => ({ id: p.id, slot: p.rosterSlot ?? null, status: p.rosterStatus ?? null })))
        const hasSlots = players.some((p) => p.rosterStatus)
        return {
          role: 'college' as const,
          sport: collegeSport,
          platform: collegeHalf.platform,
          leagueName: collegeHalf.name,
          teamLabel: collegeHalf.teamLabel,
          leagueHref: collegeHalf.leagueId ? `/league/${collegeHalf.leagueId}` : null,
          // An older snapshot carries players but no lineup status: show everyone on the bench, and say so.
          ...(hasSlots ? lists : { ...emptyLists(), bench: players.map((p) => p.id) }),
          players: toPlayerMap(players),
          unavailable:
            collegeHalf.unavailableReason ??
            (players.length === 0
              ? 'Your college roster could not be read from the linked league.'
              : hasSlots
                ? null
                : 'This college roster was imported before lineups were saved. Refresh the college league to see your starters.'),
        }
      })()
    : {
        role: 'college',
        sport: collegeSport,
        platform: 'fantrax',
        leagueName: 'College league',
        teamLabel: null,
        leagueHref: null,
        ...emptyLists(),
        players: {},
        unavailable: 'Link your college league to see both lineups on one page.',
      }

  const { lead, reason } = decideLeadSide({ now, proSport, collegeSport, games })
  return {
    applies: true,
    format,
    lead,
    leadReason: reason,
    sides: lead === 'college' ? [college, pro] : [pro, college],
    fetchedAt: now.toISOString(),
  }
}

async function loadSleeperProSide(
  league: { id: string; name: string | null; platformLeagueId: string | null; sport: string | null },
  userId: string,
): Promise<CollegeProSide> {
  const base = {
    role: 'pro' as const,
    sport: String(league.sport ?? 'NFL').toUpperCase(),
    platform: 'sleeper',
    leagueName: league.name ?? 'Pro league',
    teamLabel: null,
    leagueHref: `/league/${league.id}`,
  }
  const sid = league.platformLeagueId ?? ''
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } }).catch(() => null)
  if (!profile?.sleeperUserId) {
    return { ...base, ...emptyLists(), players: {}, unavailable: 'Connect your Sleeper account to see your pro lineup.' }
  }
  const [context, rosters] = await Promise.all([getLeagueContext(sid), liveLeagueRosters(sid)])
  if (!rosters) return { ...base, ...emptyLists(), players: {}, unavailable: 'Sleeper did not answer. Try again in a minute.' }
  const mine = rosters.find((r) => r.owner_id === profile.sleeperUserId || (r.co_owners ?? []).includes(profile.sleeperUserId!))
  if (!mine) return { ...base, ...emptyLists(), players: {}, unavailable: 'Your Sleeper account does not own a team in this league.' }

  const lists = buildSleeperLists({
    positions: context?.roster.positions ?? [],
    starters: mine.starters,
    players: mine.players,
    taxi: mine.taxi,
    reserve: mine.reserve,
  })
  const ids = [
    ...new Set([
      ...lists.starters.map((s) => s.playerId).filter((id): id is string => !!id),
      ...lists.bench,
      ...lists.taxi,
      ...lists.ir,
    ]),
  ]
  const players = await connectedRosterPlayers('sleeper', base.sport, ids).catch(() => [])
  return { ...base, ...lists, players: toPlayerMap(players), unavailable: null }
}

async function loadTodaysGames(sports: string[], now: Date) {
  const from = new Date(now.getTime() - 30 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 30 * 60 * 60 * 1000)
  return prisma.sportsGame
    .findMany({
      where: { sport: { in: sports }, startTime: { gte: from, lte: to } },
      select: { sport: true, startTime: true, status: true },
      take: 500,
    })
    .catch(() => [])
}
