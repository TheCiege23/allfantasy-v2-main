import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { liveLeagueDrafts, liveLeagueMatchups, liveLeagueRosters, liveLeagueUsers, liveNflState } from '@/lib/sleeper/liveLeagueFeed'
import { readStoredFantraxDraft } from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import { fantraxDraftCard, sleeperDraftCards, type CollegeProDraft } from './drafts'
import { buildPipeline, parseStoredDraftPicks, type CollegeProPipeline } from './pipeline'
import { loadHeadToHead, type HeadToHead, type TeamMapEditor } from './headToHead'
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
      /** Drafted college players moving up, and the rookie draft's pool. Null until draft results are on file. */
      pipeline: CollegeProPipeline | null
      /** The pro league: where the scoring setting and the team map are saved, whichever league the page was opened from. */
      proLeagueId: string
      /** Combined scoring only: your NFL + college total against your opponent's. */
      headToHead: HeadToHead | null
      /** For someone allowed to change scoring, with combined on: the Sleeper-to-Fantrax team map to confirm. */
      teamMap: TeamMapEditor | null
      fetchedAt: string
    }

const toPlayerMap = (players: ConnectedRosterPlayer[]): Record<string, CollegeProPlayer> =>
  Object.fromEntries(
    players.map((p) => [p.id, { id: p.id, name: p.name, position: p.position, team: p.team, imageUrl: p.imageUrl, logoUrl: p.logoUrl }]),
  )

const emptyLists = (): CollegeProLists => ({ starters: [], bench: [], taxi: [], ir: [] })

export async function loadCollegeProRoster(
  leagueId: string,
  userId: string,
  now = new Date(),
  opts: { viewedFrom?: 'pro' | 'college' } = {},
): Promise<CollegeProRosterPayload> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId, OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
    select: { id: true, name: true, platform: true, platformLeagueId: true, leagueType: true, leagueVariant: true, sport: true, settings: true },
  })
  if (!league || !league.platformLeagueId) return { applies: false }

  /*
   * OPENED FROM THE COLLEGE SIDE. Cream Bowl is the Fantrax half of the Peach Bowl franchise; the
   * owner asked for the same one page from either league. The pro half owns the lineups, the scoring
   * setting and the drafts, so the page is built from it, with the college lineup leading.
   */
  if (league.platform === 'fantrax' && opts.viewedFrom !== 'college') {
    if (!collegeProFormatOf(league)) return { applies: false }
    const paired = await resolvePairedHalf(leagueId, userId, { includeOperationalSummary: false }).catch(() => null)
    const proHalf = paired?.sides.find((s) => s.role === 'pro' && s.platform === 'sleeper' && s.leagueId)
    if (!proHalf?.leagueId) return { applies: false }
    return loadCollegeProRoster(proHalf.leagueId, userId, now, { viewedFrom: 'college' })
  }
  if (league.platform !== 'sleeper') return { applies: false }

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
  let proCtx: SleeperProContext | null = null
  const [pro, games, collegePoints, drafts, pipeline] = await Promise.all([
    loadSleeperProSide(league, userId, week).then((r) => {
      proCtx = r.ctx
      return r.side
    }),
    loadTodaysGames([proSport, collegeSport], now),
    collegeHalf && week
      ? loadCollegePoints({
          season,
          nflWeek: week,
          players: collegePlayers.map((p) => ({ id: p.id, cfbdId: p.cfbdId ?? null, rollingInsightsId: p.rollingInsightsId ?? null, position: p.position })),
        }).catch(() => null)
      : Promise.resolve(null),
    loadDrafts(league.platformLeagueId, collegeHalf?.platform === 'fantrax' ? collegeHalf.memberLeagueId : null),
    collegeHalf?.platform === 'fantrax'
      ? loadPipeline(collegeHalf.memberLeagueId, collegePlayers, now).catch(() => null)
      : Promise.resolve(null),
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

  const decided = decideLeadSide({ now, proSport, collegeSport, games })
  // With no game on either side, the league you opened leads: college first from the college league.
  const { lead, reason } =
    decided.reason === 'weekday' && opts.viewedFrom === 'college' ? { lead: 'college' as const, reason: decided.reason } : decided
  const scoring = readCollegeProScoring(league.settings)
  // The same rule the save route asks, so the switch never shows for someone the save would refuse.
  const canEditScoring = await canCommissionerAct(leagueId, userId, 'scoring').catch(() => false)
  const myCombined = scoring === 'combined' ? combinedTotal(pro.score.total, college.score.total) : null
  const ctx = proCtx as SleeperProContext | null
  const h2h =
    scoring === 'combined' && ctx && collegeHalf?.platform === 'fantrax'
      ? await loadHeadToHead({
          proSettings: league.settings,
          fantraxSnapshotId: collegeHalf.memberLeagueId,
          myCollegeTeamName: collegeHalf.teamLabel,
          myCombined,
          opponentProTotal: ctx.opponentProTotal,
          opponentName: pro.score.opponent?.name ?? null,
          myRosterId: ctx.myRosterId,
          opponentRosterId: ctx.opponentRosterId,
          sleeperTeams: ctx.teams,
          season,
          nflWeek: week,
          wantEditor: canEditScoring,
        }).catch(() => null)
      : null
  return {
    applies: true,
    format,
    lead,
    leadReason: reason,
    sides: lead === 'college' ? [college, pro] : [pro, college],
    scoring,
    combinedTotal: myCombined,
    canEditScoring,
    drafts,
    pipeline,
    proLeagueId: league.id,
    headToHead: h2h?.headToHead ?? null,
    teamMap: h2h?.editor ?? null,
    fetchedAt: now.toISOString(),
  }
}

async function loadSleeperProSide(
  league: { id: string; name: string | null; platformLeagueId: string | null; sport: string | null },
  userId: string,
  week: number | null,
): Promise<{ side: CollegeProSide; ctx: SleeperProContext | null }> {
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
    return { side: { ...base, ...emptyLists(), players: {}, unavailable: 'Connect your Sleeper account to see your pro lineup.', points: {}, score: noScore(week) }, ctx: null }
  }
  const [context, rosters] = await Promise.all([getLeagueContext(sid), liveLeagueRosters(sid)])
  if (!rosters) return { side: { ...base, ...emptyLists(), players: {}, unavailable: 'Sleeper did not answer. Try again in a minute.', points: {}, score: noScore(week) }, ctx: null }
  const mine = rosters.find((r) => r.owner_id === profile.sleeperUserId || (r.co_owners ?? []).includes(profile.sleeperUserId!))
  if (!mine) return { side: { ...base, ...emptyLists(), players: {}, unavailable: 'Your Sleeper account does not own a team in this league.', points: {}, score: noScore(week) }, ctx: null }

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
  return {
    side: { ...base, ...lists, players: toPlayerMap(players), unavailable: null, points, score },
    ctx: {
      myRosterId: String(mine.roster_id),
      opponentRosterId: opponent ? String(opponent.roster_id) : null,
      opponentProTotal: typeof opponent?.points === 'number' ? opponent.points : null,
      teams: rosters.map((r) => ({
        rosterId: String(r.roster_id),
        teamName: sleeperTeamName(users ?? [], r.owner_id),
        ownerName: (users ?? []).find((u) => u.user_id === r.owner_id)?.display_name ?? null,
      })),
    },
  }
}

/** What the combined head-to-head needs from the Sleeper half, kept out of the page payload. */
export type SleeperProContext = {
  myRosterId: string
  opponentRosterId: string | null
  opponentProTotal: number | null
  teams: Array<{ rosterId: string; teamName: string | null; ownerName: string | null }>
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

/**
 * The newest NFL draft on file (this year's, else last year's) against the league's college rosters.
 * Null when no draft results are stored yet, which is the case until CFBD answers again.
 */
async function loadPipeline(
  fantraxSnapshotId: string,
  myPlayers: ReadonlyArray<{ id: string; cfbdId?: string | null; name: string }>,
  now: Date,
): Promise<CollegeProPipeline | null> {
  const thisYear = now.getUTCFullYear()
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { in: [`cfbd:draft-picks:v1:${thisYear}`, `cfbd:draft-picks:v1:${thisYear - 1}`] } },
    select: { data: true },
  })
  const stored = rows
    .map((r) => parseStoredDraftPicks(r.data))
    .filter((x): x is NonNullable<typeof x> => x != null && x.picks.length > 0)
    .sort((a, b) => b.year - a.year)[0]
  if (!stored) return null

  // Every college roster in the league: the snapshot holds all teams, tagged by teamName.
  const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: fantraxSnapshotId }, select: { roster: true } })
  const fantraxIds = (Array.isArray(snapshot?.roster) ? (snapshot!.roster as unknown[]) : [])
    .map((r) => String((r as { fantraxId?: unknown; id?: unknown })?.fantraxId ?? (r as { id?: unknown })?.id ?? '').trim())
    .filter(Boolean)
  const identities = fantraxIds.length
    ? await prisma.playerIdentityMap.findMany({
        where: { sport: 'NCAAF', fantraxId: { in: fantraxIds }, cfbdId: { not: null } },
        select: { cfbdId: true },
      })
    : []
  return buildPipeline({
    year: stored.year,
    picks: stored.picks,
    myPlayers: myPlayers.map((p) => ({ id: p.id, cfbdId: p.cfbdId ?? null, name: p.name })),
    leagueCfbdIds: new Set(identities.map((i) => i.cfbdId!).filter(Boolean)),
  })
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
