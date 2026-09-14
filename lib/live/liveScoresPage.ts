import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  getCachedLiveScoresForSport,
  getLiveScoresForSport,
  hasStarted,
  type LiveScoreRow,
} from '@/lib/sports-live-scores-service'
import { getPlayFeed, type PlayFeedItem } from '@/lib/live/playFeedPresentation'
import { estimateWinProbability, type WinProbability } from '@/lib/live/winProbability'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { composePlayerIdentities } from '@/lib/core-app/playerIdentityCompose'
import { isRosteredPlayer, rosterNameKeys } from '@/lib/live/rosterPlayMatch'
import { isLiveOnlySport, isLiveSport, type LiveSport } from '@/lib/sport-scope'
import {
  basketballPeriodLabel,
  espnScoreboardDatesForWindow,
  isBasketballSport,
  type BaseballSituation,
  type TeamShooting,
} from '@/lib/live/espnGamePresentation'

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

/**
 * The tabs, in order. WNBA and NCAABASE are live-only sports (see
 * `LIVE_ONLY_SPORTS`): each has a scoreboard and a game view here and no league
 * anywhere else.
 */
export const LIVE_SPORTS: LiveSport[] = ['NFL', 'NBA', 'WNBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'NCAABASE', 'SOCCER']

/** Display labels; the tabs render these verbatim. */
export const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  WNBA: 'WNBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'College Football',
  NCAAB: 'College Basketball',
  NCAABASE: 'College Baseball',
  SOCCER: 'Soccer',
}

/** One of your leagues that rosters a player in this game. */
export type LiveRosterTieIn = {
  leagueId: string
  leagueName: string
  playerId: string
  playerName: string
  position: string | null
  /**
   * The player's headshot, when we hold one.
   *
   * ⚠ NULL IS COMMON AND IS NOT AN ERROR — a large share of `SportsPlayer` rows
   * carry no image. The row draws initials instead; it must never render a
   * broken `<img>` beside a real name.
   */
  imageUrl: string | null
  /** True when he is in your starting lineup this week. */
  isStarter: boolean
  /** Points as THIS league scored them. Null when the league has not reported yet. */
  points: number | null
}

export type LiveTeamSide = {
  abbrev: string
  name: string
  logo: string
  /**
   * Points scored, or NULL before kickoff.
   *
   * ⚠ NULL, NOT 0. ESPN sends `"0"` for both sides of a game that has not
   * started, so reading it unconditionally puts a real-looking 0-0 on every
   * scheduled fixture — measured on `/core/live` 2026-08-29: "SJSU 0 @ 0 USC"
   * for a game kicking off the next afternoon. The record beside it already
   * gets this right ("withheld, not 0—0"); the score now matches.
   */
  score: number | null
  record: string | null
  /** Points per period ("1 2 3 4" on the card). Empty before kickoff or off-ESPN. */
  linescores: number[]
  /** Baseball H and E for the R-H-E box. Null off-MLB, before first pitch, or off-ESPN. */
  hits: number | null
  errors: number | null
  /** Basketball: this team's PTS / REB / AST leaders. Empty off basketball, before tip-off, or off-ESPN. */
  leaders: LiveGameLeader[]
  /** Basketball: made-attempted and percentage from the field, from three and at the line. */
  shooting: TeamShooting | null
}

/** One PASS / RUSH / REC leader, with the feed's own stat line. */
export type LiveGameLeader = {
  label: string | null
  name: string
  /** "L. Ball" — for the two-column basketball team box. */
  shortName: string | null
  statLine: string
  position: string | null
  headshot: string | null
  /** Our abbreviation for his team, when the feed's team id matched a side. */
  teamAbbrev: string | null
}

/**
 * Down, distance and where the ball is — ESPN's `situation`, reshaped for the
 * field strip. Null outside live play (pre-game, halftime, final).
 */
export type LiveGameSituation = {
  downDistance: string | null
  shortDownDistance: string | null
  distance: number | null
  /** 0–100 from the AWAY goal line; null when the feed's text could not be placed. */
  ballOn: number | null
  possession: 'home' | 'away' | null
  isRedZone: boolean
  homeTimeouts: number | null
  awayTimeouts: number | null
  lastPlay: string | null
  lastPlayType: string | null
  /** Runners, balls/strikes/outs, batter and pitcher. Null outside baseball. */
  baseball: BaseballSituation | null
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
  /** Game leaders, football ordered PASS, RUSH, REC. Empty when the feed names none. */
  leaders: LiveGameLeader[]
  situation: LiveGameSituation | null
  venue: { name: string; location: string | null } | null
  broadcast: string | null
  /**
   * True when this card's row came from ESPN's scoreboard (directly or via the
   * remembered presentation), so its `gameId` is an ESPN event id and the
   * clicked-game view can load it. A cache row from another feed carries another
   * vendor's id; linking it would open a page that can only fail.
   */
  espnDetail: boolean
  /** Your leagues STARTING someone in this game (bench/IR excluded), highest points first. */
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
  /**
   * The recent play feed for this slate, newest first — the very rows
   * `biggestMover` is picked from, now kept instead of thrown away.
   *
   * ⚠ NFL ONLY, AND DELIBERATELY EMPTY ON EVERY OTHER TAB. The cache behind it
   * is the literal key `pbp:feed:NFL` and every `LiveEventType` is an NFL play,
   * so there is genuinely nothing to show for MLB or NCAAF. Letting the NFL
   * feed render under another sport's tab would caption real plays with the
   * wrong games — the exact class of confident lie this page refuses to tell.
   */
  plays: PlayFeedItem[]
  /** Your players whose games have not kicked off yet. */
  upNext: Array<{ playerName: string; matchup: string; startTime: string }>
}

export type LivePageData = {
  sport: string
  scope: 'my' | 'all'
  /** Per-sport tab badges. `slateCount` is TODAY'S SLATE, not games in progress. */
  counts: Array<{ sport: string; label: string; slateCount: number }>
  games: LiveGameCard[]
  impact: LiveImpact
  /**
   * When the underlying feed was last refreshed — drives "updated Ns ago".
   *
   * ⚠ NULL WHEN WE DO NOT KNOW, AND THAT IS THE WHOLE POINT. This was
   * `active?.fetchedAt ?? new Date().toISOString()`, so a sport whose fetch
   * FAILED, or whose provider returned no timestamp, reported the current
   * instant — the freshest claim it is possible to make, over data of unknown
   * age. The view already refuses to date an unparseable timestamp, but a
   * fabricated `new Date()` parses perfectly, so that guard could never fire.
   *
   * "Updated 0s ago" above a stale scoreboard is worse than no age at all: it is
   * the one number on this page a user would act on during a game.
   */
  fetchedAt: string | null
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
  /**
   * ⚠ TRUE WHEN YOUR ROSTERS COULD NOT BE READ — A DIFFERENT FAULT FROM `loadFailed`.
   * The slate itself is fine and still renders; what failed is the tie-in join.
   * Kept separate precisely because blaming the slate for a roster fault is what
   * made the P2021 outage read as a scores bug for two deploys.
   *
   * It matters most under `scope: 'my'`, where no tie-ins means no games shown:
   * without this flag that state is indistinguishable from "none of your players
   * are playing", which is the one thing this page must not assert when it does
   * not know.
   */
  rosterFailed: boolean
}

/** A rostered player of yours, resolved to a real-world team. */
type RosteredPlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
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
  /*
   * Baseball has no clock, and "P7" said nothing about which half. ESPN's own
   * status text ("Bot 7th", "Mid 3rd") is the label every scoreboard uses.
   * Keyed on the baseball DATA as well as the sport, so a baseball row whose
   * situation did not come through is still labelled by its innings.
   */
  if (sport === 'MLB' || sport === 'NCAABASE' || row.situation?.baseball) {
    return String(row.statusDetail ?? '').trim() || null
  }
  /*
   * Basketball between periods: ESPN's clock reads "0.0" at halftime, so a
   * computed label would print "Q2 · 0.0". Its own status text ("Halftime",
   * "End of 1st") is what the scoreboard shows instead.
   */
  if (isBasketballSport(sport)) {
    const status = String(row.status ?? '').toLowerCase()
    if (status.includes('halftime') || status.includes('end_period')) {
      return String(row.statusDetail ?? '').trim() || null
    }
  }
  const clock = String(row.clock ?? '').trim()
  const periodLabel =
    basketballPeriodLabel(sport, row.period) ??
    (sport === 'NFL' || sport === 'NCAAF'
      ? row.period > 4
        ? 'OT'
        : `Q${row.period}`
      : sport === 'SOCCER'
        ? `${row.period}H`
        : `P${row.period}`)
  return clock ? `${periodLabel} · ${clock}` : periodLabel
}

/** A basketball team's own leaders, carrying that team's abbreviation. */
function teamLeaders(leaders: LiveScoreRow['homeTeamLeaders'], abbrev: string): LiveGameLeader[] {
  return (leaders ?? []).map((l) => ({
    label: l.label,
    name: l.name,
    shortName: l.shortName ?? null,
    statLine: l.statLine,
    position: l.position,
    headshot: l.headshot,
    teamAbbrev: abbrev,
  }))
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
    // `sport` is required by `composePlayerIdentities` — it gates the NFL-only
    // club fold, and omitting it would silently leave every club unfolded.
    select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
  })
  /*
   * ⚠ `new Map(pairs)` RESOLVED A DUPLICATE KEY TO THE LAST PAIR, AND `sleeperId`
   * IS NOT UNIQUE IN `SportsPlayer`. The duplicates are one athlete as four
   * vendors describe him, and `findMany` carries no `orderBy` — so which vendor
   * won was decided by whatever Postgres returned last. Same defect, same fix,
   * as `/core/matchup`, `/core/my-team` and the home dashboard.
   *
   * Smaller here than on those three, and worth stating rather than implying.
   * Measured on production 2026-08-30 over 11,960 NFL sleeperIds, comparing
   * values AFTER normalisation so a spelling difference does not count as a
   * conflict:
   *
   *   126  disagree on the FOLDED position — rendered on the tie-in row below
   *    20  disagree on the NORMALISED club — and the club is what places a
   *        player into a game, so the losing side of that coin toss puts him in
   *        the wrong fixture or in none. Myles Garrett resolves LAR or CLE.
   *
   * Both are small. Neither is decided by anything but row order, which is the
   * part worth removing.
   */
  const identityById = composePlayerIdentities(identities)

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
        /*
         * Already folded by the composer, which applies `normalizeTeamAbbrev`
         * on NFL rows only. `byTeam` below is keyed on this value and looked up
         * with the same normaliser applied to the fixture's clubs, so both
         * sides of that join speak one vocabulary.
         */
        team: identity.team,
        /*
         * Already run through `asHeadshotUrl` by the composer, so it is a URL or
         * null — never a bare vendor id that would 404 in an <img src>.
         */
        imageUrl: identity.imageUrl,
        leagues: [entry],
      })
    }
  }

  return { players, hasRosterData: true }
}

/** Games starting within this window of now still count as "the current slate". */
const SLATE_BEFORE_MS = 6 * 60 * 60 * 1000
const SLATE_AFTER_MS = 18 * 60 * 60 * 1000

/** True when the game starts inside the slate window around `now`. An
 *  unparseable start time fails the check — a game we cannot place in the
 *  window cannot honestly be claimed as part of the slate. */
function isInSlateWindow(row: LiveScoreRow, now: number): boolean {
  const at = new Date(row.startTime).getTime()
  if (Number.isNaN(at)) return false
  return at >= now - SLATE_BEFORE_MS && at <= now + SLATE_AFTER_MS
}

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
 * This surface used to pass `preferEspn: true` to get ESPN ahead of Rolling
 * Insights. That ordering is now the service default, so the flag is gone from
 * here — nothing about this page's needs changed, every other caller just gets
 * what this one already had. The reasoning, and what remains unexplained about
 * RI's live feed, is recorded at the ordering note in `getLiveScoresForSport`.
 */
async function loadActiveSlate(
  sport: LiveSport,
): Promise<{ scores: LiveScoreRow[]; fetchedAt: string | null }> {
  const now = Date.now()
  /*
   * College football asks ESPN for the DAYS this slate window covers. Its
   * undated scoreboard is a 24-game featured subset (the dated FBS day was 80,
   * measured 2026-09-13), and a game ESPN did not report arrives with no down,
   * distance or ball position — so most college cards could not draw the field.
   *
   * College baseball asks for the days too. Its undated scoreboard could not be
   * measured in season (this was built in September); the DATED day was — 81
   * games on 2026-04-18 — so the dated call is the one known to be complete, and
   * an empty day still falls back to the undated call in the service.
   * The pro scoreboards were not measured as partial and keep the undated call.
   */
  const espnDates =
    sport === 'NCAAF' || sport === 'NCAABASE'
      ? espnScoreboardDatesForWindow(now - SLATE_BEFORE_MS, now + SLATE_AFTER_MS)
      : undefined
  const result = await getLiveScoresForSport({ sport, team: null, espnDates })
  /*
   * ⚠ THE SLATE NEEDS A WINDOW. A cached fallback can hold a whole season, and a
   * "live scores" page listing every fixture from August to January is not a live
   * scores page.
   */
  const inWindow = result.scores.filter((row) => isInSlateWindow(row, now))
  if (inWindow.length > 0) return { scores: inWindow, fetchedAt: result.fetchedAt }

  /*
   * 🛑 A PROVIDER RESPONSE CAN BE NON-EMPTY AND STILL HAVE NOTHING FOR TODAY,
   * AND THAT USED TO ERASE A PERFECTLY GOOD CACHED SLATE.
   *
   * The comment above used to claim "ESPN's own response is already today's
   * slate, so this only ever trims the fallback". That is true for the pro
   * leagues and FALSE for college football. Measured 2026-08-29T00:43Z: ESPN's
   * college-football scoreboard returned 25 events whose EARLIEST kickoff was
   * 08-29 19:00Z — seventeen minutes past the end of the window — with the rest
   * on September 4-5. Meanwhile `SportsGame` held nine in-window NCAAF games.
   *
   * `getLiveScoresForSport` breaks its provider loop on `rows.length === 0`, so
   * 25 out-of-window rows count as success, replace the cached rows, and the
   * window then removes all of them. The tab reads "No games on this slate"
   * while the games sit in our own table. NFL never showed it because tonight's
   * NFL games happen to fall inside the window.
   *
   * So: prefer the live response, but when windowing empties it, ask the cache
   * rather than reporting nothing. An empty slate must mean "no games near now",
   * never "the provider answered about a different day".
   */
  const cached = await getCachedLiveScoresForSport({ sport, team: null })
  const cachedInWindow = (cached?.scores ?? []).filter((row) => isInSlateWindow(row, now))
  if (cachedInWindow.length === 0) return { scores: [], fetchedAt: result.fetchedAt }

  return { scores: cachedInWindow, fetchedAt: cached?.fetchedAt ?? result.fetchedAt }
}

/**
 * The last ESPN presentation seen per game, held in process.
 *
 * ⚠ WITHOUT THIS THE CARD FLICKERS ON EVERY OTHER POLL. `getLiveScoresForSport`
 * serves `SportsGame` rows whenever the cache is under 60s old, and those rows
 * carry a score and nothing else — no leaders, no down and distance, no line
 * score, and (for the pro leagues) not even a crest. With the page polling every
 * 20s, two polls in three would strip the field strip and the leaders off a live
 * game and the next would put them back.
 *
 * `leaders !== undefined` marks a row as ESPN-sourced (see LiveScoreRow), so it
 * is remembered; a row without it is filled from memory. The score and status on
 * the incoming row always win — only presentation is borrowed — and two parts are
 * guarded because they can go stale in a way that would contradict the score:
 *
 *   - line scores are borrowed only when they still SUM to the row's total;
 *   - down/distance is borrowed only while under SITUATION_TTL_MS old, since a
 *     two-minute-old "1st & 5" is simply the wrong down.
 *
 * Railway runs a long-lived server, so this survives between polls. On a cold
 * instance it is empty and the card renders plainly until the next ESPN refresh,
 * which is the pre-change behaviour and not a regression.
 */
type RememberedPresentation = Pick<
  LiveScoreRow,
  | 'leaders'
  | 'situation'
  | 'venue'
  | 'venueLocation'
  | 'broadcast'
  | 'homeLinescores'
  | 'awayLinescores'
  | 'homeHits'
  | 'homeErrors'
  | 'awayHits'
  | 'awayErrors'
  | 'homeLogo'
  | 'awayLogo'
  | 'homeTeamId'
  | 'awayTeamId'
  | 'topPerformer'
  | 'homeTeamLeaders'
  | 'awayTeamLeaders'
  | 'homeShooting'
  | 'awayShooting'
>
const PRESENTATION_TTL_MS = 3 * 60 * 60 * 1000
const SITUATION_TTL_MS = 90 * 1000
const MAX_REMEMBERED_GAMES = 600
const rememberedPresentation = new Map<string, { at: number; value: RememberedPresentation }>()

function sumsTo(values: number[] | undefined, total: number | null): boolean {
  if (!values || values.length === 0 || total == null) return false
  return values.reduce((a, b) => a + b, 0) === total
}

export function withRememberedPresentation(sport: string, row: LiveScoreRow, now: number): LiveScoreRow {
  const key = `${sport}:${row.gameId}`

  if (row.leaders !== undefined) {
    rememberedPresentation.delete(key) // re-insert so Map order tracks recency
    rememberedPresentation.set(key, {
      at: now,
      value: {
        leaders: row.leaders,
        situation: row.situation ?? null,
        venue: row.venue,
        venueLocation: row.venueLocation ?? null,
        broadcast: row.broadcast,
        homeLinescores: row.homeLinescores,
        awayLinescores: row.awayLinescores,
        homeHits: row.homeHits ?? null,
        homeErrors: row.homeErrors ?? null,
        awayHits: row.awayHits ?? null,
        awayErrors: row.awayErrors ?? null,
        homeLogo: row.homeLogo,
        awayLogo: row.awayLogo,
        homeTeamId: row.homeTeamId ?? null,
        awayTeamId: row.awayTeamId ?? null,
        topPerformer: row.topPerformer,
        homeTeamLeaders: row.homeTeamLeaders,
        awayTeamLeaders: row.awayTeamLeaders,
        homeShooting: row.homeShooting ?? null,
        awayShooting: row.awayShooting ?? null,
      },
    })
    while (rememberedPresentation.size > MAX_REMEMBERED_GAMES) {
      const oldest = rememberedPresentation.keys().next().value
      if (oldest === undefined) break
      rememberedPresentation.delete(oldest)
    }
    return row
  }

  const held = rememberedPresentation.get(key)
  if (!held || now - held.at > PRESENTATION_TTL_MS) return row
  const v = held.value
  return {
    ...row,
    leaders: v.leaders,
    situation: !row.completed && now - held.at <= SITUATION_TTL_MS ? v.situation : null,
    venue: row.venue ?? v.venue,
    venueLocation: v.venueLocation,
    broadcast: row.broadcast ?? v.broadcast,
    homeLinescores: sumsTo(v.homeLinescores, row.homeScore) ? v.homeLinescores : undefined,
    awayLinescores: sumsTo(v.awayLinescores, row.awayScore) ? v.awayLinescores : undefined,
    // H and E cannot be checked against the row, so they ride with the line score:
    // borrowed only while that side's innings still sum to its runs.
    homeHits: sumsTo(v.homeLinescores, row.homeScore) ? v.homeHits : undefined,
    homeErrors: sumsTo(v.homeLinescores, row.homeScore) ? v.homeErrors : undefined,
    awayHits: sumsTo(v.awayLinescores, row.awayScore) ? v.awayHits : undefined,
    awayErrors: sumsTo(v.awayLinescores, row.awayScore) ? v.awayErrors : undefined,
    // Basketball team leaders and shooting move with every basket, so they ride
    // with the line score too: a remembered 34-88 beside a newer score is wrong.
    homeTeamLeaders: sumsTo(v.homeLinescores, row.homeScore) ? v.homeTeamLeaders : undefined,
    homeShooting: sumsTo(v.homeLinescores, row.homeScore) ? v.homeShooting : undefined,
    awayTeamLeaders: sumsTo(v.awayLinescores, row.awayScore) ? v.awayTeamLeaders : undefined,
    awayShooting: sumsTo(v.awayLinescores, row.awayScore) ? v.awayShooting : undefined,
    homeLogo: row.homeLogo || v.homeLogo,
    awayLogo: row.awayLogo || v.awayLogo,
    homeTeamId: row.homeTeamId ?? v.homeTeamId,
    awayTeamId: row.awayTeamId ?? v.awayTeamId,
    topPerformer: row.topPerformer ?? v.topPerformer,
  }
}

/** Build the page payload. `userId` null = signed out; tie-ins are simply absent. */
export async function getLivePageData(opts: {
  userId: string | null
  sport?: string | null
  scope?: 'my' | 'all'
}): Promise<LivePageData> {
  const requested = String(opts.sport ?? 'NFL').toUpperCase()
  const sport: LiveSport = isLiveSport(requested) ? requested : 'NFL'
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
          ? await loadActiveSlate(s)
          : await getCachedLiveScoresForSport({ sport: s, team: null })
        /*
         * ⚠ EVERY TAB GETS THE SAME SLATE WINDOW. The cached reader returns
         * whatever `SportsGame` holds — potentially a whole season with no
         * expiry — so an un-windowed badge counts a months-old "in progress"
         * row as live forever. (Idempotent for the active sport, whose slate
         * loadActiveSlate already windows.)
         */
        const now = Date.now()
        const rows = (result?.scores ?? []).filter((row) => isInSlateWindow(row, now))
        return { sport: s, rows, fetchedAt: result?.fetchedAt ?? null, failed: false }
      } catch (err) {
        // Logged, not swallowed silently — an empty slate that is really an
        // outage should be findable in the server logs too, not just on screen.
        console.error(`[live] ${s} score fetch failed:`, err instanceof Error ? err.message : err)
        return { sport: s, rows: [] as LiveScoreRow[], fetchedAt: null, failed: true }
      }
    }),
  )

  /*
   * ⚠ THE BADGE COUNTS TODAY'S SLATE, NOT GAMES IN PROGRESS. User-confirmed
   * 2026-08-27, and the previous behaviour was indefensible either way:
   *
   * It was `rows.filter(isLiveRow)`, and `isLiveRow` matches only "progress",
   * "halftime", "end_period" or period > 0. Our own `SportsGame.status` column
   * holds at least four vocabularies — "NS", "scheduled", "FT", "Final", and
   * (genuinely) raw date strings like "8/27 - 7:05 PM EDT" written into the
   * status field by one of the ingest writers. NONE of those match, so every
   * sport read from the database scored zero live games forever.
   *
   * Only the ACTIVE sport could ever show a number, because `loadActiveSlate`
   * refreshes through ESPN and gets a real status vocabulary back. That is the
   * whole "the number vanishes when I click another tab" bug: not a UI defect,
   * a predicate that cannot read the data we store.
   *
   * `entry.rows` is already windowed by `isInSlateWindow`, and the cached reader
   * runs `pickFreshestSourceRows`, so this counts DISTINCT FIXTURES from one
   * source — not the 3-4 rows per fixture the table holds across feeds. Measured
   * on prod: NFL 4, MLB 7, NCAAF 53, which are the real slates.
   *
   * A sport genuinely out of season still reads 0 (NHL/NBA/NCAAB in August have
   * no rows at all). That zero is correct and must not be "fixed".
   *
   * ⚠ `isLiveRow` is still the right predicate for a single game's `isLive`
   * flag below, so it stays — but it is equally blind there for DB-sourced rows.
   * The real repair is on the ingest side: stop writing a date into `status`.
   */
  const counts = perSport.map((entry) => ({
    sport: entry.sport,
    label: SPORT_LABELS[entry.sport] ?? entry.sport,
    slateCount: entry.rows.length,
  }))

  const active = perSport.find((entry) => entry.sport === sport)
  const rows = active?.rows ?? []

  /*
   * ⚠ A ROSTER-READ FAILURE MUST NOT DISCARD AN ALREADY-FETCHED SLATE.
   *
   * This was the only unguarded await left on the path, and on 2026-08-27 it
   * blanked /core/live in production for every signed-in user: the
   * `league_player_weekly_scores` migration had never been applied to prod, so
   * `loadRosteredPlayers` threw P2021, the throw escaped `getLivePageData`, and
   * the page's `.catch(() => null)` turned it into "We could not read the slate
   * just now" — for a slate that had been fetched perfectly well moments before.
   * Two deploys chased it as a scores bug because the copy blames the slate.
   *
   * Roster tie-ins are an ENHANCEMENT, not the page. The null-user branch below
   * is the module's own documented contract for "no tie-ins available", and a
   * failed read is the same state arrived at differently — so degrade into it
   * rather than destroying the slate. Logged, because the page-level catch
   * cannot say which half failed.
   */
  let rosterFailed = false
  const { players, hasRosterData } = opts.userId
    ? await loadRosteredPlayers(opts.userId, sport).catch((err) => {
        console.error(
          '[live] roster tie-in read failed, rendering slate without it:',
          err instanceof Error ? err.message : err,
        )
        /*
         * ⚠ THE FLAG IS THE OTHER HALF OF THIS CATCH. Without it the catch
         * trades a crash for a lie, which is the worse of the two.
         *
         * `scope: 'my'` is the DEFAULT, and with no tie-ins it filters every
         * game away — so a silent degrade renders "None of your players are
         * playing right now" above "Claim a team in one of your leagues", to a
         * user who HAS claimed one and whose players may be on the field. Two
         * false statements, on a screen that looks perfectly healthy.
         *
         * ⚠ AND IT IS DELIBERATELY NOT `loadFailed`. That flag says the SLATE
         * failed. Blaming the slate for a roster fault is the same misdirection
         * that sent two deploys chasing a scores bug that was really an
         * unapplied migration. Distinct fault, distinct flag, distinct copy.
         */
        rosterFailed = true
        return { players: new Map<string, RosteredPlayer>(), hasRosterData: false }
      })
    : { players: new Map<string, RosteredPlayer>(), hasRosterData: false }

  // Real-world team -> your players on it.
  const byTeam = new Map<string, RosteredPlayer[]>()
  for (const p of players.values()) {
    if (!p.team) continue
    const list = byTeam.get(p.team) ?? []
    list.push(p)
    byTeam.set(p.team, list)
  }

  const nowMs = Date.now()
  const games: LiveGameCard[] = rows.map((sourceRow) => {
    const row = withRememberedPresentation(sport, sourceRow, nowMs)
    // A live-only sport keeps ESPN's abbreviations: the NFL table would make the
    // WNBA's "LA" Sparks "LAR" (see fetchEspnScoreboard).
    const home = isLiveOnlySport(sport) ? row.homeTeam : normalizeTeamAbbrev(row.homeTeam) || row.homeTeam
    const away = isLiveOnlySport(sport) ? row.awayTeam : normalizeTeamAbbrev(row.awayTeam) || row.awayTeam
    const involved = [...(byTeam.get(home) ?? []), ...(byTeam.get(away) ?? [])]

    const tieIns: LiveRosterTieIn[] = []
    for (const p of involved) {
      for (const l of p.leagues) {
        /*
         * STARTERS ONLY — user decision, 2026-09-13, replacing the handoff's
         * "build rule 4" (bench players visible, dimmed). One WR rostered in
         * fifteen leagues printed fifteen rows, bench included, and a game card
         * several screens tall. A bench/IR/taxi slot does not score for you, so
         * it is also dropped from the live-impact total that sums these.
         */
        if (!l.isStarter) continue
        tieIns.push({
          leagueId: l.leagueId,
          leagueName: l.leagueName,
          playerId: p.playerId,
          playerName: p.name,
          position: p.position,
          imageUrl: p.imageUrl,
          isStarter: l.isStarter,
          points: l.points,
        })
      }
    }
    tieIns.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))

    // ESPN sends 0-0 before kickoff; a score is only real once play began.
    const played = hasStarted(row.status) || row.completed
    const sideFor = (teamId: string | null | undefined): 'home' | 'away' | null =>
      teamId == null ? null : teamId === row.homeTeamId ? 'home' : teamId === row.awayTeamId ? 'away' : null
    const s = row.completed ? null : row.situation ?? null
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
        score: played ? row.homeScore : null,
        record: row.homeRecord,
        linescores: played ? row.homeLinescores ?? [] : [],
        hits: played ? row.homeHits ?? null : null,
        errors: played ? row.homeErrors ?? null : null,
        leaders: played ? teamLeaders(row.homeTeamLeaders, home) : [],
        shooting: played ? row.homeShooting ?? null : null,
      },
      away: {
        abbrev: away,
        name: row.awayTeamFull,
        logo: row.awayLogo,
        score: played ? row.awayScore : null,
        record: row.awayRecord,
        linescores: played ? row.awayLinescores ?? [] : [],
        hits: played ? row.awayHits ?? null : null,
        errors: played ? row.awayErrors ?? null : null,
        leaders: played ? teamLeaders(row.awayTeamLeaders, away) : [],
        shooting: played ? row.awayShooting ?? null : null,
      },
      leaders: (row.leaders ?? []).map((l) => {
        const side = sideFor(l.teamId)
        return {
          label: l.label,
          name: l.name,
          shortName: l.shortName ?? null,
          statLine: l.statLine,
          position: l.position,
          headshot: l.headshot,
          teamAbbrev: side === 'home' ? home : side === 'away' ? away : null,
        }
      }),
      situation: s
        ? {
            downDistance: s.downDistanceText,
            shortDownDistance: s.shortDownDistanceText,
            distance: s.distance,
            ballOn: s.ballOnFromAway,
            possession: sideFor(s.possessionTeamId),
            isRedZone: s.isRedZone,
            homeTimeouts: s.homeTimeouts,
            awayTimeouts: s.awayTimeouts,
            lastPlay: s.lastPlayText,
            lastPlayType: s.lastPlayType,
            baseball: s.baseball ?? null,
          }
        : null,
      venue: row.venue ? { name: row.venue, location: row.venueLocation ?? null } : null,
      broadcast: row.broadcast ?? null,
      espnDetail: row.leaders !== undefined,
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
    impact: await buildImpact(visible, players, sport),
    // Never invented — see the field's note. Null means "we cannot date this".
    fetchedAt: active?.fetchedAt ?? null,
    hasRosterData,
    loadFailed: active?.failed ?? false,
    rosterFailed,
  }
}

/** Right-hand panel: your totals, the last notable play, and what is still to come. */
async function buildImpact(
  games: readonly LiveGameCard[],
  players: Map<string, RosteredPlayer>,
  sport: string,
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

  /*
   * ⚠ SCOPED BY SPORT, NOT BY GAME ID — AND THAT IS NOT THE OBVIOUS CHOICE.
   * The tempting scoping is "keep the plays whose `gameId` is on this slate".
   * It yields NOTHING, always, because the two ids come from different
   * providers: the feed is built from `SportsGame.externalId` rows where
   * `source: 'rolling_insights'`, while the active slate is fetched from ESPN
   * and carries `event.id`. They are different id spaces that happen to share a
   * field name. The feed's own cache key is `pbp:feed:NFL`, so the sport is the
   * scope that is both honest and non-empty.
   *
   * Skipping the read outright off-NFL also spares every other tab a cache
   * lookup that could only ever return plays it must not display.
   */
  const plays = sport === 'NFL' ? await getPlayFeed().catch(() => [] as PlayFeedItem[]) : []
  const liveGameIds = new Set(liveGames.map((g) => g.gameId))
  /*
   * The most recent play involving a player YOU roster, in a game that is
   * actually live. A league-wide "biggest play" would be editorialising with
   * data the user did not ask about.
   */
  const roster = [...players.values()]
  /*
   * ⚠ MATCHED ON A NORMALISED NAME, NOT WITH `===`. The roster side and the
   * play side come from different vendors and disagree about case, punctuation
   * and generational suffixes on 748 of 9,412 NFL names — see
   * `rosterPlayMatch.ts`, which holds the measurement and the reason a fuzzy
   * fallback is deliberately absent.
   */
  const rosterNames = rosterNameKeys(roster.map((r) => r.name))
  const mine = plays.find(
    (p) => liveGameIds.has(p.gameId) && isRosteredPlayer(rosterNames, p.playerName),
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
    plays,
    upNext,
  }
}
