import 'server-only'

import { prisma } from '@/lib/prisma'
import { sleeperLookupId, withTeamDefenseIds } from './rosterIdCrosswalk'
import { lineupCrosswalkToSleeperIds, lineupRegistryNames, type LineupRegistryName } from './lineupCrosswalk'
import { ownPointsByPlayer } from './matchupOwnPoints'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import {
  composePlayerIdentities,
  type ComposedPlayerIdentity,
} from './playerIdentityCompose'
import { displayPosition, inferSlotLabel } from './positionLabels'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { currentScheduledLeagueWeek, leagueWeekProgress } from './leagueWeekProgress'
import { loadFinishedNflWeeks } from './finishedNflWeeks'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { forecastSidesFor, projectedFinalFor, winProbabilityFor, type Unavailable } from './matchupProjections'
import { BEST_BALL_REASON, matchupStarted, SCORING_TYPE_REASON, STATES_UNKNOWN_REASON } from './matchupForecast'
import { weeklyFormat } from './weeklyCapabilities'
import { loadMatchupSides, matchupLivePoints } from './matchupWinInputs'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { assignLineupToSlots, expandSlotCountTemplate, startingSlotTemplate } from './rosterSlots'
import { identityGapNote } from './identityGap'
import { resolveSourceLink, type SourceLink } from '@/lib/league-links/sourceLinkResolver'
import { fantraxSourceLeagueIds, linkableSourceLeagueId } from '@/lib/league-links/resolveSourceLinkForLeague'
import { verifiedHandoff, type PlatformLink } from './platformLinks'
import { leagueContextFor, type LeagueContext } from './leagueContext'
import { createRenderTimer, type RenderTimer } from './renderTiming'
import { isBestBallSettings } from './lineupMode'
import { clubGameIndex, starterGameStates, type StarterGameState } from './matchupGameState'
import { gameResultFor, nflStatLine, type GameResult } from './matchupGameLine'
import { bestBallProjectedFinal } from './bestBallForecast'
import { realManagerName, rosterLabel } from './managerName'
import { eliminationFormat, type EliminationFormat } from './railMatchupMode'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { readExtraMatchupViewForSeason } from '@/lib/redraft/oddTeamExtraMatchup'
import { withNewestKickoffs } from './nextGameMap'
import type { ExtraMatchupView } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { loadOfficialWeeklyRows } from '@/lib/league/switching/officialWeeklyRows'
import { isOfficialOnAllFantasy } from '@/lib/league/switching/switchingLeague'

/*
 * The opposing side's two name lines. The importer stores an unowned Sleeper roster as team
 * "Unknown" / owner "Unknown", which this page printed verbatim; a placeholder is no name
 * (managerName.ts). The title is the real team, else the real owner, else the platform's own
 * "Team N" — the label every Core surface uses (`rosterLabel`). The owner line only appears under
 * a real team name: when the title already IS the owner, repeating it underneath is noise.
 */
type OpponentTeam = { teamName?: string | null; ownerName?: string | null } | null | undefined
function opponentTeamName(t: OpponentTeam, rosterId: string | number): string {
  return rosterLabel([t?.teamName, t?.ownerName], rosterId)
}
function opponentOwnerName(t: OpponentTeam): string {
  return realManagerName(t?.teamName) ? realManagerName(t?.ownerName) ?? '' : ''
}

/**
 * A crest we can actually render, or null.
 *
 * ⚠ SLEEPER STORES AN AVATAR *ID* IN THE SAME COLUMN AS A URL. Production
 * carries both spellings, so a bare id is expanded to its CDN path and anything
 * else unresolvable returns null — which renders initials rather than a broken
 * <img>. Same rule as `imageOf` in dash34.ts and `asImageUrl` in matchupPulse.ts.
 */
function asImageUrl(raw: string | null | undefined, platform: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (String(platform ?? '').toLowerCase() === 'sleeper') {
    return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(v)}`
  }
  return null
}

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT = '0'

/**
 * Long-form positions, as several ingest paths store them.
 *
 * ⚠ `normalizePositionForSport` FOLDS ABBREVIATIONS AND NOTHING ELSE, so
 * "Quarterback" comes back as "QUARTERBACK" — which then becomes the slot label
 * and reads as a different position from the "QB" beside it. Measured on
 * production: 415 Wide Receiver, 216 Running Back, 135 Quarterback and so on,
 * so this is the common spelling rather than an edge case.
 */

/**
 * Slot labels in the order fantasy lineups conventionally read.
 *
 * Mirrors `inferSlotLabel` in myTeam.ts deliberately: the two screens render the
 * same lineup and must not disagree about what a slot is called.
 */

/**
 * Matchup — "live head-to-head, what's left to play, and what decides it".
 *
 * ⚠ WeeklyMatchup.leagueId IS THE PLATFORM LEAGUE ID, not our canonical
 * League.id. Querying it with a League.id returns nothing and the screen reports
 * "no matchup data" for a league that has a full season of it — the two-id-space
 * trap this codebase has fallen into repeatedly. The lookup below goes
 * League.platformLeagueId → WeeklyMatchup.leagueId deliberately.
 *
 * ⚠ Only some of that data is reachable. Of six leagues with WeeklyMatchup rows,
 * three have no canonical League row at all — including the one holding a full
 * 17-week season. That data is orphaned, not ours to show, and the screen says
 * the week is unavailable rather than pretending the league never played.
 *
 * Rosters pair by matchupId: two roster ids sharing one matchupId are the two
 * sides of a game. rosterId joins to LeagueTeam.externalId.
 */

/**
 * Who is playing, with no claim about the score.
 *
 * ⚠ SPLIT OUT OF `MatchupSide` BECAUSE IDENTITY AND SCORE BECOME KNOWN AT
 * DIFFERENT TIMES. Both crests, both team names and both records are on file
 * from the moment the week's fixture is, which is days before anyone scores a
 * point — and `sides` is unavailable for the whole of that window on purpose
 * (a 0-0 is a scheduled week, not a result). Rendering the head-to-head from
 * `sides` alone therefore blanked the hero of this screen for most of the week,
 * crests included, over a number nobody had claimed yet.
 */
export type MatchupTeam = {
  teamName: string
  ownerName: string
  record: string | null
  isYou: boolean
  /**
   * The manager's own crest, as the platform published it. Already a full URL
   * on every row production carries — 984 of 1,130 `LeagueTeam` rows have one —
   * and a bare Sleeper hash is expanded before it reaches here.
   */
  avatarUrl: string | null
}

export type MatchupSide = {
  teamName: string
  ownerName: string
  record: string | null
  points: number
  isYou: boolean
  /**
   * The manager's own crest, as the platform published it. Already a full URL
   * on every row production carries — 984 of 1,130 `LeagueTeam` rows have one —
   * and a bare Sleeper hash is expanded before it reaches here.
   */
  avatarUrl: string | null
}

/**
 * One player in one side of a slot row.
 *
 * ⚠ `projected` AND `actual` ARE DIFFERENT CLAIMS AND ARE NEVER MERGED. A
 * projection is what we expect; an actual is what the source platform scored.
 * Collapsing them into one "points" field is how a projection ends up rendered
 * in a live column, showing a player scoring in a game that has not kicked off.
 */
export type MatchupPlayerCell = {
  playerId: string
  /**
   * The Sleeper id this cell resolved THROUGH, when it resolved at all.
   *
   * ⚠ NOT THE SAME AS `playerId`, AND THAT IS THE WHOLE REASON IT EXISTS.
   * `playerId` is the ROSTER's own id — on a Sleeper league that happens to be
   * the Sleeper id, but an ESPN roster holds ESPN ids and a Yahoo roster holds
   * Yahoo ids. Anything keyed on Sleeper (the player card, the value tables)
   * needs the id the identity join actually matched on, which the loader knows
   * and used to hold privately. Null whenever the row did not resolve, so a
   * caller cannot mistake an unresolved ESPN id for a Sleeper one.
   */
  sleeperId: string | null
  /** Null when the id does not resolve to a player row — a bridge failure, shown as such. */
  name: string | null
  position: string | null
  team: string | null
  /** The league's sport, so the club crest resolves off the right CDN. */
  sport: string | null
  imageUrl: string | null
  /** Priced under THIS league's own scoring. Null means unpriced, never zero. */
  projected: number | null
  /** AllFantasy's own engine projection, adjusted to this league's scoring. Display only. */
  afEngine?: number | null
  /** Points as the SOURCE PLATFORM scored them. Null when none is ingested. */
  actual: number | null
  /** The platform recorded an unfilled starting slot. A hole, not a player. */
  empty: boolean
  /**
   * Why a starter's `projected` is a certain 0 — ruled out, or his club is off this week. Null for
   * everyone else, including a starter we merely could not price (that is `projected: null`).
   */
  unavailable: Unavailable | null
  /**
   * Where this starter's own game stands: `upcoming`, `live`, `final`, or `unknown` when his club
   * could not be placed against this week's fixtures. The same per-starter read that builds
   * `starterCounts`, kept per player so a live board can say WHICH starters are still to play
   * rather than only how many. A starter ruled out or on bye counts as `final` — nothing is left.
   */
  gameState?: StarterGameState | null
  /**
   * An injury designation that is an UNCERTAINTY — "Questionable", "Doubtful", "Day-To-Day" — as the
   * injury feed wrote it. A designation of absence is `unavailable: 'out'` instead, never both.
   */
  injury?: string | null
  /** His club's kickoff THIS week, as an ISO instant — formatted in the viewer's own zone. */
  kickoff?: string | null
  /** The club he plays this week, and whether at home. Null when his game could not be placed. */
  opponentClub?: string | null
  home?: boolean | null
  /**
   * His club's result, once his game is FINAL and both scores are stored (lib/core-app/matchupGameLine.ts).
   * Null while the game is upcoming or live: a live SportsGame score can trail the game by an hour.
   */
  result?: GameResult | null
  /**
   * His box score for the week — "12/19 CMP, 127 YD, 4 CAR, 22 YD" — from the stored Sleeper week
   * stats. NFL only, final games only, and null whenever no row or no volume stat exists. NFL week
   * stats are imported daily after the games, so a Sunday line appears the next morning.
   */
  statLine?: string | null
  /**
   * AllFantasy's own estimate of what he scored, from that same stored stat line under this league's
   * rules (lib/core-app/matchupOwnPoints.ts). Only when the platform's own per-player scores are not on
   * file, only for a final game, and never copied into `actual`.
   */
  ownPoints?: number | null
}

export type MatchupSlot = {
  slotLabel: string
  you: MatchupPlayerCell | null
  opponent: MatchupPlayerCell | null
}

/** One of a team's games in a multi-game week, as a line: who, the score, and how it went. */
export type MatchupWeekGame = {
  game: number
  opponentName: string | null
  yourPoints: number
  opponentPoints: number
  /** Null until the game has points on either side. */
  result: 'win' | 'loss' | 'tie' | null
  selected: boolean
}

type WeekGameRow = { rosterId: string; matchupId: number | null; game?: number | null; pointsFor: number; pointsAgainst: number }

/** A team's rows in one week, in game order: one in an ordinary league, several where teams play more. */
export function teamGamesInWeek<T extends WeekGameRow>(rows: readonly T[], rosterId: string): T[] {
  return rows.filter((r) => r.rosterId === rosterId).sort((a, b) => (a.game ?? 1) - (b.game ?? 1))
}

/** The week's games as lines, or null when the team plays only one (nothing to choose between). */
export function weekGameLines<T extends WeekGameRow>(
  rows: readonly T[],
  myGames: readonly T[],
  selected: T | null,
  teamName: (rosterId: string) => string | null,
): MatchupWeekGame[] | null {
  if (myGames.length < 2) return null
  return myGames.map((row) => {
    const other = row.matchupId != null ? rows.find((r) => r.matchupId === row.matchupId && r.rosterId !== row.rosterId) : undefined
    const scored = row.pointsFor > 0 || row.pointsAgainst > 0
    return {
      game: row.game ?? 1,
      opponentName: other ? teamName(other.rosterId) : null,
      yourPoints: row.pointsFor,
      opponentPoints: row.pointsAgainst,
      result: !scored ? null : row.pointsFor > row.pointsAgainst ? 'win' : row.pointsFor < row.pointsAgainst ? 'loss' : 'tie',
      selected: row === selected,
    }
  })
}

export type MatchupData = {
  league: {
    id: string
    name: string
    platform: string
    /**
     * The league's sport as stored (`NFL`, `NBA`, …), so the board can read a slot label under the
     * right sport — "C" is a centre in the NBA and a catcher in MLB. Null when the row has none.
     */
    sport?: string | null
    bestBall?: boolean
    /** The league crest, when the platform published one. */
    logoUrl: string | null
    /**
     * Where to go to actually CHANGE something.
     *
     * ⚠ AllFantasy is READ-ONLY for an imported league, so every action ends on
     * the source platform. Resolved server-side through the one hardened
     * resolver — an exact-host HTTPS allowlist, never a URL built at the call
     * site. Null for a native league, where there is no source to open.
     */
    sourceLink: SourceLink | null
    /**
     * "Set lineup in <platform>" — the provider's lineup screen for YOUR team.
     *
     * User decision 2026-09-14: a swing alert opens this screen, and this is the one tap
     * from here to the fix. Only a VERIFIED lineup destination, and only once we know
     * which team is yours; null for MFL / Fantrax / Fleaflicker, a native league, or an
     * unclaimed team — never a guessed URL, never the league page under a lineup label.
     */
    lineupLink: PlatformLink | null
    /**
     * Set for a guillotine or survivor-guillotine league. Such a league has no weekly opponent —
     * the lowest score goes home — so this screen draws no head-to-head for it, even where the
     * provider published matchup ids. See `eliminationFormat`.
     */
    elimination?: EliminationFormat | null
  }
  week: SectionState<{ week: number; season: number; isFinal: boolean }>
  /**
   * An odd-team native league's extra matchup involving your team this week — the game the leftover
   * team plays instead of a bye. "Extra matchup vs <team> (last week's top scorer)". Null otherwise.
   */
  extraMatchup?: ExtraMatchupView | null
  /**
   * The two managers, available as soon as both rosters are identified — scored
   * week or not. `sides` below stays the SCORE, and stays unavailable until
   * there is one.
   */
  teams: SectionState<{ you: MatchupTeam; opponent: MatchupTeam }>
  sides: SectionState<{ you: MatchupSide; opponent: MatchupSide }>
  /**
   * The slot-by-slot board — your starter against theirs, at the same slot.
   *
   * Built from the two rosters' stored lineups and priced under this league's
   * own scoring. Live points are laid over the top wherever
   * `league_player_weekly_scores` carries them; where it does not, the row shows
   * the projection and `playerScoring` states that that is what it is.
   */
  lineups: SectionState<MatchupSlot[]>
  /**
   * Why the board carries unnamed rows, said ONCE.
   *
   * ⚠ A PLATFORM-LEVEL FAILURE MUST NOT RENDER AS N BROKEN PLAYERS. On an ESPN
   * league not one starter id resolves (0 of 145 across production), so without
   * this the board is a column of "Unresolved player" rows that look like a
   * roster problem. Null when every id resolved.
   */
  identityNote: string | null
  /**
   * Whether per-player LIVE scoring exists for this league and week.
   *
   * ⚠ THIS FIELD USED TO SAY "not ingested for imported leagues" UNCONDITIONALLY
   * AND THAT IS NO LONGER TRUE. `league_player_weekly_scores` has a writer
   * (`ingestSleeperPlayerScoresForWeek`, called from the connected-Sleeper
   * collector) and a reader. Measured on production 2026-08-29 the table is
   * still EMPTY — so the honest statement is per-league-and-week, resolved from
   * the rows themselves, not a blanket claim about the product.
   */
  playerScoring: SectionState<{ playersScored: number; source: string }>
  winProbability: SectionState<{
    pWin: number
    projectedMargin: number
    confidence: string
    detail: string
  }>
  projectedFinal: SectionState<{
    you: number
    opponent: number
    model?: 'best_ball_full_roster'
    /**
     * ⚠ TRAVELS WITH THE NUMBER SO A FRAGMENT CANNOT POSE AS A FINAL. A projected
     * final built from 7 of 10 starters always reads LOW, and both sides can be
     * short by different amounts — which silently tilts the comparison, not just
     * the totals.
     */
    unprojected: { you: number; opponent: number }
  }>
  yetToPlay: UnavailableSection
  /**
   * The same game-state tally `yetToPlay.reason` spells out, as numbers, so a caller does not parse prose.
   * Null when the lineups could not be read — absent data, never a zero.
   */
  starterCounts?: { upcoming: number; live: number; final: number; unknown: number } | null
  /** The same tally split by team, so one side's unknown game states never hide the other's. */
  starterCountsBySide?: {
    you: { upcoming: number; live: number; final: number; unknown: number }
    opponent: { upcoming: number; live: number; final: number; unknown: number }
  } | null
  /**
   * Every SCORED meeting between these two rosters in this league's weekly results, newest first,
   * excluding the week on screen. Within one platform league only — Sleeper issues a new league id
   * each season, so this is "this season" there, and the screen says "meetings on file", never
   * "all-time". Null when the opponent is unknown.
   */
  headToHead?: {
    wins: number
    losses: number
    ties: number
    meetings: Array<{ season: number; week: number; you: number; them: number }>
  } | null
  /** The neighbouring weeks this league has results stored for, for the week picker. */
  weekNav?: { prev: number | null; next: number | null } | null
  /**
   * Every game your team plays this week, when the league plays more than one a week (Fantrax leagues
   * with 3 or 5). The screen's detail is the one marked `selected`; the others are a tap away
   * (`?game=`). Absent in a league that plays one game a week.
   */
  weekGames?: MatchupWeekGame[] | null
}

type H2HRow = { seasonYear: number; week: number; rosterId: string; matchupId: number | null; pointsFor: number }

/**
 * The series between two rosters, from both rosters' weekly rows. PURE — exported for its test.
 *
 * A meeting is a week where the two rows share a matchup id AND someone scored: a bootstrapped 0-0
 * future week shares a matchup id too, and counting it would hand out ties for games not played.
 * `exclude` is the week on screen — the game being played, not history. Rows are expected to be
 * the two rosters only; whichever is not `mineId` is the opponent.
 */
export function headToHeadFrom(
  rows: ReadonlyArray<H2HRow>,
  mineId: string,
  exclude: { season: number; week: number },
): NonNullable<MatchupData['headToHead']> {
  const byWeek = new Map<string, { mine?: H2HRow; theirs?: H2HRow }>()
  for (const r of rows) {
    if (r.seasonYear === exclude.season && r.week === exclude.week) continue
    const key = `${r.seasonYear}:${r.week}`
    const slot = byWeek.get(key) ?? {}
    if (r.rosterId === mineId) slot.mine = r
    else slot.theirs = r
    byWeek.set(key, slot)
  }
  const meetings: Array<{ season: number; week: number; you: number; them: number }> = []
  for (const { mine: a, theirs: b } of byWeek.values()) {
    if (!a || !b || a.matchupId == null || a.matchupId !== b.matchupId) continue
    if (a.pointsFor === 0 && b.pointsFor === 0) continue
    meetings.push({ season: a.seasonYear, week: a.week, you: a.pointsFor, them: b.pointsFor })
  }
  meetings.sort((x, y) => y.season - x.season || y.week - x.week)
  return {
    wins: meetings.filter((m) => m.you > m.them).length,
    losses: meetings.filter((m) => m.you < m.them).length,
    ties: meetings.filter((m) => m.you === m.them).length,
    meetings: meetings.slice(0, 5),
  }
}

export async function getMatchupData(
  leagueId: string,
  userId: string,
  weekParam?: number | null,
  /** The render's shared league context — see `leagueContext.ts`. */
  ctx?: LeagueContext | null,
  /** Which of the team's games this week to show in detail, in a league that plays several. */
  gameParam?: number | null,
): Promise<MatchupData | null> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  /*
   * ⚠ THE NATIVE EXTRA-MATCHUP READ RUNS BESIDE THE BOARD, NOT AFTER IT (2026-11-14). It needs only
   * the league row (shared through `lc`), the user and the week asked for — nothing the board builds.
   * It was the last serial hop of every native league's Matchup tab AND of the league Overview,
   * which calls this loader. It never rejects (its own try/catch), and with no league row it returns
   * null without querying, so the one path that skipped it before — `data` null — still costs nothing.
   */
  const timer = createRenderTimer('matchup')
  const extraRead = timer.time('extraMatchup', nativeExtraMatchup(lc, userId, weekParam))
  const data = await buildMatchupData(lc, userId, weekParam, timer, gameParam)
  if (!data) return data
  const result = withExtraMatchupOpponent(data, await extraRead)
  timer.done({ platform: data.league.platform })
  return result
}

/**
 * An odd-team native league's extra matchup for your team this week, if it has one — read from the
 * leftover team's bye row, where the week-open hook fixed it (lib/redraft/oddTeamExtraMatchup.ts).
 *
 * ⚠ READ FROM THE NATIVE SEASON, NOT FROM `data.week`. This screen's week comes from `WeeklyMatchup`,
 * which only importers write, so for a native league `data.week` is unavailable and keying on it would
 * never find the pick. The week is the one asked for, else the season's current week. Null for every
 * imported league, and on any failure.
 */
async function nativeExtraMatchup(lc: LeagueContext, userId: string, weekParam: number | null | undefined): Promise<ExtraMatchupView | null> {
  try {
    const league = await lc.league()
    if (!league || !isNativePlatform(league.platform)) return null
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId: league.id },
      orderBy: { season: 'desc' },
      select: { id: true, currentWeek: true },
    })
    if (!season) return null
    const week = weekParam ?? season.currentWeek
    if (!(week >= 1)) return null
    const roster = await prisma.redraftRoster.findFirst({ where: { seasonId: season.id, ownerId: userId }, select: { id: true } })
    if (!roster) return null
    return await readExtraMatchupViewForSeason({ seasonId: season.id, week, redraftRosterId: roster.id })
  } catch {
    return null
  }
}

/**
 * The leftover team's "opponent" is the chosen team: name it, and its score, wherever this screen's
 * consumers (the matchup screen, the league home card, the live strip) would otherwise print
 * "Opponent not identified" for a bye.
 */
function withExtraMatchupOpponent(data: MatchupData, extra: ExtraMatchupView | null): MatchupData {
  if (!extra || extra.role !== 'leftover') return { ...data, extraMatchup: extra }
  const opponent = { teamName: extra.teamName, ownerName: '', record: null, isYou: false as const, avatarUrl: null }
  return {
    ...data,
    extraMatchup: extra,
    teams: data.teams.available
      ? { available: true, data: { ...data.teams.data, opponent: { ...data.teams.data.opponent, ...opponent } } }
      : data.teams,
    sides: data.sides.available && extra.theirScore != null
      ? { available: true, data: { ...data.sides.data, opponent: { ...data.sides.data.opponent, ...opponent, points: extra.theirScore } } }
      : data.sides,
  }
}

async function buildMatchupData(
  lc: LeagueContext,
  userId: string,
  weekParam: number | null | undefined,
  timer: RenderTimer,
  gameParam?: number | null,
): Promise<MatchupData | null> {
  const league = await lc.league()
  if (!league) return null

  const platform = String(league.platform ?? 'manual').toLowerCase()
  const sport = league.sport ?? null
  /* Pure reads of the league row, hoisted so the reads below can start before `base` exists. */
  const elimination = eliminationFormat(league)
  const progress = leagueWeekProgress(league)

  /*
   * ── Independent reads, started together (2026-11-14) ──────────────────
   *
   * Production measured a league screen at 7.1s with its first byte at 0.39s, and this loader runs
   * twice per Overview (its own tab, and inside `getLeagueHomeData`). The Fantrax link id, your
   * claimed team and the current week each need only the league row, yet ran one after another.
   * They now start here and are awaited where they were awaited before, under the SAME conditions:
   * the claimed team only for a league with a platform id, the week only when it is also not an
   * elimination league — exactly the paths that reached those awaits.
   *
   * ⚠ A read started here and awaited later must never reject unobserved: `timer.time` attaches
   * the handler. The two with no `.catch` (claimed team, current week) still rethrow at their await
   * sites, in the original order, so a failure throws the same error it always did.
   */
  const fantraxIdsRead = timer.time('fantraxIds', fantraxSourceLeagueIds([league]))
  const claimedTeamRead = league.platformLeagueId
    ? timer.time('claimedTeam', lc.claimedTeam())
    : Promise.resolve(null)
  const resolvedRead = league.platformLeagueId && !elimination
    ? timer.time('currentWeek', resolveCurrentWeekForLeague(league.platformLeagueId, weekParam ?? progress.currentWeek))
    : Promise.resolve(null)

  /* Fantrax's real league id, for the "Open in Fantrax" link — `platformLeagueId` is our own snapshot uuid there. */
  const linkLeagueId = linkableSourceLeagueId(league, await fantraxIdsRead)

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform,
      sport,
      bestBall: league.bestBallMode === true || league.leagueVariant === 'best_ball' || isBestBallSettings(league.settings),
      logoUrl: asImageUrl(league.logoUrl, platform) ?? asImageUrl(league.avatarUrl, platform),
      sourceLink: resolveSourceLink({
        platform: league.platform,
        sourceLeagueId: linkLeagueId,
        leagueName: leagueDisplayName(league.name),
        season: league.season,
        action: 'matchup',
      }),
      /* Set once the user's team is known, below. */
      lineupLink: null as PlatformLink | null,
      elimination,
    },
    /*
     * The default for every early-return path. Overridden the moment both
     * rosters are identified — which happens before anyone scores, which is the
     * whole reason this section is separate from `sides`.
     */
    teams: {
      available: false as const,
      reason: 'no matchup resolved, so there are no teams to name',
    },
    lineups: {
      available: false as const,
      reason: 'no matchup resolved, so there are no lineups to pair',
    },
    identityNote: null as string | null,
    // Each of these needs per-player weekly scoring, which no writer produces for
    // imported leagues. A win probability invented from a points ratio is the
    // most authoritative-looking wrong number this product could print.
    playerScoring: {
      available: false as const,
      reason: 'no matchup resolved, so no per-player scoring was looked for',
    },
    winProbability: {
      available: false as const,
      reason:
        'a win probability needs both lineups priced — and a ratio of current points would not be a probability',
    },
    /*
     * The default for the early-return paths. Overridden below once both sides
     * resolve to a roster. It is deliberately NOT phrased as "no feed exists" —
     * that was the old wording and it was false: the feed carries 994 rows.
     */
    projectedFinal: {
      available: false as const,
      reason: 'no matchup resolved, so there is nothing to project',
    },
    starterCounts: null as MatchupData['starterCounts'],
    starterCountsBySide: null as MatchupData['starterCountsBySide'],
    yetToPlay: {
      available: false as const,
        reason: 'Starter game states are unavailable until both lineups can be read.',
    },
  }

  const platformLeagueId = league.platformLeagueId
  if (!platformLeagueId) {
    const noPlatform = {
      available: false as const,
      reason: 'this league has no platform id, so its weekly results cannot be located',
    }
    return { ...base, week: noPlatform, sides: noPlatform }
  }

  // Which team is the user's, in canonical space.
  const myTeam = await claimedTeamRead

  /*
   * "Set lineup in <platform>" — only once we know which team is yours. ESPN and Yahoo
   * lineup URLs carry that team's id; Sleeper's opens on the signed-in user's own team,
   * but offering "your lineup" for a league where we cannot find your team would still
   * be a guess. Verified-only: no league-page fallback under a lineup label.
   */
  base.league.lineupLink = myTeam?.externalId && !(league.bestBallMode === true || league.leagueVariant === 'best_ball' || isBestBallSettings(league.settings))
    ? verifiedHandoff(
        {
          id: league.id,
          platform: league.platform,
          platformLeagueId,
          season: league.season,
          name: league.name,
          teamId: myTeam.externalId,
        },
        'lineup',
      )
    : null

  /*
   * 🛑 AN ELIMINATION LEAGUE HAS NO OPPONENT, WHATEVER THE PROVIDER'S MATCHUP IDS SAY. Pairing on
   * them drew "Survivor All-Stars Guillotine" as a head-to-head with a win probability (production,
   * 2026-10-02) while the rail beside it correctly showed an elimination row. Returned after the
   * lineup link so "Set lineup" still works; the screen explains the format instead of a versus.
   */
  if (base.league.elimination) {
    const noOpponent = {
      available: false as const,
      reason: 'a Guilly league is scored against the whole field each week, so there is no single opponent',
    }
    return { ...base, week: noOpponent, teams: noOpponent, sides: noOpponent }
  }

  /*
   * ⚠ THE EARLIEST UNPLAYED WEEK, NOT `max(week)`. This screen named your
   * WEEK-18 opponent as this week's for as long as the sync bootstrapped a
   * full unscored season ahead of kickoff — a wrong answer delivered with
   * total confidence, which is worse than the empty state it replaced. An
   * explicit ?week= still wins; only the inference changed. See
   * lib/core-app/currentWeek.ts.
   */
  const resolved = await resolvedRead

  if (!resolved) {
    const noWeek = {
      available: false as const,
      reason: 'no weekly results stored for this league',
    }
    return { ...base, week: noWeek, sides: noWeek }
  }
  let latest = resolved

  /*
   * 🛑 FINAL ON TUESDAY, NOT WEDNESDAY. Without the finished-week read, `leagueWeekProgress` waits for
   * the platform to advance its week marker — Wednesday on Sleeper — so this page said "Live" for a
   * day and a half after the last whistle. The all-leagues board and the home already pass it; this
   * page was the one reader that did not (audit, 2026-10-02).
   *
   * Both reads below key only on the RESOLVED week (`latest` is not adjusted until after both), so
   * they run together (2026-11-14). Each keeps its own `.catch`.
   */
  const finishedNflRead =
    String(sport ?? '').toUpperCase() === 'NFL'
      ? timer.time('finishedNfl', loadFinishedNflWeeks([{ season: latest.seasonYear, week: latest.week }]).catch(() => undefined))
      : Promise.resolve(undefined)
  /*
   * 🛑 AN OFFICIAL SWITCHING LEAGUE IS SCORED BY ALLFANTASY, so its week comes from AllFantasy's own
   * schedule (lib/league/switching/officialWeeklyRows.ts), in the same row shape. Its `WeeklyMatchup`
   * rows are the platform's and are shared with every other user who imported the league.
   */
  const official = isOfficialOnAllFantasy(league.settings)
  const storedWeeksRead = timer.time('storedWeeks', (official
    ? loadOfficialWeeklyRows(league, latest.seasonYear).then((r) => [...new Set((r ?? []).map((x) => x.week))])
    : prisma.weeklyMatchup
      .groupBy({ by: ['week'], where: { leagueId: platformLeagueId, seasonYear: latest.seasonYear } })
      .then((g) => g.map((r) => r.week)))
    .then((weeks) => weeks.sort((a, b) => a - b))
    .catch(() => [] as number[]))
  const finishedNfl = await finishedNflRead
  const finalProgress = finishedNfl ? leagueWeekProgress(league, finishedNfl) : progress

  const storedWeeks = await storedWeeksRead
  // Explicit historical selections remain on that week, including a finished Tuesday slate.
  if (weekParam == null && latest.week === progress.currentWeek) {
    const week = currentScheduledLeagueWeek(league, latest.seasonYear, storedWeeks, finishedNfl)
    if (week != null) latest = { ...latest, week }
  }
  const rows = official
    ? (await loadOfficialWeeklyRows(league, latest.seasonYear, { week: latest.week })) ?? []
    : await prisma.weeklyMatchup.findMany({
      where: { leagueId: platformLeagueId, seasonYear: latest.seasonYear, week: latest.week },
      select: { rosterId: true, matchupId: true, game: true, pointsFor: true, pointsAgainst: true, win: true },
    })
  // All-zero rows are a scheduled matchup, not a scored result.
  const anyPoints = rows.some((r) => r.pointsFor > 0 || r.pointsAgainst > 0)

  const week: MatchupData['week'] = {
    available: true,
    data: { week: latest.week, season: latest.seasonYear, isFinal: finalProgress.isFinal(latest.seasonYear, latest.week) },
  }

  /*
   * The weeks either side that this league actually has results stored for — the picker never
   * links to a week that would only render "no weekly results stored".
   */
  const weekNav = {
    prev: [...storedWeeks].reverse().find((w) => w < latest.week) ?? null,
    next: storedWeeks.find((w) => w > latest.week) ?? null,
  }

  if (!myTeam?.externalId) {
    return {
      ...base,
      week,
      weekNav,
      sides: {
        available: false,
        reason: 'we cannot tell which team in this league is yours, so there is no matchup to show',
      },
    }
  }

  // WeeklyMatchup.rosterId is String now, matching LeagueTeam.externalId
  // directly -- was Number.parseInt(...), which stopped matching the moment
  // rosterId became a native string instead of an Int this always had to
  // round-trip through.
  const myRosterId = myTeam.externalId
  // A league that plays several games a week has one row per game; the one asked for, else the first.
  const myGames = teamGamesInWeek(rows, myRosterId)
  const mine = myGames.find((r) => (r.game ?? 1) === gameParam) ?? myGames[0]

  if (!mine) {
    return {
      ...base,
      week,
      weekNav,
      sides: { available: false, reason: `your team has no result stored for week ${latest.week}` },
    }
  }

  const opponentRow =
    mine.matchupId != null
      ? rows.find((r) => r.matchupId === mine.matchupId && r.rosterId !== mine.rosterId)
      : undefined

  /*
   * ── The rest of the board's reads, started together (2026-11-14) ──────
   *
   * From here every path runs to the end, so the reads below happen exactly when they did before:
   * the team list always, this week's fixtures always, the head-to-head history only when there is
   * an opponent row. None depends on another — the fixtures and the history key only on the week and
   * the two roster ids already in hand — so they no longer queue behind the roster/projection work.
   * Each keeps its original `.catch` (the team list had none, and still rethrows at its await).
   */
  const teamsRead = timer.time('teams', prisma.leagueTeam.findMany({
    where: { leagueId: league.id },
    select: {
      externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true,
      platformUserId: true, avatarUrl: true,
    },
  }))
  const gamesRead = timer.time('games', prisma.sportsGame.findMany({
    where: { sport: sport ?? 'NFL', season: latest.seasonYear, week: latest.week, OR: [{ seasonType: 'regular' }, { seasonType: null }] },
    select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, fetchedAt: true, seasonType: true },
    take: 400,
  }).catch(() => []))
  /*
   * ── Head to head with this opponent ────────────────────────────────────
   *
   * One read: both rosters' rows in this league, every week on file. A meeting is a week where the
   * two share a matchup id AND points were scored — a bootstrapped 0-0 future week is not a meeting.
   * The week on screen is left out: it is the game being played, not history.
   */
  const headToHeadRead: Promise<MatchupData['headToHead']> = opponentRow
    ? timer.time('headToHead', (official
        // This season from AllFantasy's schedule; earlier seasons were played on the platform.
        ? Promise.all([
          loadOfficialWeeklyRows(league, latest.seasonYear, { rosterIds: [mine.rosterId, opponentRow.rosterId] }),
          prisma.weeklyMatchup.findMany({
            where: { leagueId: platformLeagueId, seasonYear: { not: latest.seasonYear }, rosterId: { in: [mine.rosterId, opponentRow.rosterId] } },
            select: { seasonYear: true, week: true, rosterId: true, matchupId: true, pointsFor: true },
          }),
        ]).then(([thisSeason, earlier]) => [...earlier, ...(thisSeason ?? [])])
        : prisma.weeklyMatchup
        .findMany({
          where: { leagueId: platformLeagueId, rosterId: { in: [mine.rosterId, opponentRow.rosterId] } },
          select: { seasonYear: true, week: true, rosterId: true, matchupId: true, pointsFor: true },
        }))
        .then((rowsAll) => headToHeadFrom(rowsAll, mine.rosterId, { season: latest.seasonYear, week: latest.week }))
        .catch(() => null))
    : Promise.resolve(null)

  const teams = await teamsRead
  const teamByExternal = new Map(teams.map((t) => [String(t.externalId), t]))

  const oppTeam = opponentRow ? teamByExternal.get(String(opponentRow.rosterId)) : undefined
  const weekGames = weekGameLines(rows, myGames, mine ?? null, (rosterId) => teamByExternal.get(String(rosterId))?.teamName?.trim() || null)

  /*
   * Roster keys and projections for both sides — shared with the home exposure
   * breakdown (`loadMatchupSides`) so the two cannot price one week differently. The
   * roster-join and season/week notes live there with the code they describe.
   */
  const sideProjections = await loadMatchupSides({
    leagueId: league.id,
    season: latest.seasonYear,
    week: latest.week,
    userId,
    you: { platformUserId: myTeam.platformUserId, externalId: myTeam.externalId },
    opponent: opponentRow
      ? { platformUserId: oppTeam?.platformUserId ?? null, rosterId: String(opponentRow.rosterId) }
      : null,
    // A Sleeper league's live lineups for this week, where Sleeper can vouch for them. Not once the league
    // is official: a switched team's lineup is set here, and AllFantasy's stored lineups cover every team.
    source: official ? null : { platform: league.platform, platformLeagueId },
  })

  const anyProjected =
    sideProjections != null &&
    sideProjections.you.starters.length + sideProjections.opponent.starters.length > 0

  /* ── The slot-by-slot board ─────────────────────────────────────────────
   *
   * Your starter against theirs at the same slot, with a headshot on each.
   *
   * ⚠ THE TWO LINEUPS ARE PAIRED BY INDEX, NOT MATCHED BY POSITION. That is how
   * every platform stores a lineup — `starters[3]` is the same slot for both
   * teams because the league's roster template defines it — and it is the only
   * pairing that survives a FLEX. Matching by position instead would put your
   * WR3 against their RB2 whenever the two teams flex differently, which reads
   * as a scoring comparison and is not one.
   *
   * ⚠ AND THE COLUMNS ARE PROJECTIONS UNTIL THE PLATFORM SCORES THEM. `actual`
   * is filled only from `league_player_weekly_scores`, which is the source
   * platform's own number. Nothing here ever promotes a projection into that
   * field — see the note on MatchupPlayerCell.
   */
  const lineupIds = sideProjections
    ? [
        ...sideProjections.you.lineup.map((s) => s.playerId),
        ...sideProjections.opponent.lineup.map((s) => s.playerId),
      ].filter((id) => id !== EMPTY_SLOT && !id.startsWith('name:'))
    : []
  const scoreIds = [...new Set([
    ...lineupIds,
    ...(sideProjections?.bestBall?.you.map((p) => p.playerId) ?? []),
    ...(sideProjections?.bestBall?.opponent.map((p) => p.playerId) ?? []),
  ])]

  /*
   * The platform's own per-player scores are keyed on the ROSTER's ids, not the translated ones, so
   * this read needs nothing from the crosswalk below and starts before it (2026-11-14).
   */
  const scoreRowsRead = timer.time('playerScores', scoreIds.length
    ? prisma.leaguePlayerWeeklyScore
        .findMany({
          where: {
            leagueId: platformLeagueId,
            seasonYear: latest.seasonYear,
            week: latest.week,
            playerId: { in: scoreIds },
          },
          select: { playerId: true, points: true, source: true },
        })
        .catch(() => [])
    : Promise.resolve([]))

  /*
   * ── Foreign roster ids, translated before the join ──────────────────────
   *
   * ⚠ THE `sleeperId` JOIN BELOW HAS NEVER MATCHED AN ESPN ROSTER, because an
   * ESPN roster carries ESPN athlete ids. Every cell on this board rendered as
   * an unresolved row for those leagues. `PlayerIdentityMap` now holds the
   * bridge — see `rosterIdCrosswalk.ts` — so the ids are translated here and the
   * ORDINARY path resolves them: name, position, club and headshot, and a
   * projection, because the projection feed is keyed on Sleeper ids too.
   *
   * Measured 2026-08-30: 127 of 176 distinct ESPN roster ids translate, and all
   * 127 exist in `SportsPlayer`. The rest stay unresolved and are still counted
   * by the identity note, which is the honest outcome for an id we hold no
   * bridge for.
   *
   * ⚠ THE MAP IS KEYED ON THE ORIGINAL ROSTER ID, NOT THE TRANSLATED ONE.
   * Everything downstream — slot order, cell lookup, the weekly score join —
   * addresses players by the id the roster actually holds, and `leaguePlayerWeeklyScore`
   * is written with the platform's own ids too. Translating anything but this
   * one lookup would silently break the score join.
   */
  const playerCrosswalk = scoreIds.length
    ? await timer.time('crosswalk', lineupCrosswalkToSleeperIds(league.platform, sport, scoreIds).catch(
        () => new Map<string, string>(),
      ))
    : new Map<string, string>()
  /* A Fantrax starter the crosswalk could not translate is still named, from the registry (see lineupCrosswalk.ts). */
  const untranslatedIds = scoreIds.filter((id) => !playerCrosswalk.has(id))
  const registryNames = untranslatedIds.length
    ? await timer.time('registryNames', lineupRegistryNames(league.platform, sport, untranslatedIds, platformLeagueId).catch(
        () => new Map<string, LineupRegistryName>(),
      ))
    : new Map<string, LineupRegistryName>()
  /* ⚠ ESPN D/ST ids (`-16002` is BUF) are not in the player crosswalk; the id alone names the club. */
  const sleeperIdByRosterId = String(sport ?? 'NFL').toUpperCase() === 'NFL'
    ? withTeamDefenseIds(league.platform, playerCrosswalk, scoreIds.map((playerId) => ({ playerId })))
    : playerCrosswalk

  const lookupIds = [
    ...new Set(
      scoreIds
        .map((id) => sleeperLookupId(league.platform, id, sleeperIdByRosterId, sport))
        .filter((x): x is string => x != null),
    ),
  ]

  const identityRowsRead = timer.time('identities', scoreIds.length
    ? prisma.sportsPlayer
        .findMany({
          // Scoped to the league's sport: Sleeper's NFL and NBA pools reuse the same ids, so an
          // unscoped join named an NFL player in an NBA cell. Unknown sport reads as NFL, as the
          // fixture query below does.
          where: { sport: String(sport ?? 'NFL').toUpperCase(), sleeperId: { in: lookupIds } },
          // `sport` is required by `composePlayerIdentities` — it gates the NFL-only
          // club fold, and omitting it would silently leave every club unfolded.
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true, source: true, fetchedAt: true },
        })
        .catch(() => [])
    : Promise.resolve([]))
  /*
   * NFL box scores for this week, keyed on the Sleeper id — the key /api/cron/import-player-game-stats
   * writes them under (source 'sleeper'). Postgres only; nothing here calls a provider. Other sports'
   * rows come from other writers under other ids, so they are not read here at all. Needs only the
   * translated ids, so it starts beside the identity read rather than after it (2026-11-14).
   */
  const statRowsPromise = timer.time('statLines',
    String(sport ?? 'NFL').toUpperCase() === 'NFL' && lookupIds.length
      ? prisma.playerGameStat
          .findMany({
            where: { sportType: 'NFL', source: 'sleeper', season: latest.seasonYear, weekOrRound: latest.week, playerId: { in: lookupIds } },
            select: { playerId: true, statPayload: true, normalizedStatMap: true },
          })
          .catch(() => [])
      : Promise.resolve([]))

  const [identityRows, scoreRows] = await Promise.all([identityRowsRead, scoreRowsRead])

  /*
   * ⚠ `sleeperId` IS NOT UNIQUE IN `SportsPlayer`, AND THE DUPLICATES ARE NOT
   * COPIES — see `composePlayerIdentities`, which holds the measurement and the
   * reason. Taking the first row arbitrarily is what rendered Mike Evans, David
   * Montgomery and Evan Engram as grey letters in one lineup on this screen.
   */
  const bySleeperId = composePlayerIdentities(identityRows)

  /*
   * Re-keyed onto the roster's own ids, so every reader below is unchanged. A
   * Sleeper league maps id-to-itself and this is a no-op for it.
   */
  const identityBy = new Map<string, ComposedPlayerIdentity>()
  for (const rosterId of scoreIds) {
    const lookup = sleeperLookupId(league.platform, rosterId, sleeperIdByRosterId, sport)
    const row = lookup ? bySleeperId.get(lookup) : undefined
    if (row) identityBy.set(rosterId, row)
  }
  const actualBy = new Map(scoreRows.map((r) => [r.playerId, r.points]))
  // Started beside the team list, above.
  const games = await gamesRead
  const states = starterGameStates(identityBy, games)
  /*
   * The result line reads the SAME per-club row the state above came from, so a "final" marker and a
   * score can never come from two different provider rows.
   */
  const gameIndex = clubGameIndex(games)
  const resultOf = (club: string | null | undefined): GameResult | null => {
    const g = club ? gameIndex.get(club) : undefined
    if (!g) return null
    return gameResultFor(club, {
      home: normalizeTeamAbbrev(g.homeTeam) ?? null,
      away: normalizeTeamAbbrev(g.awayTeam) ?? null,
      homeScore: g.homeScore ?? null,
      awayScore: g.awayScore ?? null,
    })
  }
  // Started above, beside the identity read, so it costs no extra round trip.
  const statRows = await statRowsPromise
  const statLineBy = new Map<string, string>()
  for (const row of statRows) {
    const line = nflStatLine(row.statPayload)
    if (line && !statLineBy.has(row.playerId)) statLineBy.set(row.playerId, line)
  }
  /*
   * With no platform score on file for anyone, price those same lines under this league's rules. Shown
   * beside the box score as an estimate; `actual`, the live totals and the win probability are untouched.
   */
  const ownPointsBy = scoreRows.length === 0
    ? ownPointsByPlayer(statRows, extractScoringSettings(league.settings))
    : new Map<string, number>()
  /*
   * Each club's game THIS week — kickoff and opponent — from the same rows the states come from.
   * Regular-season fixtures only (an untyped live-writer row may be a preseason reading), earliest
   * kickoff wins. A club with no fixture this week gets nothing, never a guess.
   */
  const gameByClub = new Map<string, { kickoff: string | null; opponent: string | null; home: boolean }>()
  /*
   * Kickoffs from the newest-fetched row for each game: a weekly-refreshed source can carry a time
   * the league has since moved, and the untyped rows are often the fresh ones. See `withNewestKickoffs`.
   */
  for (const g of withNewestKickoffs(games.filter((x) => x.seasonType === 'regular'), games)
    .sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0))) {
    const home = normalizeTeamAbbrev(g.homeTeam)
    const away = normalizeTeamAbbrev(g.awayTeam)
    const kickoff = g.startTime ? g.startTime.toISOString() : null
    if (home && !gameByClub.has(home)) gameByClub.set(home, { kickoff, opponent: away ?? null, home: true })
    if (away && !gameByClub.has(away)) gameByClub.set(away, { kickoff, opponent: home ?? null, home: false })
  }
  const fixtureOf = (club: string | null | undefined) => {
    const g = club ? gameByClub.get(club) : undefined
    return g ? { kickoff: g.kickoff, opponentClub: g.opponent, home: g.home } : { kickoff: null, opponentClub: null, home: null }
  }
  const atRisk = sideProjections?.atRiskBySleeperId ?? {}
  const counts = { upcoming: 0, live: 0, final: 0, unknown: 0 }
  const bySide = {
    you: { upcoming: 0, live: 0, final: 0, unknown: 0 },
    opponent: { upcoming: 0, live: 0, final: 0, unknown: 0 },
  }
  for (const [sideKey, side] of sideProjections
    ? ([['you', sideProjections.you], ['opponent', sideProjections.opponent]] as const)
    : []) {
    for (const slot of side.lineup) {
      if (slot.playerId === EMPTY_SLOT) continue
      const state = slot.unavailable ? 'final' : states.get(slot.playerId) ?? 'unknown'
      counts[state]++
      bySide[sideKey][state]++
      const player = side.starters.find((p) => p.playerId === slot.playerId)
      if (player) player.isFinal = state === 'final'
    }
  }
  if (sideProjections) base.starterCounts = { ...counts }
  if (sideProjections) base.starterCountsBySide = bySide
  if (sideProjections) base.yetToPlay.reason = `${counts.upcoming} yet to start · ${counts.live} in progress · ${counts.final} finished or unavailable${counts.unknown ? ` · ${counts.unknown} game states unavailable` : ''}`
  const bestBall = league.bestBallMode === true || league.leagueVariant === 'best_ball' || isBestBallSettings(league.settings)

  /*
   * ── Projected final and win probability, from what is on the board ─────
   *
   * 🛑 COMPUTED AFTER THE PER-PLAYER SCORES, BECAUSE THEY NEED THEM. Both used to run
   * before `scoreRows` was read, with only the two team totals to go on: the win
   * probability banked a team's whole score on its first starter, and the projected
   * final ignored the score entirely — "110 vs 110" beside a 25–0 scoreboard. Each
   * starter's own points now decide how much of his projection is still to come
   * (`lib/core-app/matchupProjections.ts`, `liveSide`). With points on the board and
   * no per-player rows (every non-Sleeper league today), both refuse with one reason
   * rather than guess.
   */
  const live = matchupLivePoints(mine, opponentRow, scoreRows.length ? actualBy : null)

  /*
   * ⚠ AN UNKNOWN GAME STATE ONLY MATTERS ONCE THE MATCHUP HAS STARTED. Before then nothing is banked
   * and nobody is final, so a schedule row fetched more than an hour ago (`starterGameStates`) has
   * nothing to get wrong — yet it refused the forecast here while the all-leagues board, rightly,
   * priced the same game. `matchupStarted` is the shared test (`matchupForecast.ts`).
   */
  const started = sideProjections ? matchupStarted(...forecastSidesFor(sideProjections, live, states)) : true
  const forecastReason = !bestBall && started && counts.unknown > 0 ? STATES_UNKNOWN_REASON : null

  const bestBallFinal = bestBall && sideProjections?.bestBall
    ? (() => {
        const full = sideProjections.bestBall!
        const you = bestBallProjectedFinal({ slots: full.slots, candidates: full.you, actualBy: scoreRows.length ? actualBy : null, stateBy: states, scoreboard: live.team.you })
        const opponent = bestBallProjectedFinal({ slots: full.slots, candidates: full.opponent, actualBy: scoreRows.length ? actualBy : null, stateBy: states, scoreboard: live.team.opponent })
        return you.available && opponent.available
          ? { available: true as const, data: { you: you.total, opponent: opponent.total, unprojected: { you: 0, opponent: 0 }, model: 'best_ball_full_roster' as const } }
          : { available: false as const, reason: !you.available ? `Your roster: ${you.reason}` : !opponent.available ? `Opponent roster: ${opponent.reason}` : 'full rosters cannot be projected' }
      })()
    : null

  /*
   * 🛑 A CATEGORY OR ROTO LEAGUE IS NOT WON ON THIS WEEK'S FANTASY POINTS, so neither number below means
   * anything there. The format is `weeklyFormat`'s, the rule the week board and Season Outlook already
   * apply; this screen handed those leagues a projected final and a win chance anyway.
   */
  const format = weeklyFormat(league)
  const scoringTypeRefusal = format === 'categories' || format === 'roto' ? { available: false as const, reason: SCORING_TYPE_REASON } : null

  const projectedFinal: MatchupData['projectedFinal'] = scoringTypeRefusal
    ? scoringTypeRefusal
    : bestBall
    ? bestBallFinal ?? { available: false, reason: 'both full rosters could not be verified' }
    : forecastReason ? { available: false, reason: forecastReason } : !anyProjected
    ? {
        available: false,
        reason: sideProjections
          ? sideProjections.leagueScoring.available === false
            ? sideProjections.leagueScoring.reason
            : `no starter could be priced for ${latest.seasonYear} week ${latest.week} — the feed does not cover this week, or this league's rules cannot score its stat lines`
          : 'we could not match both sides of this matchup to an imported roster',
      }
    : (() => {
        const totals = projectedFinalFor(sideProjections!, live)
        if (!totals.available) return totals
        return {
          available: true as const,
          data: {
            you: totals.data.you,
            opponent: totals.data.opponent,
            unprojected: {
              you: sideProjections!.you.unprojected,
              opponent: sideProjections!.opponent.unprojected,
            },
          },
        }
      })()

  /* Every refusal — best ball, unknown states after kickoff, unattributed points, unpriced starters — is the shared rule's. */
  const winProbability: MatchupData['winProbability'] = scoringTypeRefusal
    ? scoringTypeRefusal
    : sideProjections
    ? (() => {
        const result = winProbabilityFor(sideProjections, live, { states, bestBall })
        if (result.available) result.data.detail = `${base.yetToPlay.reason} · ${result.data.detail.replace(/starters? still to play/, 'starters with scoring remaining')}`
        return result
      })()
    : bestBall
      ? { available: false, reason: BEST_BALL_REASON }
      : {
          available: false,
          reason: 'we could not match both sides of this matchup to an imported roster',
        }

  /* The same rule the starter counts above use, so a marker and a count can never disagree. */
  const gameStateOf = (entry: { playerId: string; unavailable?: Unavailable | null }): StarterGameState =>
    entry.unavailable ? 'final' : states.get(entry.playerId) ?? 'unknown'

  /*
   * 🛑 THE SAME REFUSAL REACHES EVERY STARTER'S CELL. Withholding the projected final while each cell
   * still carried a points projection put the same meaningless claim on screen one row down. The
   * lineup — who starts where — is still shown; only the points projections are withheld.
   */
  const withholdPointsProjections = scoringTypeRefusal != null
  /* The result and box score, for a starter whose game is FINAL only (see matchupGameLine.ts). */
  const finalLines = (
    entry: { playerId: string; unavailable?: Unavailable | null },
    sleeperId: string | null,
    team: string | null | undefined,
  ): { result: GameResult | null; statLine: string | null; ownPoints: number | null } => {
    if (gameStateOf(entry) !== 'final') return { result: null, statLine: null, ownPoints: null }
    return {
      result: resultOf(normalizeTeamAbbrev(team)),
      statLine: sleeperId ? statLineBy.get(sleeperId) ?? null : null,
      // Not in a league whose scoring type we refuse to price: its projections are withheld for the same reason.
      ownPoints: sleeperId && !withholdPointsProjections ? ownPointsBy.get(sleeperId) ?? null : null,
    }
  }
  const cellFor = (
    raw: { playerId: string; projected: number | null; unavailable?: Unavailable | null; afEngine?: number | null } | undefined,
  ): MatchupPlayerCell | null => {
    if (!raw) return null
    const entry = withholdPointsProjections ? { ...raw, projected: null, afEngine: null } : raw
    if (entry.playerId === EMPTY_SLOT) {
      return {
        playerId: entry.playerId,
        sleeperId: null,
        name: null,
        position: null,
        team: null,
        sport,
        imageUrl: null,
        projected: null,
        actual: null,
        empty: true,
        unavailable: null,
      }
    }
    /*
     * ⚠ A `name:` DESCRIPTOR IS A REAL PLAYER WE COULD NOT ID, NOT AN EMPTY
     * SLOT. The importer writes `name:Lamar Jackson:QB:BAL` when it cannot
     * resolve a platform id; the name in it is the best identity we have and
     * throwing it away would render a filled slot as a hole.
     */
    if (entry.playerId.startsWith('name:')) {
      const [, rawName, rawPos, rawTeam] = entry.playerId.split(':')
      return {
        playerId: entry.playerId,
        // A `name:` descriptor exists precisely because no platform id resolved.
        sleeperId: null,
        name: rawName || null,
        position: displayPosition(rawPos),
        team: rawTeam ? normalizeTeamAbbrev(rawTeam) : null,
        sport,
        imageUrl: null,
        projected: entry.projected,
        afEngine: entry.afEngine ?? null,
        actual: actualBy.get(entry.playerId) ?? null,
        empty: false,
        unavailable: entry.unavailable ?? null,
        gameState: gameStateOf(entry),
        injury: null,
        ...fixtureOf(rawTeam ? normalizeTeamAbbrev(rawTeam) : null),
        // No platform id, so no box score; the club's final still applies.
        result: gameStateOf(entry) === 'final' ? resultOf(rawTeam ? normalizeTeamAbbrev(rawTeam) : null) : null,
        statLine: null,
      }
    }
    const identity = identityBy.get(entry.playerId)
    // Name, position and club only: with no Sleeper id there is no headshot, injury status or box score to attach.
    const registry = identity ? undefined : registryNames.get(entry.playerId)
    return {
      playerId: entry.playerId,
      /*
       * `identityBy` is only populated when this key matched a SportsPlayer row
       * BY SLEEPER ID, so the presence of `identity` is the proof that the
       * folded key below is a real Sleeper id rather than a passed-through
       * roster id.
       */
      sleeperId: identity ? sleeperLookupId(league.platform, entry.playerId, sleeperIdByRosterId, sport) : null,
      name: identity?.name ?? registry?.name ?? null,
      position: displayPosition(identity?.position ?? registry?.position),
      /*
       * ⚠ NORMALISED, BECAUSE THE CREST LOOKUP UPPERCASES WHAT IT IS GIVEN AND
       * DOES NOT NORMALISE. `SportsPlayer.team` holds "Kansas City Chiefs" on 32
       * distinct values in production; `teamLogoUrl` would hand
       * "KANSAS CITY CHIEFS" to the CDN resolver and get nothing back.
       */
      team: normalizeTeamAbbrev(identity?.team ?? registry?.team),
      sport,
      // Already vetted by `asHeadshotUrl` when the identity was composed.
      imageUrl: identity?.imageUrl ?? null,
      projected: entry.projected,
      afEngine: entry.afEngine ?? null,
      actual: actualBy.get(entry.playerId) ?? null,
      empty: false,
      unavailable: entry.unavailable ?? null,
      gameState: gameStateOf(entry),
      /* Only alongside a player who is still available — "OUT" already says the rest. */
      injury: !entry.unavailable && identity
        ? atRisk[sleeperLookupId(league.platform, entry.playerId, sleeperIdByRosterId, sport) ?? ''] ?? null
        : null,
      ...fixtureOf(normalizeTeamAbbrev(identity?.team ?? registry?.team)),
      ...finalLines(entry, identity ? sleeperLookupId(league.platform, entry.playerId, sleeperIdByRosterId, sport) : null, identity?.team ?? registry?.team),
    }
  }

  const lineups: MatchupData['lineups'] = sideProjections
    ? (() => {
        const yourLine = sideProjections.you.lineup
        const oppLine = sideProjections.opponent.lineup
        const depth = Math.max(yourLine.length, oppLine.length)
        if (depth === 0) {
          return {
            available: false as const,
            reason: 'neither roster has a starting lineup stored for this week',
          }
        }
        const template = startingSlotTemplate(league.settings)
        /*
         * ⚠ AN ESPN LINEUP CANNOT BE PAIRED BY INDEX. Its `starters` come in ESPN's roster-array order
         * — a WR first, the QB fifth — and the opponent's come in THEIR roster's order, so index
         * pairing put your WR against their QB under a label named after whoever stood on your side.
         * There is no aligned template to fall back on (`startingSlotTemplate` refuses ESPN's
         * SLOT:COUNT shape, rightly), so each side is PLACED into the league's own slot list instead
         * and the two are paired slot by slot. A Sleeper template and a native lineup never reach this.
         */
        const leagueSlots = template || isNativePlatform(league.platform) ? null : expandSlotCountTemplate(league.settings)
        if (leagueSlots) {
          const place = (line: typeof yourLine, slotById: Record<string, string> | null | undefined) =>
            assignLineupToSlots(
              leagueSlots,
              line.map((entry) => ({ entry, cell: cellFor(entry) })),
              (c) => slotById?.[c.entry.playerId],
              (c) => (c.cell && !c.cell.empty ? c.cell.position : null),
              sport,
            )
          const mine = place(yourLine, sideProjections.you.slotById)
          const theirs = place(oppLine, sideProjections.opponent.slotById)
          const placed: MatchupSlot[] = leagueSlots.map((slotLabel, i) => ({
            slotLabel,
            you: mine.slots[i]?.cell ?? null,
            opponent: theirs.slots[i]?.cell ?? null,
          }))
          // A starter who fits no slot the template names still shows — appended, never dropped.
          for (let i = 0; i < Math.max(mine.extra.length, theirs.extra.length); i++) {
            const you = mine.extra[i]?.cell ?? null
            const opponent = theirs.extra[i]?.cell ?? null
            placed.push({ slotLabel: inferSlotLabel(you?.position ?? opponent?.position ?? null, placed.length), you, opponent })
          }
          return { available: true as const, data: placed }
        }
        const slots: MatchupSlot[] = []
        for (let i = 0; i < depth; i++) {
          const you = cellFor(yourLine[i])
          const opponent = cellFor(oppLine[i])
          slots.push({
            slotLabel:
              template?.[i] ?? inferSlotLabel(you?.position ?? opponent?.position ?? null, i),
            you,
            opponent,
          })
        }
        return { available: true as const, data: slots }
      })()
    : {
        available: false as const,
        reason: 'we could not match both sides of this matchup to an imported roster',
      }

  /*
   * Coverage is counted over YOUR side only. Both lineups come from the same
   * league and therefore the same id space, so counting both would double a
   * single platform's failure and make "0 of 12" read as "0 of 24".
   */
  const identityNote = lineups.available
    ? identityGapNote({
        platform,
        total: lineups.data.filter((s) => s.you && !s.you.empty).length,
        named: lineups.data.filter((s) => s.you && !s.you.empty && s.you.name != null).length,
        /*
         * A cell is "priced" when it carries a projection. On this board that is
         * the number the whole screen exists to compare, so a lineup that is
         * fully named and wholly unpriced is exactly as unusable as one that is
         * nameless — and says so, rather than going quiet.
         */
        priced: withholdPointsProjections
          // Withheld by scoring type, not unpriceable — the "nobody could be priced" note would mislead.
          ? lineups.data.filter((s) => s.you && !s.you.empty && s.you.name != null).length
          : lineups.data.filter((s) => s.you && !s.you.empty && s.you.projected != null).length,
      })
    : null

  const playerScoring: MatchupData['playerScoring'] = scoreRows.length
    ? {
        available: true,
        data: {
          playersScored: actualBy.size,
          source: scoreRows[0]?.source ?? 'unknown',
        },
      }
    : {
        available: false,
        reason: withholdPointsProjections
          // The columns carry no projection in this league, so "each column is a projection" would be false.
          ? SCORING_TYPE_REASON
          : lineupIds.length
          ? `no per-player scoring has been ingested for ${latest.seasonYear} week ${latest.week}, so each column below is a projection priced under this league's rules — not a live score`
          : 'we could not match both sides of this matchup to an imported roster',
      }

  /*
   * ⚠ THE PROJECTIONS SURVIVE THIS RETURN ON PURPOSE — AN UNPLAYED WEEK IS WHEN
   * THEY MATTER MOST. There is still no head-to-head SCORE to show (a 0-0 row is
   * a scheduled week, not a result, and rendering it as one is the lie this guard
   * exists to prevent), but "what is this matchup projected to finish" and "what
   * are my chances" are precisely the questions asked BEFORE kickoff. Returning
   * base's placeholders here would have withheld the two numbers with the most
   * value, on the grounds that the game had not started.
   */
  const recordOf = (t?: { wins: number; losses: number; ties: number }) =>
    !t || (t.wins === 0 && t.losses === 0 && t.ties === 0)
      ? null
      : t.ties > 0
        ? `${t.wins}-${t.losses}-${t.ties}`
        : `${t.wins}-${t.losses}`

  /*
   * ⚠ BUILT BEFORE THE UNPLAYED-WEEK GUARD, NOT AFTER IT. Everything here —
   * both crests, both team names, both records — is on file as soon as the
   * fixture is, and none of it is a claim about the score. Building it below the
   * guard is what left this screen's head-to-head as a single grey sentence for
   * every hour between the schedule landing and the first Thursday kickoff.
   */
  const teamsSection: MatchupData['teams'] = {
    available: true,
    data: {
      you: {
        teamName: myTeam.teamName,
        ownerName: myTeam.ownerName,
        record: recordOf(myTeam),
        isYou: true,
        avatarUrl: asImageUrl(myTeam.avatarUrl, platform),
      },
      opponent: opponentRow
        ? {
            teamName: opponentTeamName(oppTeam, opponentRow.rosterId),
            ownerName: opponentOwnerName(oppTeam),
            record: recordOf(oppTeam),
            isYou: false,
            avatarUrl: asImageUrl(oppTeam?.avatarUrl, platform),
          }
        : {
            // A bye, or a row the pairing could not match. Named as such rather
            // than invented, and still crested with nothing.
            teamName: 'Opponent not identified',
            ownerName: '',
            record: null,
            isYou: false,
            avatarUrl: null,
          },
    },
  }

  /* Head to head with this opponent — started beside the team list above; see the note there. */
  const headToHead: MatchupData['headToHead'] = await headToHeadRead

  if (!anyPoints) {
    return {
      ...base,
      week,
      weekNav,
      weekGames,
      headToHead,
      teams: teamsSection,
      projectedFinal,
      winProbability,
      lineups,
      playerScoring,
      identityNote,
      sides: {
        available: false,
        reason: `week ${latest.week} is on file but nothing has been scored — this is an unplayed week, not a 0-0 game`,
      },
    }
  }

  const you: MatchupSide = {
    teamName: myTeam.teamName,
    ownerName: myTeam.ownerName,
    record: recordOf(myTeam),
    points: mine.pointsFor,
    isYou: true,
    avatarUrl: asImageUrl(myTeam.avatarUrl, platform),
  }

  if (!opponentRow) {
    // A bye, or an unpaired row. `pointsAgainst` still tells us what the other
    // side scored, so the score line is real even when the opponent is unnamed.
    return {
      ...base,
      week,
      weekNav,
      weekGames,
      teams: teamsSection,
      sides: {
        available: true,
        data: {
          you,
          opponent: {
            teamName: 'Opponent not identified',
            ownerName: '',
            record: null,
            points: mine.pointsAgainst,
            isYou: false,
            avatarUrl: null,
          },
        },
      },
    }
  }

  return {
    ...base,
    week,
    weekNav,
    weekGames,
    headToHead,
    teams: teamsSection,
    projectedFinal,
    winProbability,
    lineups,
    playerScoring,
    identityNote,
    sides: {
      available: true,
      data: {
        you,
        opponent: {
          teamName: opponentTeamName(oppTeam, opponentRow.rosterId),
          ownerName: opponentOwnerName(oppTeam),
          record: recordOf(oppTeam),
          points: opponentRow.pointsFor,
          isYou: false,
          avatarUrl: asImageUrl(oppTeam?.avatarUrl, platform),
        },
      },
    },
  }
}
