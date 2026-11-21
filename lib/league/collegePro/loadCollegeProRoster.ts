import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { liveLeagueDrafts, liveLeagueMatchups, liveLeagueRosters, liveLeagueUsers, liveNflState } from '@/lib/sleeper/liveLeagueFeed'
import { readStoredFantraxDraft } from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import { fantraxDraftCard, sleeperDraftCards, type CollegeProDraft } from './drafts'
import { connectedRosterPlayers, type ConnectedRosterPlayer } from '@/lib/core-app/connectedRoster'
import { resolvePairedHalf } from '@/lib/core-app/leaguePairing'
import {
  buildFantraxLists,
  buildSleeperLists,
  pairSleeperMatchup,
  sleeperTeamName,
  sumStarterPoints,
  type CollegeProLists,
  type CollegeProPlayer,
  type CollegeProRole,
} from './buildSides'
import { decideLeadSide, type LeadReason, type LeadSide } from './leadSide'
import { collegeProFormatOf, collegeSportFor, combinedTotal, readCollegeProScoring, type CollegeProFormat, type CollegeProScoring } from './format'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { loadCollegePoints } from './collegePoints'

export type { CollegeProFormat, CollegeProScoring }

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
  /** This week's points per player. A player with nothing yet is absent, never 0. */
  points: Record<string, number>
  score: CollegeProScore
}

export type CollegeProScore = {
  /** The NFL week this score is for. */
  week: number | null
  /** The starters' points, or null when none has scored yet. */
  total: number | null
  /** Head-to-head opponent, when the provider tells us one. */
  opponent: { name: string | null; total: number | null } | null
  /** One plain sentence about where the numbers come from, or why there are none. */
  note: string | null
}

const noScore = (week: number | null, note: string | null = null): CollegeProScore => ({ week, total: null, opponent: null, note })

export type CollegeProRosterPayload =
  | { applies: false }
  | {
      applies: true
      format: CollegeProFormat
      lead: LeadSide
      leadReason: LeadReason
      /** Pro first or college first, already ordered for the page. */
      sides: CollegeProSide[]
      /** Separate matchups (the default) or one combined weekly total. */
      scoring: CollegeProScoring
      /** Pro plus college this week, when scoring is combined. Null otherwise, or before anyone scores. */
      combinedTotal: number | null
      /** Whether this viewer may change `scoring`: the head commissioner, or a co-commissioner with scoring. */
      canEditScoring: boolean
      /** This year's drafts on both halves: the NFL rookie draft and the college draft. */
      drafts: CollegeProDraft[]
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
    select: { id: true, name: true, platform: true, platformLeagueId: true, leagueType: true, leagueVariant: true, sport: true, settings: true },
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

  const nflState = await liveNflState().catch(() => null)
  const week = nflState?.display_week ?? nflState?.week ?? null
  const season = Number(nflState?.season) || now.getFullYear()

  const collegePlayers = collegeHalf?.players ?? []
  const [pro, games, collegePoints, drafts] = await Promise.all([
    loadSleeperProSide(league, userId, week),
    loadTodaysGames([proSport, collegeSport], now),
    collegeHalf && week
      ? loadCollegePoints({
          season,
          nflWeek: week,
          players: collegePlayers.map((p) => ({ id: p.id, cfbdId: p.cfbdId ?? null, rollingInsightsId: p.rollingInsightsId ?? null, position: p.position })),
        }).catch(() => null)
      : Promise.resolve(null),
    loadDrafts(league.platformLeagueId, collegeHalf?.platform === 'fantrax' ? collegeHalf.memberLeagueId : null),
  ])

  const college: CollegeProSide = collegeHalf
    ? (() => {
        const players = collegeHalf.players ?? []
        const lists = buildFantraxLists(players.map((p) => ({ id: p.id, slot: p.rosterSlot ?? null, status: p.rosterStatus ?? null })))
        const hasSlots = players.some((p) => p.rosterStatus)
        const shown = hasSlots ? lists : { ...emptyLists(), bench: players.map((p) => p.id) }
        const points = collegePoints?.points ?? {}
        const note = !collegePoints
          ? null
          : !collegePoints.statsOnFile
            ? "College stats for this week haven't come in yet."
            : collegePoints.live
              ? 'College points update live during games, using standard college scoring, so Fantrax may differ slightly.'
              : 'College points use standard college scoring, so Fantrax may show slightly different numbers.'
        return {
          role: 'college' as const,
          sport: collegeSport,
          platform: collegeHalf.platform,
          leagueName: collegeHalf.name,
          teamLabel: collegeHalf.teamLabel,
          leagueHref: collegeHalf.leagueId ? `/league/${collegeHalf.leagueId}` : null,
          // An older snapshot carries players but no lineup status: show everyone on the bench, and say so.
          ...shown,
          players: toPlayerMap(players),
          points,
          score: { week, total: sumStarterPoints(shown.starters, points), opponent: null, note },
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
        points: {},
        score: noScore(week),
      }

  const { lead, reason } = decideLeadSide({ now, proSport, collegeSport, games })
  const scoring = readCollegeProScoring(league.settings)
  // The same rule the save route asks, so the switch never shows for someone the save would refuse.
  const canEditScoring = await canCommissionerAct(leagueId, userId, 'scoring').catch(() => false)
  return {
    applies: true,
    format,
    lead,
    leadReason: reason,
    sides: lead === 'college' ? [college, pro] : [pro, college],
    scoring,
    combinedTotal: scoring === 'combined' ? combinedTotal(pro.score.total, college.score.total) : null,
    canEditScoring,
    drafts,
    fetchedAt: now.toISOString(),
  }
}

async function loadSleeperProSide(
  league: { id: string; name: string | null; platformLeagueId: string | null; sport: string | null },
  userId: string,
  week: number | null,
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
    return { ...base, ...emptyLists(), players: {}, unavailable: 'Connect your Sleeper account to see your pro lineup.', points: {}, score: noScore(week) }
  }
  const [context, rosters] = await Promise.all([getLeagueContext(sid), liveLeagueRosters(sid)])
  if (!rosters) return { ...base, ...emptyLists(), players: {}, unavailable: 'Sleeper did not answer. Try again in a minute.', points: {}, score: noScore(week) }
  const mine = rosters.find((r) => r.owner_id === profile.sleeperUserId || (r.co_owners ?? []).includes(profile.sleeperUserId!))
  if (!mine) return { ...base, ...emptyLists(), players: {}, unavailable: 'Your Sleeper account does not own a team in this league.', points: {}, score: noScore(week) }

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
  const [players, matchups, users] = await Promise.all([
    connectedRosterPlayers('sleeper', base.sport, ids).catch(() => []),
    week ? liveLeagueMatchups(sid, week) : Promise.resolve(null),
    liveLeagueUsers(sid),
  ])
  const { mine: myMatchup, opponent } = pairSleeperMatchup(matchups ?? [], mine.roster_id)
  const points = myMatchup?.players_points ?? {}
  const opponentRoster = opponent ? rosters.find((r) => r.roster_id === opponent.roster_id) : null
  const score: CollegeProScore = {
    week,
    // Sleeper's own total, which applies the league's scoring; summing starters is the fallback.
    total: typeof myMatchup?.points === 'number' ? myMatchup.points : sumStarterPoints(lists.starters, points),
    opponent: opponent
      ? { name: sleeperTeamName(users ?? [], opponentRoster?.owner_id), total: typeof opponent.points === 'number' ? opponent.points : null }
      : null,
    note: matchups ? null : 'Live points are unavailable right now.',
  }
  return { ...base, ...lists, players: toPlayerMap(players), unavailable: null, points, score }
}

/** Both halves' drafts. A half we cannot read contributes nothing, rather than a made-up status. */
async function loadDrafts(sleeperLeagueId: string, fantraxSnapshotId: string | null): Promise<CollegeProDraft[]> {
  const [sleeperDrafts, snapshot] = await Promise.all([
    liveLeagueDrafts(sleeperLeagueId).catch(() => null),
    fantraxSnapshotId
      ? prisma.fantraxLeague.findUnique({ where: { id: fantraxSnapshotId }, select: { transactions: true, season: true } }).catch(() => null)
      : Promise.resolve(null),
  ])
  const college = snapshot ? fantraxDraftCard(readStoredFantraxDraft(snapshot.transactions), snapshot.season ?? null) : null
  return [...sleeperDraftCards(sleeperDrafts ?? []), ...(college ? [college] : [])]
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
