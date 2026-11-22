import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { liveLeagueDrafts, liveLeagueMatchups, liveLeagueRosters, liveLeagueUsers, liveNflState } from '@/lib/sleeper/liveLeagueFeed'
import { readStoredFantraxDraft } from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import { fantraxDraftCard, sleeperDraftCards, type CollegeProDraft } from './drafts'
import { buildPipeline, parseStoredDraftPicks, type CollegeProPipeline } from './pipeline'
import { loadHeadToHead, type HeadToHead, type TeamMapEditor } from './headToHead'
import { currentFantraxPeriod, loadDailyPoints } from './dailyPoints'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { findLinkCandidates, type LinkCandidate } from './linkHalves'
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
import { collegeProFormatOf, collegeSportFor, combinedTotal, normalizeCollegeSport, readCollegeProScoring, type CollegeProFormat, type CollegeProScoring } from './format'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { loadCollegePoints } from './collegePoints'
import { loadLeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'

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
  /** AF fantasy points for this scoring week, keyed by imported roster player ID. */
  weeklyProjections?: Record<string, number>
  score: CollegeProScore
}

export type CollegeProScore = {
  /** The scoring week this total is for. */
  week: number | null
  /** The starters' points, or null when none has scored yet. */
  total: number | null
  /** Head-to-head opponent, when the provider tells us one. */
  opponent: { name: string | null; total: number | null } | null
  /** One plain sentence about where the numbers come from, or why there are none. */
  note: string | null
}

const noScore = (week: number | null, note: string | null = null): CollegeProScore => ({ week, total: null, opponent: null, note })

/**
 * A linked half's `League.settings`, for scoring it under its own rules. Read only for a half the
 * franchise link already resolved for this user; null when the half was never imported here.
 */
function leagueSettingsOf(leagueId: string | null | undefined): Promise<unknown> {
  if (!leagueId) return Promise.resolve(null)
  return Promise.resolve()
    .then(() => prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))
    .then((row) => row?.settings ?? null)
    .catch(() => null)
}

/** ["wins", "ejections", "buzzer-beaters"] → "wins, ejections and buzzer-beaters". */
function listInWords(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** An unlinked C2C / Devy league: which half it needs, and the viewer's leagues that could be it. */
export type CollegeProLink = { needRole: 'pro' | 'college'; candidates: LinkCandidate[] }

export type CollegeProRosterPayload =
  | { applies: false; link?: CollegeProLink }
  | {
      applies: true
      /** Set when this league has no other half linked yet. */
      link?: CollegeProLink | null
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
  const unlinked = async (): Promise<CollegeProRosterPayload> => {
    const link = await findLinkCandidates(leagueId, userId).catch(() => null)
    return link ? { applies: false, link } : { applies: false }
  }

  if (league.platform === 'fantrax') {
    if (!collegeProFormatOf(league)) return { applies: false }
    const paired = await resolvePairedHalf(leagueId, userId, { includeOperationalSummary: false }).catch(() => null)
    if (!paired || paired.sides.length < 2) return unlinked()
    /*
     * OPENED FROM THE COLLEGE SIDE. Cream Bowl is the Fantrax half of the Peach Bowl franchise; the
     * owner asked for the same one page from either league. The pro half owns the lineups, the scoring
     * setting and the drafts, so the page is built from it, with the college lineup leading.
     */
    if (paired.viewingRole === 'college') {
      if (opts.viewedFrom === 'college') return { applies: false }
      const proHalf = paired.sides.find((s) => s.role === 'pro' && s.leagueId)
      if (!proHalf?.leagueId) return unlinked()
      return loadCollegeProRoster(proHalf.leagueId, userId, now, { viewedFrom: 'college' })
    }
    // This Fantrax league IS the pro half (an NBA league on Fantrax).
    return loadFantraxProPair({ league, userId, now, paired, viewedFrom: opts.viewedFrom ?? 'pro' })
  }
  if (league.platform !== 'sleeper') return { applies: false }

  const paired = await resolvePairedHalf(leagueId, userId, { includeOperationalSummary: false }).catch(() => null)
  const collegeHalf = paired?.sides.find((s) => s.role === 'college') ?? null
  const typed = collegeProFormatOf(league)
  if (!typed && !collegeHalf) return { applies: false }
  // A pro league paired to a college league scores both halves, which is the C2C shape.
  const format: CollegeProFormat = typed ?? 'c2c'

  const proSport = String(league.sport ?? 'NFL').toUpperCase()
  const collegeSport = normalizeCollegeSport(collegeHalf?.sport) ?? collegeSportFor(proSport)
  const link = collegeHalf ? null : await findLinkCandidates(leagueId, userId).catch(() => null)

  const nflState = await liveNflState().catch(() => null)
  const week = nflState?.display_week ?? nflState?.week ?? null
  const season = Number(nflState?.season) || now.getFullYear()

  const collegePlayers = collegeHalf?.players ?? []
  const collegeSettings = leagueSettingsOf(collegeHalf?.leagueId)
  let proCtx: SleeperProContext | null = null
  const [pro, games, collegePoints, drafts, pipeline] = await Promise.all([
    loadSleeperProSide(league, userId, week).then((r) => {
      proCtx = r.ctx
      return r.side
    }),
    loadTodaysGames([proSport, collegeSport], now),
    collegeHalf && week
      ? collegeSettings
          .then((settings) =>
            loadCollegePoints({
              season,
              nflWeek: week,
              players: collegePlayers.map((p) => ({ id: p.id, cfbdId: p.cfbdId ?? null, rollingInsightsId: p.rollingInsightsId ?? null, position: p.position })),
              settings,
            }),
          )
          .catch(() => null)
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
            : collegePoints.scoredWith === 'league'
              ? collegePoints.live
                ? 'College points update live during games.'
                : null
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
          collegeSettings: await collegeSettings,
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
    link,
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

/*
 * ── A pro half hosted on Fantrax (basketball) ─────────────────────────────────────────────────────
 *
 * "Road To Glory NBA" + "Road To Glory NCAA Basketball" (2026-11-21) are both Fantrax leagues. The
 * pro half has no Sleeper roster, matchups or week, so everything comes from Fantrax snapshots and
 * the Rolling Insights box lines:
 *   - lineups: each half's Fantrax slots and status (MINORS is the pro half's taxi, per F-04);
 *   - the period: the pro league's stored Fantrax scoring periods;
 *   - points: both halves scored from RI box lines over that period (dailyPoints.ts);
 *   - the opponent: the pro snapshot's stored matchups, scored the same way as you.
 * Combined head-to-head uses the same commissioner team map, keyed here by the pro league's Fantrax
 * team ids, and the opponent's college starters scored over the same period.
 */
async function loadFantraxProPair(args: {
  league: { id: string; name: string | null; sport: string | null; settings: unknown; leagueType: string | null; leagueVariant: string | null }
  userId: string
  now: Date
  paired: Awaited<ReturnType<typeof resolvePairedHalf>>
  viewedFrom: 'pro' | 'college'
}): Promise<CollegeProRosterPayload> {
  const { league, userId, now, paired, viewedFrom } = args
  const proSport = String(league.sport ?? '').toUpperCase()
  if (proSport !== 'NBA') return { applies: false }
  const proHalf = paired?.sides.find((s) => s.role === 'pro') ?? null
  const collegeHalf = paired?.sides.find((s) => s.role === 'college') ?? null
  if (!proHalf || !collegeHalf) return { applies: false }
  const collegeSport = normalizeCollegeSport(collegeHalf.sport) ?? collegeSportFor(proSport)
  const format: CollegeProFormat = collegeProFormatOf(league) ?? 'c2c'

  const settings = (league.settings ?? {}) as Record<string, unknown>
  /*
   * The period: the league's stored Fantrax periods when it has them (Cream Bowl does), else the NBA
   * calendar week, as native NBA C2C scores it. "Road To Glory NBA" stores no periods, only
   * `current_week`, and read as no week at all (live page, 2026-11-22).
   */
  const nbaSeason = Number(settings.season) || (now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1)
  const nbaWeek = dailySportWeekForInstant('NBA', nbaSeason, now)
  const nbaWindow = nbaWeek ? resolveDailySportWeekWindow('NBA', nbaSeason, nbaWeek) : null
  const period =
    currentFantraxPeriod(settings.fantrax_scoring_periods, now) ??
    (nbaWeek && nbaWindow ? { number: nbaWeek, window: { start: nbaWindow.start, end: nbaWindow.end } } : null)
  const proPlayers = proHalf.players ?? []
  const collegePlayers = collegeHalf.players ?? []
  const toPointsInput = (ps: typeof proPlayers) =>
    ps.map((p) => ({ id: p.id, rollingInsightsId: p.rollingInsightsId ?? null, position: p.position }))

  const rosterIds = [...new Set(proPlayers.map((p) => p.id).filter(Boolean))]
  // Each half is scored under its OWN Fantrax league's rules: the NBA league's here, the college league's below.
  const collegeSettings = await leagueSettingsOf(collegeHalf.leagueId)
  const [proPoints, collegePointsDaily, games, proSnap, collegeSnap, proMetrics] = await Promise.all([
    period
      ? loadDailyPoints({ sport: 'NBA', window: period.window, players: toPointsInput(proPlayers), settings: league.settings }).catch(() => null)
      : Promise.resolve(null),
    period && collegeSport === 'NCAAB'
      ? loadDailyPoints({ sport: 'NCAAB', window: period.window, players: toPointsInput(collegePlayers), settings: collegeSettings }).catch(() => null)
      : Promise.resolve(null),
    loadTodaysGames([proSport, collegeSport], now),
    prisma.fantraxLeague
      .findUnique({ where: { id: proHalf.memberLeagueId }, select: { transactions: true, season: true, matchups: true, roster: true, standings: true } })
      .catch(() => null),
    prisma.fantraxLeague.findUnique({ where: { id: collegeHalf.memberLeagueId }, select: { transactions: true, season: true } }).catch(() => null),
    format === 'c2c' && period && rosterIds.length
      ? loadLeaguePlayerMetrics({ leagueId: league.id, week: period.number, rosterIds, limit: rosterIds.length, includeTradeValues: false, now }).catch(() => null)
      : Promise.resolve(null),
  ])

  const listsOf = (ps: typeof proPlayers, minorsAsTaxi: boolean) =>
    buildFantraxLists(ps.map((p) => ({ id: p.id, slot: p.rosterSlot ?? null, status: p.rosterStatus ?? null })), { minorsAsTaxi })
  const proLists = listsOf(proPlayers, true)
  const collegeLists = listsOf(collegePlayers, false)

  // The opponent this period, from the pro snapshot's own schedule, scored exactly as you are.
  const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
  const myTeam = lower(proHalf.teamLabel)
  const matchups = Array.isArray(proSnap?.matchups)
    ? (proSnap!.matchups as Array<{ week?: unknown; homeTeam?: unknown; awayTeam?: unknown; homeTeamId?: unknown; awayTeamId?: unknown }>)
    : []
  const matchup = period ? matchups.find((m) => Number(m.week) === period.number && (lower(m.homeTeam) === myTeam || lower(m.awayTeam) === myTeam)) : undefined
  const oppName = matchup ? String((lower(matchup.homeTeam) === myTeam ? matchup.awayTeam : matchup.homeTeam) ?? '') || null : null
  let oppTotal: number | null = null
  if (oppName && period) {
    const oppRows = (Array.isArray(proSnap?.roster) ? (proSnap!.roster as unknown[]) : []).filter(
      (r) => lower((r as { teamName?: unknown }).teamName) === lower(oppName),
    )
    const oppPlayers = oppRows.length ? await connectedRosterPlayers('fantrax', 'NBA', oppRows).catch(() => []) : []
    const oppPoints = await loadDailyPoints({ sport: 'NBA', window: period.window, players: toPointsInput(oppPlayers), settings: league.settings }).catch(() => null)
    oppTotal = oppPoints ? sumStarterPoints(listsOf(oppPlayers, true).starters, oppPoints.points) : null
  }

  const statsNote = (p: { statsOnFile: boolean; scoredWith?: 'league' | 'standard'; unscored?: string[] } | null, label: string) =>
    !p
      ? null
      : !p.statsOnFile
        ? `${label} stats for this period haven't come in yet.`
        : p.scoredWith !== 'league'
          ? `${label} points use standard scoring, so Fantrax may show slightly different numbers.`
          : p.unscored?.length
            ? `Your league also scores ${listInWords(p.unscored)}, which box scores don't show, so those aren't in these points.`
            : null

  const pro: CollegeProSide = {
    role: 'pro',
    sport: proSport,
    platform: 'fantrax',
    leagueName: proHalf.name,
    teamLabel: proHalf.teamLabel,
    leagueHref: proHalf.leagueId ? `/league/${proHalf.leagueId}` : null,
    ...proLists,
    players: toPlayerMap(proPlayers),
    unavailable: proHalf.unavailableReason ?? (proPlayers.length ? null : 'Your NBA roster could not be read from Fantrax.'),
    points: proPoints?.points ?? {},
    weeklyProjections: proMetrics?.unit === 'fantasy points'
      ? Object.fromEntries(proMetrics.rows.flatMap((p) => p.rosterPlayerId && p.weekly != null ? [[p.rosterPlayerId, p.weekly]] : []))
      : undefined,
    score: {
      week: period?.number ?? null,
      total: proPoints ? sumStarterPoints(proLists.starters, proPoints.points) : null,
      opponent: oppName ? { name: oppName, total: oppTotal } : null,
      note: statsNote(proPoints, 'NBA'),
    },
  }
  const college: CollegeProSide = {
    role: 'college',
    sport: collegeSport,
    platform: collegeHalf.platform,
    leagueName: collegeHalf.name,
    teamLabel: collegeHalf.teamLabel,
    leagueHref: collegeHalf.leagueId ? `/league/${collegeHalf.leagueId}` : null,
    ...collegeLists,
    players: toPlayerMap(collegePlayers),
    unavailable: collegeHalf.unavailableReason ?? (collegePlayers.length ? null : 'Your college roster could not be read from Fantrax.'),
    points: collegePointsDaily?.points ?? {},
    score: {
      week: period?.number ?? null,
      total: collegePointsDaily ? sumStarterPoints(collegeLists.starters, collegePointsDaily.points) : null,
      opponent: null,
      note: statsNote(collegePointsDaily, 'College'),
    },
  }

  const decided = decideLeadSide({ now, proSport, collegeSport, games })
  const { lead, reason } =
    decided.reason === 'weekday' && viewedFrom === 'college' ? { lead: 'college' as const, reason: decided.reason } : decided
  const scoring = readCollegeProScoring(league.settings)
  const canEditScoring = await canCommissionerAct(league.id, userId, 'scoring').catch(() => false)
  const myCombined = scoring === 'combined' ? combinedTotal(pro.score.total, college.score.total) : null

  // Combined head to head: the pro league's own teams, keyed by Fantrax team id.
  const proTeams = (Array.isArray(proSnap?.standings) ? (proSnap!.standings as Array<{ team?: unknown; fantraxTeamId?: unknown }>) : [])
    .filter((t) => typeof t.fantraxTeamId === 'string' && typeof t.team === 'string')
    .map((t) => ({ rosterId: t.fantraxTeamId as string, teamName: t.team as string, ownerName: null }))
  const idOf = (name: unknown) => proTeams.find((t) => lower(t.teamName) === lower(name))?.rosterId ?? null
  const myProId = idOf(proHalf.teamLabel)
  const oppProId = matchup
    ? String((lower(matchup.homeTeam) === myTeam ? matchup.awayTeamId : matchup.homeTeamId) ?? '') || idOf(oppName)
    : null
  const h2h =
    scoring === 'combined' && myProId && period && collegeSport === 'NCAAB'
      ? await loadHeadToHead({
          proSettings: league.settings,
          fantraxSnapshotId: collegeHalf.memberLeagueId,
          myCollegeTeamName: collegeHalf.teamLabel,
          myCombined,
          opponentProTotal: oppTotal,
          opponentName: oppName,
          myRosterId: myProId,
          opponentRosterId: oppProId,
          sleeperTeams: proTeams,
          season: proSnap?.season ?? now.getFullYear(),
          nflWeek: null,
          wantEditor: canEditScoring,
          collegeSport: 'NCAAB',
          scoreCollegePlayers: (players) =>
            loadDailyPoints({ sport: 'NCAAB', window: period.window, players: toPointsInput(players), settings: collegeSettings }).then((r) => r.points),
        }).catch(() => null)
      : null

  const drafts = [
    fantraxDraftCard(proSnap ? readStoredFantraxDraft(proSnap.transactions) : null, proSnap?.season ?? null, 'pro'),
    fantraxDraftCard(collegeSnap ? readStoredFantraxDraft(collegeSnap.transactions) : null, collegeSnap?.season ?? null, 'college'),
  ].filter((d): d is CollegeProDraft => d != null)

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
    pipeline: null,
    proLeagueId: league.id,
    headToHead: h2h?.headToHead ?? (scoring === 'combined' ? { me: myCombined, opponent: null, missing: "This week's matchup could not be read." } : null),
    teamMap: h2h?.editor ?? null,
    fetchedAt: now.toISOString(),
  }
}
