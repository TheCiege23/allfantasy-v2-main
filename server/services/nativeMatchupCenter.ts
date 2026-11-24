/**
 * The Matchup tab's reads for a league that plays on AllFantasy: its own schedule, its own bracket
 * and the points its own scoring counted. See `lib/matchup-center/nativeMatchupModel.ts` for why the
 * tab cannot read `teamWeekResult` for these leagues.
 *
 * Read-only and DB-only. No score is decided here: a game's score and status are the season's rows.
 * The one computation is the fallback in `loadWeekPlayerScores`, which asks the scoring engine what
 * each player counted for when the week has no stored player rows (playoff weeks store none).
 */

import { applyInjuryStatuses } from '@/lib/redraft/rosterInjuryStatus'
import { resolveStoredHeadshotsBatch } from '@/lib/draft-room/storedPickHeadshot'
import { prisma } from '@/lib/prisma'
import { loadNbaRosterOutlook } from '@/lib/redraft/nbaRosterOutlook'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { NATIVE_PLAYER_SCORE_SOURCE, nativeRosterSeat } from '@/lib/redraft/nativePlayerWeeklyScores'
import {
  CONSOLATION_ROUND_OFFSET,
  isChampionshipRoundNumber,
  playoffRoundWeeks,
  readChampionshipLength,
} from '@/lib/playoff-runtime/playoffRoundWeeks'
import { readPlayoffSeriesLengths } from '@/lib/playoff-runtime/playoffSeries'
import { settingsForScoringWeek } from '@/lib/category-scoring/leagueScoringType'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { MatchupCenterPayload, MatchupGameStatus, MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'
import { buildMatchupInsightsBlock } from '@/lib/matchup-center/matchupAiInsights'
import { computeMatchupWinProbability } from '@/lib/matchup-center/winProbability'
import { applyMatchupCommandCenterMeta } from '@/lib/matchup-center/matchupAggregation'
import { sanitizeStarterRow } from '@/lib/matchup-center/validateMatchupPayload'
import { afSideTotal, loadMatchupAfProjections } from '@/lib/matchup-center/afProjections'
import { loadNflRosterOutlook } from '@/lib/redraft/nflRosterOutlook'
import {
  buildNativeBoard,
  buildNativeStarters,
  gamesForRoster,
  isByeWeek,
  nativeGameStatus,
  nativeMatchupWeek,
  pickNativeSeason,
  pickViewerRosterId,
  regularGameStatus,
  type NativeBoardGame,
  type NativeMatchupExtras,
  type NativeStarter,
  type NativeWeekGame,
} from '@/lib/matchup-center/nativeMatchupModel'

type LeagueRow = {
  id: string
  season: number | null
  sport: unknown
  settings: unknown
  leagueVariant: string | null
  platform: string | null
  playoffWeeksPerRound?: number | null
}

type SeasonRow = {
  id: string
  season: number
  currentWeek: number
  playoffStartWeek: number
  rosters: Array<{
    id: string
    ownerId: string
    managerUserId: string | null
    ownerName: string
    teamName: string | null
    avatarUrl: string | null
    wins: number
    losses: number
    ties: number
  }>
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The season the Matchup tab reads for this league, or null when it has none (so it is not native-run). */
export async function loadNativeMatchupSeason(league: LeagueRow, askedYear?: number | null): Promise<SeasonRow | null> {
  if (!isNativePlatform(league.platform)) return null
  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId: league.id },
    select: {
      id: true,
      season: true,
      currentWeek: true,
      playoffStartWeek: true,
      rosters: {
        select: { id: true, ownerId: true, managerUserId: true, ownerName: true, teamName: true, avatarUrl: true, wins: true, losses: true, ties: true },
      },
    },
  })
  return pickNativeSeason(seasons, askedYear ?? null)
}

/** Every game of one week: the regular-season schedule, plus any playoff round played that week. */
export async function loadNativeWeekGames(league: LeagueRow, season: SeasonRow, week: number): Promise<NativeWeekGame[]> {
  const pointsLeague = weekScoringMode(league.settings, season.season, week) === 'points'
  const [regular, rounds] = await Promise.all([
    prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, week, isMedianMatchup: false },
      select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true },
      orderBy: { id: 'asc' },
    }),
    // A week before the playoffs cannot hold a playoff game: skip the bracket read.
    week >= season.playoffStartWeek
      ? prisma.redraftPlayoffRound.findMany({
          where: { seasonId: season.id },
          orderBy: { roundNumber: 'asc' },
          select: {
            roundNumber: true,
            roundName: true,
            matchups: {
              orderBy: { matchupNumber: 'asc' },
              select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true, metadata: true },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const games: NativeWeekGame[] = regular.map((m) => ({
    id: m.id,
    kind: 'regular',
    label: null,
    homeRosterId: m.homeRosterId,
    awayRosterId: m.awayRosterId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    status: regularGameStatus({ status: m.status, homeScore: m.homeScore, awayScore: m.awayScore, pointsLeague }),
  }))

  if (rounds.length) {
    const titleRounds = rounds.filter((r) => isChampionshipRoundNumber(r.roundNumber))
    const finalRoundNumber = titleRounds.length ? titleRounds[titleRounds.length - 1].roundNumber : null
    const seriesLengths = readPlayoffSeriesLengths(league.settings)
    const championshipLength = readChampionshipLength(league.settings)
    for (const round of rounds) {
      const title = isChampionshipRoundNumber(round.roundNumber)
      // The one rule every reader uses for a round's weeks; a lower-bracket round is stored at 100 + n.
      const weeks = playoffRoundWeeks({
        playoffStartWeek: season.playoffStartWeek,
        roundNumber: title ? round.roundNumber : round.roundNumber - CONSOLATION_ROUND_OFFSET,
        weeksPerRound: league.playoffWeeksPerRound ?? null,
        finalRoundNumber,
        championshipLength,
        seriesLengths,
      })
      if (!weeks.includes(week)) continue
      for (const m of round.matchups) {
        // A seat still waiting on an earlier round has no game to draw yet.
        if (!m.homeRosterId || !m.awayRosterId || m.status === 'bye' || m.status === 'cancelled') continue
        const live = record(record(m.metadata).live)
        const liveHome = num(live.homeScore)
        const liveAway = num(live.awayScore)
        const final = m.status === 'final' && m.homeScore != null && m.awayScore != null
        // While a round is being played its score lives in `metadata.live`; the columns are written at final.
        const status = final ? 'final' : liveHome != null || liveAway != null ? 'live' : nativeGameStatus(m.status)
        games.push({
          id: m.id,
          kind: title ? 'playoff' : 'consolation',
          label: round.roundName?.trim() || (title ? 'Playoffs' : 'Consolation'),
          homeRosterId: m.homeRosterId,
          awayRosterId: m.awayRosterId,
          homeScore: final ? m.homeScore ?? 0 : liveHome ?? 0,
          awayScore: final ? m.awayScore ?? 0 : liveAway ?? 0,
          status,
        })
      }
    }
  }
  return games
}

const teamNameOf = (season: SeasonRow) => {
  const byId = new Map(season.rosters.map((r) => [r.id, r]))
  return (rosterId: string) => {
    const r = byId.get(rosterId)
    return r?.teamName?.trim() || r?.ownerName?.trim() || 'Team'
  }
}

/** How this week is scored (a mid-season switch counts from its own week). */
function weekScoringMode(settings: unknown, seasonYear: number, week: number): string {
  const s = record(settingsForScoringWeek(settings, seasonYear, week))
  return String(s.scoring_mode ?? record(s.scoringSettings).scoringMode ?? 'points')
}

type PlayerScore = { playerId: string; points: number; isStarter: boolean; isFinalized?: boolean }

/**
 * What each player counted for in one team's week, or null when the week has not been scored for it.
 * Stored rows first (`league_player_weekly_scores`, written by the score sync). A week in play with
 * no stored rows (every playoff week) is asked of the scoring engine, which only reads.
 */
async function loadWeekPlayerScores(args: {
  leagueId: string
  seasonYear: number
  week: number
  redraftRosterIds: readonly string[]
  /** Rosters whose game has started: only these may fall back to the engine. */
  startedRosterIds: ReadonlySet<string>
  pointsLeague: boolean
}): Promise<Map<string, PlayerScore[]>> {
  const out = new Map<string, PlayerScore[]>()
  if (!args.pointsLeague || args.redraftRosterIds.length === 0) return out
  const seatOf = new Map(args.redraftRosterIds.map((id) => [id, nativeRosterSeat(id)]))
  // A rare hash collision must not hand one team's points to the other: read nothing instead.
  const seatsUnambiguous = new Set(seatOf.values()).size === seatOf.size
  if (seatsUnambiguous) {
    const rows = await prisma.leaguePlayerWeeklyScore
      .findMany({
        where: {
          leagueId: args.leagueId,
          seasonYear: args.seasonYear,
          week: args.week,
          source: NATIVE_PLAYER_SCORE_SOURCE,
          rosterId: { in: [...seatOf.values()] },
        },
        select: { playerId: true, rosterId: true, points: true, isStarter: true, isFinalized: true },
      })
      .catch(() => [])
    for (const [rosterId, seat] of seatOf) {
      const mine = rows.filter((r) => r.rosterId === seat)
      if (mine.length) out.set(rosterId, mine.map((r) => ({ playerId: r.playerId, points: r.points, isStarter: r.isStarter, isFinalized: r.isFinalized })))
    }
  }
  for (const rosterId of args.redraftRosterIds) {
    if (out.has(rosterId) || !args.startedRosterIds.has(rosterId)) continue
    try {
      const { scoreRosterForWeek } = await import('@/lib/redraft/scoringEngine')
      const summary = await scoreRosterForWeek({
        leagueId: args.leagueId,
        rosterId,
        week: args.week,
        seasonYear: args.seasonYear,
        collectPlayerPoints: true,
      })
      if (summary.playerPoints?.length) out.set(rosterId, summary.playerPoints)
    } catch {
      // No per-player breakdown for this team: the screen shows the team score and dashes.
    }
  }
  return out
}

function slotGameStatus(game: NativeWeekGame | null, hasPoints: boolean): MatchupGameStatus {
  if (!game) return 'upcoming'
  if (game.status === 'final') return 'final'
  if (game.status === 'live') return hasPoints ? 'live' : 'upcoming'
  return 'upcoming'
}

/** The flat per-position estimate the tab has always used where no real projection exists. */

export type NativeMatchupCenterPayload = MatchupCenterPayload & { native: NativeMatchupExtras }

/**
 * The viewer's matchup for one week of a native league's season. Null when the league has no season
 * to read (the caller then answers as it did before).
 */
export async function buildNativeMatchupCenterPayload(params: {
  league: LeagueRow
  viewerUserId: string
  season?: number
  week?: number
  /** 1-based: which of the viewer's games this week to show. */
  game?: number
}): Promise<NativeMatchupCenterPayload | { error: string; status: number; code?: string } | null> {
  const { league } = params
  const season = await loadNativeMatchupSeason(league, params.season ?? league.season)
  if (!season) return null

  const myRosterId = pickViewerRosterId(season.rosters, params.viewerUserId)
  if (!myRosterId) return { error: 'Roster not found', status: 404, code: 'NO_CLAIMED_TEAM' }

  const week = nativeMatchupWeek(params.week, season.currentWeek)
  const categories = weekScoringMode(league.settings, season.season, week) !== 'points'
  const games = await loadNativeWeekGames(league, season, week)
  const mine = gamesForRoster(games, myRosterId)
  const gameIndex = Math.min(Math.max(1, Math.floor(params.game ?? 1)), Math.max(1, mine.length)) - 1
  const game = mine[gameIndex] ?? null
  const oppRosterId = game ? (game.homeRosterId === myRosterId ? game.awayRosterId : game.homeRosterId) : null
  const nameOf = teamNameOf(season)
  const rosterById = new Map(season.rosters.map((r) => [r.id, r]))

  const sideRosterIds = [myRosterId, oppRosterId].filter((id): id is string => Boolean(id))
  const started = new Set(game && game.status !== 'upcoming' ? sideRosterIds : [])
  const [players, lineups, scores] = await Promise.all([
    prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: sideRosterIds } },
      select: { rosterId: true, playerId: true, playerName: true, position: true, team: true, slotType: true, droppedAt: true, injuryStatus: true },
      orderBy: { addedAt: 'asc' },
    }),
    loadWeekLineups(prisma, { redraftRosterIds: sideRosterIds, season: season.season, week }),
    loadWeekPlayerScores({
      leagueId: league.id,
      seasonYear: season.season,
      week,
      redraftRosterIds: sideRosterIds,
      startedRosterIds: started,
      pointsLeague: !categories,
    }),
  ])

  const startersOf = (rosterId: string): NativeStarter[] => {
    const mineRows = players.filter((p) => p.rosterId === rosterId)
    const current = new Set(
      mineRows
        .filter((p) => p.droppedAt == null && isNflRedraftScoringStarterSlot(weekSlotType(p, lineups)))
        .map((p) => p.playerId),
    )
    return buildNativeStarters({ players: mineRows, currentStarterIds: current, scores: scores.get(rosterId) ?? null })
  }
  const myStarters = startersOf(myRosterId)
  const oppStarters = oppRosterId ? startersOf(oppRosterId) : []
  /*
   * 🛑 THE STORED STATUS IS STALE BY CONSTRUCTION (2026-11-24). `RedraftRosterPlayer.injuryStatus` is a
   * snapshot from draft/import time; the roster route already discards it for the live `SportsInjury`
   * designation (app/api/redraft/roster/route.ts), and the matchup tab read it raw. Same read here: the
   * snapshot is cleared and only a live row (id + name agreeing, see rosterInjuryStatus.ts) sets a status.
   */
  const activeRows = players.filter((p) => p.droppedAt == null)
  const injuryOf = new Map<string, string | null>()
  try {
    const starterIds = new Set([...myStarters, ...oppStarters].map((s) => s.playerId))
    const wanted = activeRows.filter((p) => starterIds.has(p.playerId))
    const leagueSport = String(league.sport ?? 'NFL').toUpperCase()
    if (wanted.length > 0) {
      const rows = await prisma.sportsInjury.findMany({
        where: {
          sport: leagueSport,
          expiresAt: { gte: new Date() },
          AND: [
            { OR: [{ playerId: { in: wanted.map((p) => p.playerId) } }, { playerName: { in: wanted.map((p) => p.playerName) } }] },
            { OR: [{ season: season.season }, { season: null }] },
            // An NFL designation is for a week; a daily sport's rows are not week-tagged.
            ...(leagueSport === 'NFL' ? [{ OR: [{ week }, { week: null }] }] : []),
          ],
        },
        orderBy: [{ fetchedAt: 'desc' }],
        take: Math.max(50, wanted.length * 3),
      })
      const stamped = applyInjuryStatuses(
        wanted.map((p) => ({ rosterId: p.rosterId, playerId: p.playerId, playerName: p.playerName, sport: leagueSport, injuryStatus: null as string | null })),
        rows,
      )
      for (const p of stamped) injuryOf.set(`${p.rosterId}|${p.playerId}`, p.injuryStatus ?? null)
    }
  } catch {
    // No live read: no flag, rather than last month's.
  }

  const sport = normalizeToSupportedSport(String(league.sport)) ?? 'NFL'
  let mediaMap: Awaited<ReturnType<typeof attachPlayerMediaBatch>> | null = null
  try {
    mediaMap = await attachPlayerMediaBatch(
      [...myStarters, ...oppStarters].map((p) => ({ playerId: p.playerId, teamAbbr: p.team ?? null, sport: sport.toLowerCase() })),
    )
  } catch {
    mediaMap = null
  }
  // Outside the NFL a hosted league's ids are Rolling Insights ids, which collide with Sleeper ids, so the
  // photo comes from the RI row (name-checked) and the Sleeper-id media is never used for it.
  const storedHeadshots = sport === 'NFL'
    ? new Map<string, string>()
    : await resolveStoredHeadshotsBatch(sport, [...myStarters, ...oppStarters].map((p) => ({ playerId: p.playerId, playerName: p.name, team: p.team ?? null })))
  const afByPlayer = await loadMatchupAfProjections({
    leagueId: league.id,
    playerIds: [...myStarters, ...oppStarters].map((p) => p.playerId),
    season: season.season,
    week,
    sport: String(league.sport),
    platform: league.platform ?? null,
    leagueSettings: league.settings,
  })

  // NFL: opponent, kickoff, opponent rank against the position, crest, bye week and forecast, for the
  // week on screen. Empty for other sports; a failure leaves the rows as they were.
  const outlook = await loadNflRosterOutlook(prisma, {
    league: { id: league.id, sport: String(league.sport), season: season.season, platform: league.platform ?? null, settings: league.settings },
    players: [...myStarters, ...oppStarters].map((p) => ({ id: p.playerId, team: p.team ?? null, position: p.position ?? null })),
    week,
  }).catch((): Awaited<ReturnType<typeof loadNflRosterOutlook>> => new Map())
  // NBA: the same picture for a daily sport — next game, its tip-off, the week's game count, crests
  // and the opponent's rank against the position (./nbaRosterOutlook.ts).
  if (sport === 'NBA') {
    const nba = await loadNbaRosterOutlook(prisma, {
      league: { sport: String(league.sport), season: season.season },
      players: [...myStarters, ...oppStarters].map((p) => ({ id: p.playerId, team: p.team ?? null, position: p.position ?? null })),
      week,
    }).catch((): Awaited<ReturnType<typeof loadNbaRosterOutlook>> => new Map())
    for (const [id, o] of nba) if (!outlook.has(id)) outlook.set(id, o)
  }

  const toSlot = (rosterId: string, row: NativeStarter): MatchupPlayerSlot => {
    const pts = row.points ?? 0
    const status = slotGameStatus(game, row.points != null)
    const o = outlook.get(row.playerId)
    return sanitizeStarterRow({
      playerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      opponent: o?.opponent ?? null,
      headshotUrl: sport === 'NFL'
        ? mediaMap?.get(row.playerId)?.media.headshotUrl ?? o?.headshotUrl ?? null
        : storedHeadshots.get(row.playerId) ?? o?.headshotUrl ?? null,
      currentPoints: pts,
      projectedPoints: afByPlayer.get(row.playerId) ?? pts,
      hasRealProjection: afByPlayer.has(row.playerId),
      afProjectedPoints: afByPlayer.get(row.playerId) ?? null,
      injuryStatus: injuryOf.get(`${rosterId}|${row.playerId}`) ?? null,
      newsBlurb: null,
      weatherSummary: null,
      gameStatus: status,
      gameLabel: status === 'final' ? 'Final' : row.points != null && pts !== 0 ? 'Scoring' : 'Scheduled',
      aiInsight: null,
      outlook: o
        ? { homeAway: o.homeAway, kickoffTimeIso: o.kickoffTimeIso, opponentRank: o.opponentRank, teamLogoUrl: o.teamLogoUrl, byeWeek: o.byeWeek, gamesThisWeek: o.gamesThisWeek ?? null, weather: o.weather, providerProjection: o.projectionSource === 'sleeper' && o.projectedPoints != null ? { points: o.projectedPoints, source: 'sleeper' } : null }
        : null,
    })
  }

  const side = (rosterId: string, starters: NativeStarter[], total: number): MatchupSidePayload => {
    const r = rosterById.get(rosterId)
    const slots = starters.map((s) => toSlot(rosterId, s))
    const af = afSideTotal(slots)
    const wins = r?.wins ?? 0
    const losses = r?.losses ?? 0
    const ties = r?.ties ?? 0
    const played = wins + losses + ties
    return {
      rosterId,
      teamName: nameOf(rosterId),
      avatarUrl: r?.avatarUrl ?? null,
      record: { wins, losses, ties },
      winPct: played > 0 ? (wins + ties * 0.5) / played : 0,
      totalPoints: total,
      projectedTotal: slots.reduce((s, x) => s + x.projectedPoints, 0),
      afProjectedTotal: af.total,
      afProjectedFrom: af.from,
      projectedTotalIncludesFallback: slots.some((s) => !s.hasRealProjection),
      starters: slots,
      remainingStarters: slots.filter((s) => s.gameStatus !== 'final').length,
    }
  }

  const myTotal = game ? (game.homeRosterId === myRosterId ? game.homeScore : game.awayScore) : 0
  const oppTotal = game ? (game.homeRosterId === myRosterId ? game.awayScore : game.homeScore) : 0
  const left = side(myRosterId, myStarters, myTotal)
  const right: MatchupSidePayload = oppRosterId
    ? side(oppRosterId, oppStarters, oppTotal)
    : {
        rosterId: 'bye',
        teamName: 'No opponent',
        avatarUrl: null,
        record: { wins: 0, losses: 0, ties: 0 },
        winPct: 0,
        totalPoints: 0,
        projectedTotal: 0,
        projectedTotalIncludesFallback: false,
        starters: [],
        remainingStarters: 0,
      }

  const board = buildNativeBoard(games, nameOf, myRosterId)
  const hasPlayerPoints = [...myStarters, ...oppStarters].some((s) => s.points != null)
  const base = applyMatchupCommandCenterMeta({
    leagueId: league.id,
    season: season.season,
    week,
    sport: String(league.sport),
    matchupStatus: game?.status ?? 'upcoming',
    conceptOverlay: league.leagueVariant ? `Format: ${league.leagueVariant}` : null,
    left,
    right,
    winProbabilityLeft: oppRosterId ? computeMatchupWinProbability(left, right) : null,
    insights: buildMatchupInsightsBlock({ left, right, sport: String(league.sport) }),
    partialData: !mediaMap || !oppRosterId,
  })
  return {
    ...base,
    native: {
      scoreUnit: categories ? 'categories' : 'points',
      playerPointsAvailable: !categories && (hasPlayerPoints || !game || game.status === 'upcoming'),
      gameLabel: game?.label ?? null,
      bye: !game && isByeWeek(games, myRosterId),
      otherGames: board.filter((g) => g.mine && g.id !== game?.id && g.away != null),
      gameNumber: game ? gameIndex + 1 : 0,
      gameCount: mine.length,
    },
  }
}

/** The league scoreboard for one week of a native league's season. Null when it has no season. */
export async function loadNativeScoreboard(params: {
  league: LeagueRow
  viewerUserId: string
  season?: number
  week?: number
}): Promise<{ season: number; week: number; games: NativeBoardGame[] } | null> {
  const season = await loadNativeMatchupSeason(params.league, params.season ?? params.league.season)
  if (!season) return null
  const week = nativeMatchupWeek(params.week, season.currentWeek)
  // Rotisserie has no weekly opponent: its schedule rows are scoring containers pinned at 0-0.
  if (weekScoringMode(params.league.settings, season.season, week) === 'roto') return { season: season.season, week, games: [] }
  const games = await loadNativeWeekGames(params.league, season, week)
  return {
    season: season.season,
    week,
    games: buildNativeBoard(games, teamNameOf(season), pickViewerRosterId(season.rosters, params.viewerUserId)),
  }
}
