import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  getCachedLiveScoresForSport,
  getLiveScoresForSport,
  type LiveScoreRow,
} from '@/lib/sports-live-scores-service'
import { getPlayFeed, type PlayFeedItem } from '@/lib/live/playFeedPresentation'
import { estimateWinProbability, type WinProbability } from '@/lib/live/winProbability'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { isSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'

/**
 * Data for `/live` — the cross-league live-scoring page (handoff 15a).
 *
 * ⚠ THE ROSTER TIE-IN IS A MIRROR, NOT A CALCULATION. Build rule 3 of the handoff
 * is explicit that a player's live points here must equal what the matchup page
 * shows at the same instant, so this reads `LeaguePlayerWeeklyScore` — points
 * exactly as the source platform scored them, per league — rather than pricing
 * anyone itself. The same player legitimately shows three different totals in
 * three leagues; a single "correct" number would be wrong in at least two of
 * them, which is the whole reason that table is keyed by league.
 *
 * ⚠ THAT TABLE HAD A WRITER AND NO READERS UNTIL NOW. `ingestSleeperPlayerScores`
 * has been filling it; nothing rendered it. If this page shows empty tie-in
 * panels, check that the ingest has run for the current week before assuming the
 * join is wrong.
 */

export const LIVE_SPORTS: SupportedSport[] = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']

/** Display labels; the tabs render these verbatim. */
export const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'College Football',
  NCAAB: 'College Basketball',
  SOCCER: 'Soccer',
}

/** One of your leagues that rosters a player in this game. */
export type LiveRosterTieIn = {
  leagueId: string
  leagueName: string
  playerId: string
  playerName: string
  position: string | null
  /** True when he is in your starting lineup this week. */
  isStarter: boolean
  /** Points as THIS league scored them. Null when the league has not reported yet. */
  points: number | null
}

export type LiveTeamSide = {
  abbrev: string
  name: string
  logo: string
  score: number
  record: string | null
}

export type LiveGameCard = {
  gameId: string
  sport: string
  week: number | null
  status: string
  statusDetail: string
  /** Period + clock, e.g. "Q3 · 8:42". Null when the feed gives no clock. */
  clockLabel: string | null
  isLive: boolean
  completed: boolean
  startTime: string
  home: LiveTeamSide
  away: LiveTeamSide
  /** Our own model output — never a feed value. Null when the game cannot be timed. */
  winProbability: WinProbability | null
  topPerformer: LiveScoreRow['topPerformer']
  /** Your leagues rostering someone in this game, starters first. */
  tieIns: LiveRosterTieIn[]
  /** Distinct leagues affected — the sort key for "My games". */
  leaguesAffected: number
}

export type LiveImpact = {
  /** Sum of your live points across every rostered player in a live game. */
  totalPoints: number
  livePlayers: number
  liveGames: number
  /** The most recent notable play involving a player you roster. */
  biggestMover: (PlayFeedItem & { leagues: string[] }) | null
  /** Your players whose games have not kicked off yet. */
  upNext: Array<{ playerName: string; matchup: string; startTime: string }>
}

export type LivePageData = {
  sport: string
  scope: 'my' | 'all'
  counts: Array<{ sport: string; label: string; liveCount: number }>
  games: LiveGameCard[]
  impact: LiveImpact
  /** When the underlying feed was last refreshed — drives "updated Ns ago". */
  fetchedAt: string
  /** False when signed out or no claimed team, so the UI explains empty tie-ins. */
  hasRosterData: boolean
  /**
   * ⚠ TRUE WHEN THE FEED FAILED, WHICH IS NOT THE SAME AS "NO GAMES".
   * Every per-sport fetch is caught so one sport cannot take down the page — but
   * a swallowed error rendered as an empty slate tells the user the confident
   * lie that nothing is on. This flag lets the UI say "could not load" instead.
   * It is exactly the failure this page hit in development: a missing DB column
   * made every sport throw, and the screen calmly reported no games.
   */
  loadFailed: boolean
}

/** A rostered player of yours, resolved to a real-world team. */
type RosteredPlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  leagues: Array<{ leagueId: string; leagueName: string; isStarter: boolean; points: number | null }>
}

function isLiveRow(row: LiveScoreRow): boolean {
  if (row.completed) return false
  const s = String(row.status ?? '').toLowerCase()
  return s.includes('progress') || s.includes('halftime') || s.includes('end_period') || row.period > 0
}

/**
 * "Q3 · 8:42", or null when the feed has no clock.
 *
 * ⚠ NEVER FABRICATES A CLOCK. Build rule 5 makes real-time accuracy this page's
 * entire premise, and a placeholder period would be the one lie a live page
 * cannot tell.
 */
function clockLabel(row: LiveScoreRow, sport: string): string | null {
  if (row.completed) return 'FINAL'
  if (!row.period || row.period < 1) return null
  const clock = String(row.clock ?? '').trim()
  const periodLabel =
    sport === 'NFL' || sport === 'NCAAF'
      ? row.period > 4
        ? 'OT'
        : `Q${row.period}`
      : sport === 'SOCCER'
        ? `${row.period}H`
        : `P${row.period}`
  return clock ? `${periodLabel} · ${clock}` : periodLabel
}

/**
 * Every player you roster this week, across every league, with that league's own
 * points and starter flag.
 *
 * ⚠ THE CLAIMED-TEAM PREDICATE IS `LeagueTeam.claimedByUserId`, matching
 * playerImpact.ts and myTeam.ts deliberately. Those three surfaces must not
 * disagree about which teams are yours.
 */
async function loadRosteredPlayers(
  userId: string,
  sport: string,
): Promise<{ players: Map<string, RosteredPlayer>; hasRosterData: boolean }> {
  const players = new Map<string, RosteredPlayer>()

  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: {
      leagueId: true,
      league: { select: { id: true, name: true, platformLeagueId: true, sport: true, season: true } },
    },
  })
  if (teams.length === 0) return { players, hasRosterData: false }

  const leagues = teams
    .map((t) => t.league)
    .filter((l): l is NonNullable<typeof l> => l != null && String(l.sport) === sport)
  if (leagues.length === 0) return { players, hasRosterData: false }

  /*
   * ⚠ THE WEEK IS READ FROM THE DATA, NOT ASSUMED. A hardcoded "current week" is
   * how a live page silently shows last week's numbers all Sunday. Each league
   * reports its own, so the newest week per league is the one in play.
   */
  const rows = await prisma.leaguePlayerWeeklyScore.findMany({
    where: {
      leagueId: { in: leagues.map((l) => l.platformLeagueId) },
      seasonYear: { in: [...new Set(leagues.map((l) => l.season))] },
    },
    orderBy: [{ week: 'desc' }],
    select: { leagueId: true, playerId: true, points: true, isStarter: true, week: true },
    take: 5000,
  })
  if (rows.length === 0) return { players, hasRosterData: true }

  const latestWeek = new Map<string, number>()
  for (const r of rows) {
    const seen = latestWeek.get(r.leagueId)
    if (seen == null || r.week > seen) latestWeek.set(r.leagueId, r.week)
  }

  const byPlatformId = new Map(leagues.map((l) => [l.platformLeagueId, l]))
  const current = rows.filter((r) => latestWeek.get(r.leagueId) === r.week)

  const identities = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: [...new Set(current.map((r) => r.playerId))] } },
    select: { sleeperId: true, name: true, position: true, team: true },
  })
  const identityById = new Map(identities.map((p) => [p.sleeperId ?? '', p]))

  for (const r of current) {
    const identity = identityById.get(r.playerId)
    // Unresolvable ids are skipped, not rendered as a blank player row.
    if (!identity?.name) continue
    const league = byPlatformId.get(r.leagueId)
    if (!league) continue

    const entry = {
      leagueId: league.id,
      leagueName: league.name ?? 'League',
      isStarter: r.isStarter,
      points: Number.isFinite(r.points) ? r.points : null,
    }
    const existing = players.get(r.playerId)
    if (existing) {
      existing.leagues.push(entry)
    } else {
      players.set(r.playerId, {
        playerId: r.playerId,
        name: identity.name,
        position: identity.position ?? null,
        team: identity.team ? normalizeTeamAbbrev(identity.team) || identity.team : null,
        leagues: [entry],
      })
    }
  }

  return { players, hasRosterData: true }
}

/** Games starting within this window of now still count as "the current slate". */
const SLATE_BEFORE_MS = 6 * 60 * 60 * 1000
const SLATE_AFTER_MS = 18 * 60 * 60 * 1000

/**
 * The slate for the sport being viewed.
 *
 * ⚠ GOES THROUGH THE DB-FIRST SERVICE, NOT STRAIGHT TO A PROVIDER. An earlier
 * version called `fetchEspnScoreboard` from here, which put provider latency and
 * rate limits on the page's own request path and would blank the screen whenever
 * ESPN blipped — exactly what the DB-first boundary exists to prevent, and the
 * guard was right to reject it. `getLiveScoresForSport` serves the database when
 * it is fresh, refreshes when it is stale, and PERSISTS whatever it fetched, so
 * the next reader is served from our own store.
 *
 * `preferEspn` is the one thing this surface needs from it: Rolling Insights
 * returns the whole season scoreless for NFL, which satisfies the default
 * "has rows" check while carrying no clock, logos, records or leaders.
 */
async function loadActiveSlate(
  sport: LeagueSport,
): Promise<{ scores: LiveScoreRow[]; fetchedAt: string | null }> {
  const result = await getLiveScoresForSport({ sport, team: null, preferEspn: true })
  /*
   * ⚠ THE SLATE NEEDS A WINDOW. A cached fallback can hold a whole season, and a
   * "live scores" page listing every fixture from August to January is not a live
   * scores page. ESPN's own response is already today's slate, so this only ever
   * trims the fallback.
   */
  const now = Date.now()
  const inWindow = result.scores.filter((row) => {
    const at = new Date(row.startTime).getTime()
    if (Number.isNaN(at)) return false
    return at >= now - SLATE_BEFORE_MS && at <= now + SLATE_AFTER_MS
  })
  return { scores: inWindow, fetchedAt: result.fetchedAt }
}

/** Build the page payload. `userId` null = signed out; tie-ins are simply absent. */
export async function getLivePageData(opts: {
  userId: string | null
  sport?: string | null
  scope?: 'my' | 'all'
}): Promise<LivePageData> {
  const requested = String(opts.sport ?? 'NFL').toUpperCase()
  const sport: SupportedSport = isSupportedSport(requested) ? (requested as SupportedSport) : 'NFL'
  const scope: 'my' | 'all' = opts.scope === 'all' ? 'all' : 'my'

  /*
   * ⚠ THE VIEWED SPORT FETCHES LIVE; THE OTHER TABS ONLY NEED A COUNT.
   * `getCachedLiveScoresForSport` never calls a provider — it reads `SportsGame`
   * rows, which carry no clock, no logos, no leaders, and turn an unreported
   * score into a confident 0. Built on that alone this page rendered every
   * preseason game as a completed 0-0, which is precisely the fabrication the
   * handoff forbids. `getLiveScoresForSport` refreshes from Rolling Insights or
   * ESPN when the cache is stale, and that is the data a live page needs.
   *
   * The other six sports stay on the cached reader deliberately: a tab badge is
   * a count, and refreshing seven providers on every page load and every 20s
   * poll would multiply provider traffic sevenfold to render six numbers.
   *
   * Build rule 6: a zero-count tab stays visible, so every sport is still here.
   */
  const perSport = await Promise.all(
    LIVE_SPORTS.map(async (s) => {
      const isActive = s === sport
      try {
        const result = isActive
          ? await loadActiveSlate(s as LeagueSport)
          : await getCachedLiveScoresForSport({ sport: s as LeagueSport, team: null })
        return { sport: s, rows: result?.scores ?? [], fetchedAt: result?.fetchedAt ?? null, failed: false }
      } catch (err) {
        // Logged, not swallowed silently — an empty slate that is really an
        // outage should be findable in the server logs too, not just on screen.
        console.error(`[live] ${s} score fetch failed:`, err instanceof Error ? err.message : err)
        return { sport: s, rows: [] as LiveScoreRow[], fetchedAt: null, failed: true }
      }
    }),
  )

  const counts = perSport.map((entry) => ({
    sport: entry.sport,
    label: SPORT_LABELS[entry.sport] ?? entry.sport,
    liveCount: entry.rows.filter(isLiveRow).length,
  }))

  const active = perSport.find((entry) => entry.sport === sport)
  const rows = active?.rows ?? []

  const { players, hasRosterData } = opts.userId
    ? await loadRosteredPlayers(opts.userId, sport)
    : { players: new Map<string, RosteredPlayer>(), hasRosterData: false }

  // Real-world team -> your players on it.
  const byTeam = new Map<string, RosteredPlayer[]>()
  for (const p of players.values()) {
    if (!p.team) continue
    const list = byTeam.get(p.team) ?? []
    list.push(p)
    byTeam.set(p.team, list)
  }

  const games: LiveGameCard[] = rows.map((row) => {
    const home = normalizeTeamAbbrev(row.homeTeam) || row.homeTeam
    const away = normalizeTeamAbbrev(row.awayTeam) || row.awayTeam
    const involved = [...(byTeam.get(home) ?? []), ...(byTeam.get(away) ?? [])]

    const tieIns: LiveRosterTieIn[] = []
    for (const p of involved) {
      for (const l of p.leagues) {
        tieIns.push({
          leagueId: l.leagueId,
          leagueName: l.leagueName,
          playerId: p.playerId,
          playerName: p.name,
          position: p.position,
          isStarter: l.isStarter,
          points: l.points,
        })
      }
    }
    /*
     * Starters first, then by points. Build rule 4 keeps bench players VISIBLE —
     * a benched player still explains why you are watching this game — so they
     * are ordered last and dimmed by the UI, never filtered out.
     */
    tieIns.sort((a, b) => {
      if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1
      return (b.points ?? 0) - (a.points ?? 0)
    })

    return {
      gameId: row.gameId,
      sport,
      week: row.week,
      status: row.status,
      statusDetail: row.statusDetail,
      clockLabel: clockLabel(row, sport),
      isLive: isLiveRow(row),
      completed: row.completed,
      startTime: row.startTime,
      home: {
        abbrev: home,
        name: row.homeTeamFull,
        logo: row.homeLogo,
        score: row.homeScore,
        record: row.homeRecord,
      },
      away: {
        abbrev: away,
        name: row.awayTeamFull,
        logo: row.awayLogo,
        score: row.awayScore,
        record: row.awayRecord,
      },
      winProbability: estimateWinProbability({
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        period: row.period,
        clock: row.clock,
        completed: row.completed,
      }),
      topPerformer: row.topPerformer,
      tieIns,
      leaguesAffected: new Set(tieIns.map((t) => t.leagueId)).size,
    }
  })

  /*
   * Build rule 1: "My games" surfaces ONLY games containing a player you actually
   * roster — never a popular or recommended game.
   * Build rule 2: sorted strictly by leagues affected, ties broken by closeness
   * (win probability nearest 50/50), never by kickoff time.
   */
  const visible = scope === 'my' ? games.filter((g) => g.leaguesAffected > 0) : games
  visible.sort((a, b) => {
    if (b.leaguesAffected !== a.leaguesAffected) return b.leaguesAffected - a.leaguesAffected
    const closeness = (g: LiveGameCard) =>
      g.winProbability ? Math.abs(g.winProbability.home - 50) : 100
    return closeness(a) - closeness(b)
  })

  return {
    sport,
    scope,
    counts,
    games: visible,
    impact: await buildImpact(visible, players),
    fetchedAt: active?.fetchedAt ?? new Date().toISOString(),
    hasRosterData,
    loadFailed: active?.failed ?? false,
  }
}

/** Right-hand panel: your totals, the last notable play, and what is still to come. */
async function buildImpact(
  games: readonly LiveGameCard[],
  players: Map<string, RosteredPlayer>,
): Promise<LiveImpact> {
  const liveGames = games.filter((g) => g.isLive)

  /*
   * ⚠ SUMMED PER (PLAYER, LEAGUE), NOT PER PLAYER. The same player in three
   * leagues contributes three separate scores, because that is three separate
   * matchups of yours he is affecting. Deduplicating to one would understate the
   * total by exactly the amount that makes this page worth opening.
   */
  let totalPoints = 0
  const livePlayerIds = new Set<string>()
  for (const g of liveGames) {
    for (const t of g.tieIns) {
      if (t.points != null) totalPoints += t.points
      livePlayerIds.add(t.playerId)
    }
  }

  const plays = await getPlayFeed().catch(() => [] as PlayFeedItem[])
  const liveGameIds = new Set(liveGames.map((g) => g.gameId))
  /*
   * The most recent play involving a player YOU roster, in a game that is
   * actually live. A league-wide "biggest play" would be editorialising with
   * data the user did not ask about.
   */
  const roster = [...players.values()]
  const mine = plays.find(
    (p) => liveGameIds.has(p.gameId) && roster.some((r) => r.name === p.playerName),
  )
  const biggestMover = mine
    ? {
        ...mine,
        leagues: roster
          .filter((r) => r.name === mine.playerName)
          .flatMap((r) => r.leagues.map((l) => l.leagueName)),
      }
    : null

  const upNext = games
    .filter((g) => !g.isLive && !g.completed && g.tieIns.length > 0)
    .slice(0, 3)
    .map((g) => ({
      playerName: g.tieIns[0]!.playerName,
      matchup: `${g.away.abbrev} @ ${g.home.abbrev}`,
      startTime: g.startTime,
    }))

  return {
    totalPoints: Math.round(totalPoints * 10) / 10,
    livePlayers: livePlayerIds.size,
    liveGames: liveGames.length,
    biggestMover,
    upNext,
  }
}
