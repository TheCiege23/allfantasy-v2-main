import "server-only"
import type { LeagueSport } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  buildEspnScoreboardDateWindow,
  fetchEspnScoreboard,
  fetchRollingInsightsScheduleSeasonWithDiagnostics,
  fetchRollingInsightsScoreboard,
  type LiveScoreRow,
  type RollingInsightsScheduleShapeDiagnostics,
  type RollingInsightsScheduleGameRow,
} from "@/lib/sports-live-scores-service"
import { normalizeTeamAbbrev } from "@/lib/team-abbrev"
import type { PlayoffSport } from "./types"

export type PlayoffSeriesSyncGame = {
  gameId?: string | null
  homeTeam: string
  awayTeam: string
  homeTeamId?: string | null
  awayTeamId?: string | null
  homeTeamFull?: string | null
  awayTeamFull?: string | null
  homeScore?: number | null
  awayScore?: number | null
  completed?: boolean
  status?: string | null
  statusDetail?: string | null
  startTime?: string | null
  venue?: string | null
  broadcast?: string | null
  providerRound?: number | null
  eventName?: string | null
  seasonType?: string | null
}

type PlayoffSeriesAggregate = {
  games: PlayoffSeriesSyncGame[]
  homeWins: number
  awayWins: number
  status: "scheduled" | "in_progress" | "final"
  startsAt: Date | null
  winnerTeamName: string | null
  homeTeamName: string
  awayTeamName: string
  roundIndex: number
  seriesSummary: string
  nextGameAt: Date | null
  venue: string | null
  broadcastNetwork: string | null
  liveHomeScore: number | null
  liveAwayScore: number | null
  liveStatus: string | null
  providerGamesJson: unknown[]
  completedWithoutWinnerSource: boolean
}

/**
 * Which half of the draw a provider's event name places a series in.
 *
 * ⚠ ONE NAME FOR IT, because this was two copies of the same union — the
 * function's return type and the field it is assigned to — and widening only
 * the function is what the compiler caught. A named alias makes the next sport
 * a one-line change instead of a hunt.
 */
type ProviderConference = "east" | "west" | "al" | "nl" | null

type ProviderSeriesGroup = {
  key: string
  order: number
  roundIndex: number
  conference: ProviderConference
  eventName: string | null
  homeTeamName: string
  awayTeamName: string
  games: PlayoffSeriesSyncGame[]
}

export type PlayoffSeriesSyncProvider = (input: {
  sport: PlayoffSport
  seasonYear: number
  providerPreference?: PlayoffSeriesSyncProviderPreference
}) => Promise<{
  source: string
  games: PlayoffSeriesSyncGame[]
  warnings?: string[]
  attemptedProviders?: string[]
  diagnostics?: PlayoffSyncDiagnostics
}>

export type PlayoffSeriesScheduleSupplementProvider = (input: {
  sport: PlayoffSport
  seasonYear: number
}) => Promise<{
  source: "espn_live" | "rolling_insights_live" | "none"
  games: PlayoffSeriesSyncGame[]
  warnings?: string[]
}>

export type PlayoffSeriesFinalScoreSupplementProvider = (input: {
  sport: PlayoffSport
  seasonYear: number
  dates: string[]
}) => Promise<{
  source: "espn_final_scores" | "rolling_insights_final_scores" | "none"
  games: PlayoffSeriesSyncGame[]
  warnings?: string[]
}>

export type PlayoffSeriesSyncProviderPreference = "auto" | "rolling_insights" | "espn"

export type PlayoffSeriesSyncMode = "schedule_only" | "teams_schedule_only" | "results_only" | "official_bracket" | "autofill_results"

type ProviderAttemptDiagnostic = {
  provider: string
  source: string
  seasonYear: number
  sport: PlayoffSport
  gamesReturned: number
  postseasonGames: number
  warning?: string
}

type ProviderSeasonAttemptDiagnostic = {
  provider: string
  seasonYear: number
  rowsReturned: number
  postseasonRows: number
  warning?: string
  responseShape?: RollingInsightsScheduleShapeDiagnostics
}

type TeamPairDiagnostic = {
  round?: number | null
  homeTeam: string
  awayTeam: string
  eventName?: string | null
  status?: string | null
  startTime?: string | null
}

type EventNameRoundMapDiagnostic = {
  eventName: string | null
  round: number | null
  ignored?: boolean
}

type UpdatedSeriesDiagnostic = {
  round: number
  oldHomeTeam: string
  oldAwayTeam: string
  newHomeTeam: string
  newAwayTeam: string
  eventName?: string | null
  status?: string | null
}

type ResultPersistenceDiagnostic = {
  seriesNumber: number
  providerStatus: string | null
  persistedStatus: string
  providerWinner: string | null
  persistedWinner: string | null
  seriesSummary: string | null
  scoreSource?: string | null
}

type ProviderAssignmentDiagnostic = TeamPairDiagnostic & {
  assignedSeriesNumber?: number | null
  assignedSeriesId?: string | null
  assignmentReason?: string | null
  confidence?: "high" | "medium" | "low"
}

type SlotAssignmentWarning = {
  round: number
  conference: string
  message: string
  providerSeries?: string | null
  slot?: number | null
}

export type PlayoffSyncDiagnostics = {
  seasonYear: number
  challengeSeasonYear: number
  selectedProviderSeason: number | null
  providerSeasonAttempts: ProviderSeasonAttemptDiagnostic[]
  seasonSelectionExplanation?: string | null
  sport: PlayoffSport
  selectedProvider: string
  providerAttempts: ProviderAttemptDiagnostic[]
  existingSeriesExamples: TeamPairDiagnostic[]
  providerGameExamples: TeamPairDiagnostic[]
  providerSeriesExamples: TeamPairDiagnostic[]
  ignoredPlayInGames: number
  eventNameRoundMapExamples: EventNameRoundMapDiagnostic[]
  providerSeriesByRound: Record<string, number>
  providerAssignments: ProviderAssignmentDiagnostic[]
  officialSeriesByRound: Record<string, TeamPairDiagnostic[]>
  officialSeriesSlotAssignments: ProviderAssignmentDiagnostic[]
  providerRound2WestSeries: TeamPairDiagnostic[]
  providerRound2EastSeries: TeamPairDiagnostic[]
  slotAssignmentWarnings: SlotAssignmentWarning[]
  unmappedProviderSeries: TeamPairDiagnostic[]
  conflictingSlotAssignments: SlotAssignmentWarning[]
  expectedVsActualSlotExamples: ProviderAssignmentDiagnostic[]
  completedProviderSeries: number
  completedSeriesWithWinner: number
  completedSeriesWithoutWinner: number
  resultsOnlyStrippedWinners: boolean
  resultPersistenceExamples: ResultPersistenceDiagnostic[]
  finalScoreSupplementProvider: "espn_final_scores" | "rolling_insights_final_scores" | "none"
  finalScoreDatesFetched: number
  finalScoreRowsSeen: number
  finalScoreRowsMatched: number
  seriesWinsComputed: number
  seriesWinnersComputed: number
  templateReplacementCount: number
  updatedSeriesExamples: UpdatedSeriesDiagnostic[]
  scheduleSupplementProvider: "espn_live" | "rolling_insights_live" | "none"
  scheduleGamesSeen: number
  scheduleGamesMatched: number
  liveGamesMatched: number
  broadcastFieldsFound: number
  venueFieldsFound: number
  unmatchedScheduleExamples: TeamPairDiagnostic[]
  scheduleDateKnownButTimeMissing: number
  nextGameDateOnlyExamples: TeamPairDiagnostic[]
  noMatchReason?: string | null
}

export type SyncPlayoffChallengeSeriesResult = {
  ok: boolean
  challengeId: string
  sport: PlayoffSport
  mode: PlayoffSeriesSyncMode
  source: string
  challengeSeasonYear: number
  selectedProviderSeason: number | null
  providerSeasonAttempts: ProviderSeasonAttemptDiagnostic[]
  attemptedProviders: string[]
  postseasonGames: number
  gamesSeen: number
  gamesMatched: number
  seriesReturned: number
  seriesMatched: number
  seriesUpdated: number
  winnersUpdated: number
  picksAutoFilled: number
  warnings: string[]
  unmatchedExamples: Array<{ homeTeam: string; awayTeam: string; eventName?: string | null; round?: number | null }>
  diagnostics: PlayoffSyncDiagnostics
}

export type RefreshPlayoffScheduleMetadataResult = {
  ok: boolean
  challengeId: string
  sport: PlayoffSport
  provider: "espn"
  dryRun: boolean
  updatedSeries: number
  scheduleGamesSeen: number
  scheduleGamesMatched: number
  liveGamesMatched: number
  broadcastFieldsFound: number
  venueFieldsFound: number
  warnings: string[]
  diagnostics: Pick<
    PlayoffSyncDiagnostics,
    | "scheduleSupplementProvider"
    | "scheduleGamesSeen"
    | "scheduleGamesMatched"
    | "liveGamesMatched"
    | "broadcastFieldsFound"
    | "venueFieldsFound"
    | "unmatchedScheduleExamples"
    | "scheduleDateKnownButTimeMissing"
    | "nextGameDateOnlyExamples"
  >
}

const SPORT_TO_LEAGUE_SPORT: Record<PlayoffSport, LeagueSport> = {
  nba: "NBA",
  nhl: "NHL",
  mlb: "MLB",
}

/**
 * Sports this service will actually sync. ONE list, because there were two
 * copies of the same `sport !== "nba" && sport !== "nhl"` test and a third
 * spelling of the rule in the cron's zod enum.
 *
 * 🛑 MLB IS MODELLED EVERYWHERE ELSE AND DELIBERATELY REFUSED HERE. The
 * template, round keys, labels and conference vocabulary all understand
 * baseball; what is missing is the two things that make a synced bracket
 * true rather than decorative:
 *
 *   1. a SEEDING SOURCE — nothing ingests MLB standings
 *      (`/api/cron/import-standings` is NFL/NCAAF only), so there is no way
 *      to fill `AL1`…`NL6` with real clubs; and
 *   2. a SCHEDULED WRITER — `syncPlayoffChallengeSeries` has no cron caller
 *      at all, for any sport.
 *
 * Adding "mlb" here without both would point a bracket at results nothing
 * refreshes, which fails silently and looks correct. Add it in the SAME
 * change that lands them, and verify the round-name patterns above against a
 * captured ESPN postseason payload at the same time.
 */
const SYNCABLE_PLAYOFF_SPORTS = new Set<PlayoffSport>(["nba", "nhl"])

function assertSyncableSport(raw: unknown, operation: string): PlayoffSport {
  const sport = String(raw ?? "").toLowerCase() as PlayoffSport
  if (!SYNCABLE_PLAYOFF_SPORTS.has(sport)) {
    throw new Error(
      `Playoff ${operation} is not supported for "${sport || "unknown"}". Supported: ${[...SYNCABLE_PLAYOFF_SPORTS].join(", ")}.`,
    )
  }
  return sport
}

function normalizeName(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim()
  return normalizeTeamAbbrev(trimmed) || trimmed
}

function displayName(value: string | null | undefined): string {
  return String(value ?? "").trim()
}

function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase()
}

function sameProviderTeamId(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  const left = String(a ?? "").trim()
  const right = String(b ?? "").trim()
  return !!left && !!right && left === right
}

function isPlaceholderTeamName(value: string | null | undefined): boolean {
  const name = String(value ?? "").trim()
  return /^([A-Z]+[0-9]+|Winner\s+S\d+|Winner\s+\w+)$/i.test(name)
}

function isTemplateSeries(series: any): boolean {
  return isPlaceholderTeamName(series.homeTeamName) || isPlaceholderTeamName(series.awayTeamName)
}

function rowToSyncGame(row: LiveScoreRow): PlayoffSeriesSyncGame {
  return {
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    gameId: row.gameId,
    homeTeamId: row.homeTeamId ?? null,
    awayTeamId: row.awayTeamId ?? null,
    homeTeamFull: row.homeTeamFull,
    awayTeamFull: row.awayTeamFull,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    completed: row.completed,
    status: row.status,
    statusDetail: row.statusDetail,
    startTime: row.startTime,
    venue: row.venue,
    broadcast: row.broadcast,
  }
}

function espnDateFromStartTime(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`
  const dashed = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (dashed) return `${dashed[1]}${dashed[2]}${dashed[3]}`
  const time = new Date(text).getTime()
  if (!Number.isFinite(time)) return null
  const date = new Date(time)
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`
}

function collectProviderGameDates(groups: ProviderSeriesGroup[], maxDates = 90): string[] {
  return Array.from(new Set(
    groups.flatMap((group) => group.games.map((game) => espnDateFromStartTime(game.startTime)).filter(Boolean) as string[])
  ))
    .sort()
    .slice(0, maxDates)
}

function scheduleRowToSyncGame(row: RollingInsightsScheduleGameRow): PlayoffSeriesSyncGame {
  return {
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    gameId: row.gameId,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    homeTeamFull: row.homeTeam,
    awayTeamFull: row.awayTeam,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    completed: row.completed,
    status: row.status,
    statusDetail: row.statusDetail ?? row.status,
    startTime: row.startsAt,
    venue: row.venue,
    broadcast: row.broadcast,
    providerRound: row.round,
    eventName: row.eventName,
    seasonType: row.seasonType,
  }
}

function isPostseasonRow(row: RollingInsightsScheduleGameRow): boolean {
  return row.seasonType.toLowerCase() === "postseason"
}

function candidateProviderSeasons(seasonYear: number): number[] {
  const currentYear = new Date().getUTCFullYear()
  return Array.from(new Set([seasonYear, seasonYear - 1, currentYear, currentYear - 1].filter(Number.isFinite)))
}

function seasonSelectionExplanation(challengeSeasonYear: number, selectedProviderSeason: number | null): string | null {
  if (!selectedProviderSeason || selectedProviderSeason === challengeSeasonYear) return null
  return `Rolling Insights uses season start year; ${selectedProviderSeason} was selected for the ${selectedProviderSeason}-${String(challengeSeasonYear).slice(-2)} season.`
}

export async function fetchRollingInsightsPostseasonScheduleGames(input: {
  sport: PlayoffSport
  seasonYear: number
}): Promise<{ source: string; games: PlayoffSeriesSyncGame[]; warnings: string[]; attemptedProviders: string[]; diagnostics: PlayoffSyncDiagnostics }> {
  const leagueSport = SPORT_TO_LEAGUE_SPORT[input.sport]
  const providerSeasonAttempts: ProviderSeasonAttemptDiagnostic[] = []
  let selectedRows: RollingInsightsScheduleGameRow[] = []
  let selectedProviderSeason: number | null = null
  for (const providerSeason of candidateProviderSeasons(input.seasonYear)) {
    const result = await fetchRollingInsightsScheduleSeasonWithDiagnostics(leagueSport, providerSeason)
    const rows = result.rows
    const postseasonRows = rows.filter(isPostseasonRow)
    providerSeasonAttempts.push({
      provider: "rolling_insights_schedule_season",
      seasonYear: providerSeason,
      rowsReturned: rows.length,
      postseasonRows: postseasonRows.length,
      warning: postseasonRows.length === 0
        ? `No ${input.sport.toUpperCase()} postseason games returned from Rolling Insights schedule-season for season ${providerSeason}.`
        : undefined,
      responseShape: rows.length <= 1 || postseasonRows.length === 0 ? result.diagnostics : undefined,
    })
    if (postseasonRows.length > 0) {
      selectedRows = postseasonRows
      selectedProviderSeason = providerSeason
      break
    }
  }
  const games = selectedRows.map(scheduleRowToSyncGame)
  const warnings = games.length === 0
    ? [`No ${input.sport.toUpperCase()} postseason games returned from Rolling Insights schedule-season for candidate seasons ${providerSeasonAttempts.map((attempt) => attempt.seasonYear).join(", ")}.`]
    : []
  const explanation = seasonSelectionExplanation(input.seasonYear, selectedProviderSeason)
  return {
    source: "rolling_insights_schedule_season",
    games,
    warnings,
    attemptedProviders: ["rolling_insights_schedule_season"],
    diagnostics: {
      seasonYear: input.seasonYear,
      challengeSeasonYear: input.seasonYear,
      selectedProviderSeason,
      providerSeasonAttempts,
      seasonSelectionExplanation: explanation,
      sport: input.sport,
      selectedProvider: "rolling_insights_schedule_season",
      providerAttempts: [{
        provider: "rolling_insights_schedule_season",
        source: "rolling_insights_schedule_season",
        seasonYear: selectedProviderSeason ?? input.seasonYear,
        sport: input.sport,
        gamesReturned: selectedRows.length,
        postseasonGames: games.length,
        warning: warnings[0],
      }],
      existingSeriesExamples: [],
      providerGameExamples: sampleGameDiagnostics(games),
      providerSeriesExamples: sampleSeriesDiagnostics(buildProviderSeriesGroups(games, input.sport)),
      ignoredPlayInGames: games.filter(isPlayInGame).length,
      eventNameRoundMapExamples: sampleEventNameRoundDiagnostics(games, input.sport),
      providerSeriesByRound: providerSeriesByRound(buildProviderSeriesGroups(games, input.sport)),
      providerAssignments: [],
      officialSeriesByRound: {},
      officialSeriesSlotAssignments: [],
      providerRound2WestSeries: [],
      providerRound2EastSeries: [],
      slotAssignmentWarnings: [],
      unmappedProviderSeries: [],
      conflictingSlotAssignments: [],
      expectedVsActualSlotExamples: [],
      completedProviderSeries: 0,
      completedSeriesWithWinner: 0,
      completedSeriesWithoutWinner: 0,
      resultsOnlyStrippedWinners: false,
      resultPersistenceExamples: [],
      finalScoreSupplementProvider: "none",
      finalScoreDatesFetched: 0,
      finalScoreRowsSeen: 0,
      finalScoreRowsMatched: 0,
      seriesWinsComputed: 0,
      seriesWinnersComputed: 0,
      templateReplacementCount: 0,
      updatedSeriesExamples: [],
      scheduleSupplementProvider: "none",
      scheduleGamesSeen: 0,
      scheduleGamesMatched: 0,
      liveGamesMatched: 0,
      broadcastFieldsFound: 0,
      venueFieldsFound: 0,
      unmatchedScheduleExamples: [],
      scheduleDateKnownButTimeMissing: 0,
      nextGameDateOnlyExamples: [],
      noMatchReason: null,
    },
  }
}

export async function fetchLivePlayoffSeriesGames(input: {
  sport: PlayoffSport
  seasonYear: number
  providerPreference?: PlayoffSeriesSyncProviderPreference
}): Promise<{ source: string; games: PlayoffSeriesSyncGame[]; warnings: string[]; attemptedProviders: string[]; diagnostics: PlayoffSyncDiagnostics }> {
  const leagueSport = SPORT_TO_LEAGUE_SPORT[input.sport]
  const providerPreference = input.providerPreference ?? "auto"
  const attemptedProviders: string[] = []
  const providerAttempts: ProviderAttemptDiagnostic[] = []
  let providerSeasonAttempts: ProviderSeasonAttemptDiagnostic[] = []
  const providerOrder = providerPreference === "espn"
    ? ["espn_live"]
    : providerPreference === "rolling_insights"
      ? ["rolling_insights_schedule_season", "rolling_insights"]
      : ["rolling_insights_schedule_season", "rolling_insights"]
  const providerLabels: Record<string, string> = {
    rolling_insights_schedule_season: "Rolling Insights schedule-season",
    rolling_insights: "Rolling Insights",
    espn_live: "ESPN",
  }

  for (const providerName of providerOrder) {
    attemptedProviders.push(providerName)
    const schedulePayload = providerName === "rolling_insights_schedule_season"
      ? await fetchRollingInsightsPostseasonScheduleGames(input)
      : null
    if (schedulePayload) {
      providerSeasonAttempts = schedulePayload.diagnostics.providerSeasonAttempts
    }
    const games = schedulePayload
      ? schedulePayload.games
      : (providerName === "espn_live"
          ? await fetchEspnScoreboard(leagueSport)
          : await fetchRollingInsightsScoreboard(leagueSport, { forceRefresh: true }))
        .filter((row) => row.season === input.seasonYear || !Number.isFinite(row.season))
        .map(rowToSyncGame)
    providerAttempts.push({
      provider: providerName,
      source: providerName,
      seasonYear: schedulePayload?.diagnostics.selectedProviderSeason ?? input.seasonYear,
      sport: input.sport,
      gamesReturned: games.length,
      postseasonGames: games.filter((game) => String(game.seasonType ?? "").toLowerCase() === "postseason").length,
      warning: games.length === 0 ? `${providerName} returned no usable ${input.sport.toUpperCase()} games for season ${input.seasonYear}.` : undefined,
    })
    if (games.length > 0) {
      return {
        source: providerName,
        games,
        warnings: [],
        attemptedProviders,
        diagnostics: {
          seasonYear: input.seasonYear,
          challengeSeasonYear: input.seasonYear,
          selectedProviderSeason: schedulePayload?.diagnostics.selectedProviderSeason ?? input.seasonYear,
          providerSeasonAttempts: schedulePayload?.diagnostics.providerSeasonAttempts ?? [],
          seasonSelectionExplanation: schedulePayload?.diagnostics.seasonSelectionExplanation ?? null,
          sport: input.sport,
          selectedProvider: providerName,
          providerAttempts: schedulePayload?.diagnostics.providerAttempts ?? providerAttempts,
          existingSeriesExamples: [],
          providerGameExamples: sampleGameDiagnostics(games),
          providerSeriesExamples: sampleSeriesDiagnostics(buildProviderSeriesGroups(games, input.sport)),
          ignoredPlayInGames: games.filter(isPlayInGame).length,
          eventNameRoundMapExamples: sampleEventNameRoundDiagnostics(games, input.sport),
          providerSeriesByRound: providerSeriesByRound(buildProviderSeriesGroups(games, input.sport)),
          providerAssignments: [],
          officialSeriesByRound: {},
          officialSeriesSlotAssignments: [],
          providerRound2WestSeries: [],
          providerRound2EastSeries: [],
          slotAssignmentWarnings: [],
          unmappedProviderSeries: [],
          conflictingSlotAssignments: [],
          expectedVsActualSlotExamples: [],
          completedProviderSeries: 0,
          completedSeriesWithWinner: 0,
          completedSeriesWithoutWinner: 0,
          resultsOnlyStrippedWinners: false,
          resultPersistenceExamples: [],
          finalScoreSupplementProvider: "none",
          finalScoreDatesFetched: 0,
          finalScoreRowsSeen: 0,
          finalScoreRowsMatched: 0,
          seriesWinsComputed: 0,
          seriesWinnersComputed: 0,
          templateReplacementCount: 0,
          updatedSeriesExamples: [],
          scheduleSupplementProvider: "none",
          scheduleGamesSeen: 0,
          scheduleGamesMatched: 0,
          liveGamesMatched: 0,
          broadcastFieldsFound: 0,
          venueFieldsFound: 0,
          unmatchedScheduleExamples: [],
          scheduleDateKnownButTimeMissing: 0,
          nextGameDateOnlyExamples: [],
          noMatchReason: null,
        },
      }
    }
  }

  const attemptedLabels = attemptedProviders.map((providerName) => providerLabels[providerName] ?? providerName)
  return {
    source: attemptedProviders[attemptedProviders.length - 1] ?? "none",
    games: [],
    warnings: [
      `No ${input.sport.toUpperCase()} games returned from ${attemptedLabels.join(" or ")} for season ${input.seasonYear}.`,
    ],
    attemptedProviders,
    diagnostics: {
      seasonYear: input.seasonYear,
      challengeSeasonYear: input.seasonYear,
      selectedProviderSeason: null,
      providerSeasonAttempts: providerAttempts
        .filter((attempt) => attempt.provider === "rolling_insights_schedule_season")
        .length > 0
          ? providerSeasonAttempts
          : [],
      seasonSelectionExplanation: null,
      sport: input.sport,
      selectedProvider: attemptedProviders[attemptedProviders.length - 1] ?? "none",
      providerAttempts,
      existingSeriesExamples: [],
      providerGameExamples: [],
      providerSeriesExamples: [],
      ignoredPlayInGames: 0,
      eventNameRoundMapExamples: [],
      providerSeriesByRound: {},
      providerAssignments: [],
      officialSeriesByRound: {},
      officialSeriesSlotAssignments: [],
      providerRound2WestSeries: [],
      providerRound2EastSeries: [],
      slotAssignmentWarnings: [],
      unmappedProviderSeries: [],
      conflictingSlotAssignments: [],
      expectedVsActualSlotExamples: [],
      completedProviderSeries: 0,
      completedSeriesWithWinner: 0,
      completedSeriesWithoutWinner: 0,
      resultsOnlyStrippedWinners: false,
      resultPersistenceExamples: [],
      finalScoreSupplementProvider: "none",
      finalScoreDatesFetched: 0,
      finalScoreRowsSeen: 0,
      finalScoreRowsMatched: 0,
      seriesWinsComputed: 0,
      seriesWinnersComputed: 0,
      templateReplacementCount: 0,
      updatedSeriesExamples: [],
      scheduleSupplementProvider: "none",
      scheduleGamesSeen: 0,
      scheduleGamesMatched: 0,
      liveGamesMatched: 0,
      broadcastFieldsFound: 0,
      venueFieldsFound: 0,
      unmatchedScheduleExamples: [],
      scheduleDateKnownButTimeMissing: 0,
      nextGameDateOnlyExamples: [],
      noMatchReason: null,
    },
  }
}

function statusFromGame(game: PlayoffSeriesSyncGame): "scheduled" | "in_progress" | "final" {
  const status = `${game.status ?? ""} ${game.statusDetail ?? ""}`.toLowerCase()
  if (game.completed || status.includes("final")) return "final"
  if (status.includes("progress") || status.includes("period") || status.includes("intermission") || status.includes("end of")) {
    return "in_progress"
  }
  return "scheduled"
}

function isFinalGame(game: PlayoffSeriesSyncGame): boolean {
  return statusFromGame(game) === "final"
}

function winnerFromGame(game: PlayoffSeriesSyncGame): string | null {
  if (!isFinalGame(game)) return null
  if (game.homeScore == null || game.awayScore == null) return null
  const homeScore = Number(game.homeScore)
  const awayScore = Number(game.awayScore)
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null
  if (homeScore === awayScore) return null
  return homeScore > awayScore
    ? displayName(game.homeTeamFull || game.homeTeam)
    : displayName(game.awayTeamFull || game.awayTeam)
}

function gameMatchesSeries(series: any, game: PlayoffSeriesSyncGame): boolean {
    const homeId = series.homeTeamId ?? series.homeProviderId ?? series.home_team_ID ?? null
    const awayId = series.awayTeamId ?? series.awayProviderId ?? series.away_team_ID ?? null
    const homeMatchesHomeById = sameProviderTeamId(homeId, game.homeTeamId)
    const awayMatchesAwayById = sameProviderTeamId(awayId, game.awayTeamId)
    const homeMatchesAwayById = sameProviderTeamId(homeId, game.awayTeamId)
    const awayMatchesHomeById = sameProviderTeamId(awayId, game.homeTeamId)
    if ((homeMatchesHomeById && awayMatchesAwayById) || (homeMatchesAwayById && awayMatchesHomeById)) {
      return true
    }
    const homeMatchesHome = sameTeam(series.homeTeamName, game.homeTeam) || sameTeam(series.homeTeamName, game.homeTeamFull)
    const awayMatchesAway = sameTeam(series.awayTeamName, game.awayTeam) || sameTeam(series.awayTeamName, game.awayTeamFull)
    const homeMatchesAway = sameTeam(series.homeTeamName, game.awayTeam) || sameTeam(series.homeTeamName, game.awayTeamFull)
    const awayMatchesHome = sameTeam(series.awayTeamName, game.homeTeam) || sameTeam(series.awayTeamName, game.homeTeamFull)
    return (homeMatchesHome && awayMatchesAway) || (homeMatchesAway && awayMatchesHome)
}

function gamesForSeries(series: any, games: PlayoffSeriesSyncGame[]): PlayoffSeriesSyncGame[] {
  return games.filter((game) => {
    if (Number.isFinite(Number(game.providerRound)) && Number(game.providerRound) !== Number(series.roundIndex)) {
      return false
    }
    return gameMatchesSeries(series, game)
  })
}

function normalizedEventName(game: PlayoffSeriesSyncGame): string {
  return String(game.eventName ?? "").toLowerCase().replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim()
}

function isPlayInGame(game: PlayoffSeriesSyncGame): boolean {
  return /\bplay\s*in\b/.test(normalizedEventName(game))
}

/**
 * ⚠ THE MLB BRANCH IS UNVERIFIED AGAINST A REAL POSTSEASON PAYLOAD. No MLB
 * postseason event name has been captured from ESPN yet — every MLB row in
 * `SportsGame` today is regular season, and `seasonType` is NULL on all of
 * them. These patterns are written from the published series names, and the
 * MLB sync is still refused upstream (see `assertSyncableSport`), so nothing
 * depends on them being right. Confirm them against a captured payload in the
 * same change that lifts that refusal — do not assume they work because they
 * compile.
 */
function conferenceFromEventName(
  game: PlayoffSeriesSyncGame,
  sport?: PlayoffSport,
): ProviderConference {
  const eventName = normalizedEventName(game)
  /*
   * ⚠ SPORT-SCOPED ON PURPOSE, AND THIS FUNCTION USED NOT TO BE. `\bal\b` is a
   * two-letter token that can appear in an event name for any sport, so running
   * the baseball branch unconditionally would let a basketball or hockey game
   * that happens to contain it get bucketed into the American League — turning a
   * previously honest `null` into a confident wrong answer. The east/west
   * branches are left unscoped because they are the pre-existing behaviour and
   * carry no such collision.
   */
  if (/\beast\b|\beastern\b/.test(eventName)) return "east"
  if (/\bwest\b|\bwestern\b/.test(eventName)) return "west"
  if (sport === "mlb") {
    if (/\bamerican league\b|\bal\b/.test(eventName)) return "al"
    if (/\bnational league\b|\bnl\b/.test(eventName)) return "nl"
  }
  return null
}

function roundIndexFromGame(game: PlayoffSeriesSyncGame, sport?: PlayoffSport): number | null {
  const eventName = normalizedEventName(game)
  if (isPlayInGame(game)) return null
  if (sport === "nba") {
    if (/\bnba finals?\b/.test(eventName)) return 4
    if (/\bconference finals?\b|\beast finals?\b|\bwest finals?\b|\beastern conference finals?\b|\bwestern conference finals?\b/.test(eventName)) return 3
    if (/\bsemifinals?\b|\bsemi finals?\b|\bconference semifinals?\b|\beast semifinals?\b|\bwest semifinals?\b/.test(eventName)) return 2
    if (/\b1st round\b|\bfirst round\b/.test(eventName)) return 1
  } else if (sport === "nhl") {
    if (/\bstanley cup final\b|\bstanley cup finals\b/.test(eventName)) return 4
    if (/\bconference finals?\b|\beast finals?\b|\bwest finals?\b|\beastern conference finals?\b|\bwestern conference finals?\b/.test(eventName)) return 3
    if (/\b2nd round\b|\bsecond round\b|\bround 2\b/.test(eventName)) return 2
    if (/\b1st round\b|\bfirst round\b|\bround 1\b/.test(eventName)) return 1
  } else if (sport === "mlb") {
    /*
     * ⚠ UNVERIFIED — see the note on `conferenceFromEventName`. Ordered most
     * specific first: "World Series" must be tested before the generic
     * "final" fallthrough below, and "Championship Series" before "Division
     * Series", because "AL Championship Series" contains neither the word
     * "conference" nor "final" and would otherwise reach no branch at all.
     */
    if (/\bworld series\b/.test(eventName)) return 4
    if (/\bchampionship series\b|\balcs\b|\bnlcs\b/.test(eventName)) return 3
    if (/\bdivision series\b|\balds\b|\bnlds\b/.test(eventName)) return 2
    if (/\bwild card\b|\bwildcard\b/.test(eventName)) return 1
    /*
     * Baseball has no "conference"/"semifinal" vocabulary, so the generic
     * fallthrough below would mis-bucket an unrecognised MLB event rather
     * than decline it. Declining is the safer answer: an unmatched group is
     * skipped, a mis-bucketed one advances the wrong series.
     */
    return null
  }
  if (eventName.includes("final") && !eventName.includes("conference")) return 4
  if (eventName.includes("conference")) return 3
  if (eventName.includes("second") || eventName.includes("semifinal") || eventName.includes("semifinals")) return 2
  if (eventName.includes("first") || eventName.includes("1st round")) return 1
  const explicit = Number(game.providerRound)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return null
}

function pairKey(homeTeam: string | null | undefined, awayTeam: string | null | undefined): string {
  return [normalizeName(homeTeam).toLowerCase(), normalizeName(awayTeam).toLowerCase()].sort().join("__")
}

function buildProviderSeriesGroups(games: PlayoffSeriesSyncGame[], sport?: PlayoffSport): ProviderSeriesGroup[] {
  const byKey = new Map<string, ProviderSeriesGroup>()
  for (const [index, game] of games.entries()) {
    const roundIndex = roundIndexFromGame(game, sport)
    if (!roundIndex) continue
    const homeTeamName = displayName(game.homeTeamFull || game.homeTeam)
    const awayTeamName = displayName(game.awayTeamFull || game.awayTeam)
    if (!homeTeamName || !awayTeamName) continue
    const key = `${roundIndex}:${pairKey(homeTeamName, awayTeamName)}`
    const existing = byKey.get(key)
    if (existing) {
      existing.games.push(game)
      continue
    }
    byKey.set(key, {
      key,
      order: index,
      roundIndex,
      conference: conferenceFromEventName(game, sport),
      eventName: game.eventName ?? null,
      homeTeamName,
      awayTeamName,
      games: [game],
    })
  }
  return Array.from(byKey.values()).sort((a, b) => a.roundIndex - b.roundIndex || a.order - b.order)
}

function sampleGameDiagnostics(games: PlayoffSeriesSyncGame[]): TeamPairDiagnostic[] {
  return games.slice(0, 3).map((game) => ({
    round: game.providerRound ?? null,
    homeTeam: displayName(game.homeTeamFull || game.homeTeam),
    awayTeam: displayName(game.awayTeamFull || game.awayTeam),
    eventName: game.eventName ?? null,
    status: game.status ?? game.statusDetail ?? null,
    startTime: game.startTime ?? null,
  }))
}

function sampleSeriesDiagnostics(groups: ProviderSeriesGroup[]): TeamPairDiagnostic[] {
  return groups.slice(0, 3).map((group) => ({
    round: group.roundIndex,
    homeTeam: group.homeTeamName,
    awayTeam: group.awayTeamName,
    eventName: group.eventName ?? group.games[0]?.eventName ?? null,
    status: group.games[0]?.status ?? group.games[0]?.statusDetail ?? null,
  }))
}

function sampleEventNameRoundDiagnostics(games: PlayoffSeriesSyncGame[], sport: PlayoffSport): EventNameRoundMapDiagnostic[] {
  const byName = new Map<string, EventNameRoundMapDiagnostic>()
  for (const game of games) {
    const eventName = game.eventName ?? null
    const key = String(eventName ?? "")
    if (byName.has(key)) continue
    byName.set(key, {
      eventName,
      round: roundIndexFromGame(game, sport),
      ignored: isPlayInGame(game) || undefined,
    })
    if (byName.size >= 12) break
  }
  return Array.from(byName.values())
}

function providerSeriesByRound(groups: ProviderSeriesGroup[]): Record<string, number> {
  return groups.reduce<Record<string, number>>((acc, group) => {
    const key = String(group.roundIndex)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function sortSeriesForReplacement(series: any[]): any[] {
  return [...series].sort((a, b) => {
    const conferenceA = String(a.conference ?? "")
    const conferenceB = String(b.conference ?? "")
    if (conferenceA !== conferenceB) return conferenceA.localeCompare(conferenceB)
    return Number(a.seriesNumber ?? 0) - Number(b.seriesNumber ?? 0)
  })
}

function sortProviderGroupsForReplacement(groups: ProviderSeriesGroup[]): ProviderSeriesGroup[] {
  return [...groups].sort((a, b) => {
    const conferenceA = a.conference ?? ""
    const conferenceB = b.conference ?? ""
    if (conferenceA !== conferenceB) return conferenceA.localeCompare(conferenceB)
    return a.order - b.order
  })
}

function groupMatchesSourceWinners(
  series: any,
  group: ProviderSeriesGroup,
  bySeriesNumber: Map<number, any>
): boolean {
  const sourceNumbers = [series.sourceSeriesHome, series.sourceSeriesAway]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (sourceNumbers.length === 0) return false

  const sourceWinnerNames = sourceNumbers
    .map((seriesNumber) => bySeriesNumber.get(seriesNumber)?.winnerTeamName)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  if (sourceWinnerNames.length !== sourceNumbers.length) return false

  const providerTeams = [group.homeTeamName, group.awayTeamName]
  return sourceWinnerNames.every((winnerName) => providerTeams.some((teamName) => sameTeam(winnerName, teamName)))
}

function assignmentDiagnostic(
  group: ProviderSeriesGroup,
  series: any,
  assignmentReason: string,
  confidence: "high" | "medium" | "low" = "medium",
): ProviderAssignmentDiagnostic {
  return {
    round: group.roundIndex,
    homeTeam: group.homeTeamName,
    awayTeam: group.awayTeamName,
    eventName: group.eventName ?? group.games[0]?.eventName ?? null,
    status: group.games[0]?.status ?? group.games[0]?.statusDetail ?? null,
    startTime: group.games[0]?.startTime ?? null,
    assignedSeriesNumber: Number(series.seriesNumber ?? null),
    assignedSeriesId: String(series.id ?? ""),
    assignmentReason,
    confidence,
  }
}

function groupDiagnostic(group: ProviderSeriesGroup): TeamPairDiagnostic {
  return {
    round: group.roundIndex,
    homeTeam: group.homeTeamName,
    awayTeam: group.awayTeamName,
    eventName: group.eventName ?? group.games[0]?.eventName ?? null,
    status: group.games[0]?.status ?? group.games[0]?.statusDetail ?? null,
    startTime: group.games[0]?.startTime ?? null,
  }
}

function officialSeriesByRound(groups: ProviderSeriesGroup[]): Record<string, TeamPairDiagnostic[]> {
  return groups.reduce<Record<string, TeamPairDiagnostic[]>>((acc, group) => {
    const key = `round_${group.roundIndex}_${group.conference ?? "unknown"}`
    acc[key] = [...(acc[key] ?? []), groupDiagnostic(group)]
    return acc
  }, {})
}

function seriesContainsTeam(series: any, teamName: string): boolean {
  return sameTeam(series.homeTeamName, teamName) ||
    sameTeam(series.awayTeamName, teamName) ||
    sameTeam(series.winnerTeamName, teamName)
}

function effectiveSeriesForSourceLookup(seriesList: any[], replacementMap: Map<string, ProviderSeriesGroup>): any[] {
  return seriesList.map((series) => {
    const replacement = replacementMap.get(series.id)
    if (!replacement) return series
    return {
      ...series,
      homeTeamName: replacement.homeTeamName,
      awayTeamName: replacement.awayTeamName,
    }
  })
}

function sourceSeriesForProviderTeam(seriesList: any[], teamName: string, conference: string): any | null {
  const candidates = seriesList
    .filter((series) => Number(series.roundIndex) === 1)
    .filter((series) => String(series.conference ?? "").toLowerCase() === conference)
    .filter((series) => seriesContainsTeam(series, teamName))
    .sort((a, b) => Number(a.seriesNumber ?? 0) - Number(b.seriesNumber ?? 0))
  return candidates[0] ?? null
}

function groupMatchesSourceSlots(
  series: any,
  group: ProviderSeriesGroup,
  sourceSeriesByNumber: Map<number, any>
): boolean {
  const sourceHome = sourceSeriesByNumber.get(Number(series.sourceSeriesHome))
  const sourceAway = sourceSeriesByNumber.get(Number(series.sourceSeriesAway))
  if (!sourceHome || !sourceAway) return false
  const groupTeams = [group.homeTeamName, group.awayTeamName]
  const homeMatches = groupTeams.some((teamName) => seriesContainsTeam(sourceHome, teamName))
  const awayMatches = groupTeams.some((teamName) => seriesContainsTeam(sourceAway, teamName))
  const bothTeamsCovered = groupTeams.every((teamName) =>
    seriesContainsTeam(sourceHome, teamName) || seriesContainsTeam(sourceAway, teamName)
  )
  return homeMatches && awayMatches && bothTeamsCovered
}

function mapTemplateReplacementGroups(seriesList: any[], groups: ProviderSeriesGroup[]): {
  map: Map<string, ProviderSeriesGroup>
  assignments: ProviderAssignmentDiagnostic[]
  warnings: SlotAssignmentWarning[]
  conflicts: SlotAssignmentWarning[]
  unmapped: TeamPairDiagnostic[]
  expectedVsActual: ProviderAssignmentDiagnostic[]
  sourceUpdates: Map<string, { sourceSeriesHome: number; sourceSeriesAway: number }>
} {
  const map = new Map<string, ProviderSeriesGroup>()
  const assignments: ProviderAssignmentDiagnostic[] = []
  const warnings: SlotAssignmentWarning[] = []
  const conflicts: SlotAssignmentWarning[] = []
  const unmapped: TeamPairDiagnostic[] = []
  const expectedVsActual: ProviderAssignmentDiagnostic[] = []
  const sourceUpdates = new Map<string, { sourceSeriesHome: number; sourceSeriesAway: number }>()
  const bySeriesNumber = new Map(seriesList.map((series) => [Number(series.seriesNumber), series]))
  for (const roundIndex of [1, 2, 3, 4]) {
    const roundSeries = sortSeriesForReplacement(
      seriesList.filter((series) => Number(series.roundIndex) === roundIndex)
    )
    if (roundSeries.length === 0) continue
    const roundGroups = groups.filter((group) => group.roundIndex === roundIndex)
    if (roundGroups.length === 0) continue
    assignReplacementGroupsByConference(map, assignments, warnings, conflicts, unmapped, expectedVsActual, sourceUpdates, roundSeries, roundGroups, bySeriesNumber, seriesList)
    if (roundIndex === 4 && !Array.from(map.keys()).some((id) => roundSeries.some((series) => series.id === id)) && roundGroups.length >= roundSeries.length) {
      sortSeriesForReplacement(roundSeries).forEach((series, index) => {
        const group = sortProviderGroupsForReplacement(roundGroups)[index]
        if (group) {
          map.set(series.id, group)
          assignments.push(assignmentDiagnostic(group, series, "finals_order", "medium"))
        }
      })
    }
  }
  return { map, assignments, warnings, conflicts, unmapped, expectedVsActual, sourceUpdates }
}

function assignReplacementGroupsByConference(
  map: Map<string, ProviderSeriesGroup>,
  assignments: ProviderAssignmentDiagnostic[],
  warnings: SlotAssignmentWarning[],
  conflicts: SlotAssignmentWarning[],
  unmapped: TeamPairDiagnostic[],
  expectedVsActual: ProviderAssignmentDiagnostic[],
  sourceUpdates: Map<string, { sourceSeriesHome: number; sourceSeriesAway: number }>,
  roundSeries: any[],
  roundGroups: ProviderSeriesGroup[],
  bySeriesNumber: Map<number, any>,
  allSeries: any[]
) {
  const groupsByConference = new Map<string, ProviderSeriesGroup[]>()
  for (const group of roundGroups) {
    const key = group.conference ?? "unknown"
    groupsByConference.set(key, [...(groupsByConference.get(key) ?? []), group])
  }

  for (const conference of new Set(roundSeries.map((series) => String(series.conference ?? "unknown")))) {
    const seriesForConference = roundSeries.filter((series) => String(series.conference ?? "unknown") === conference)
    const groupsForConference = sortProviderGroupsForReplacement(groupsByConference.get(conference) ?? [])
    const remainingGroups = [...groupsForConference]
    if (groupsForConference.length === 0) continue
    if (seriesForConference.length < groupsForConference.length) {
      warnings.push({
        round: Number(seriesForConference[0]?.roundIndex ?? groupsForConference[0]?.roundIndex ?? 0),
        conference,
        message: `Provider returned ${groupsForConference.length} ${conference} series but only ${seriesForConference.length} bracket slots exist.`,
      })
    }
    if (Number(seriesForConference[0]?.roundIndex ?? groupsForConference[0]?.roundIndex ?? 0) === 2) {
      const sourceLookupSeries = effectiveSeriesForSourceLookup(allSeries, map)
      const sourceSeriesByNumber = new Map(sourceLookupSeries.map((series) => [Number(series.seriesNumber), series]))
      for (const series of seriesForConference) {
        const compatibleIndex = remainingGroups.findIndex((group) => groupMatchesSourceSlots(series, group, sourceSeriesByNumber))
        const group = compatibleIndex >= 0 ? remainingGroups.splice(compatibleIndex, 1)[0] : remainingGroups.shift()
        if (!group) continue
        const matchedBySourceSlots = compatibleIndex >= 0
        map.set(series.id, group)
        assignments.push(assignmentDiagnostic(
          group,
          series,
          matchedBySourceSlots ? "source_slot_compatibility" : "provider_round_order",
          matchedBySourceSlots ? "high" : group.conference ? "medium" : "low"
        ))
        expectedVsActual.push(assignmentDiagnostic(
          group,
          series,
          matchedBySourceSlots ? "source_slot_compatibility" : "provider_round_order",
          matchedBySourceSlots ? "high" : group.conference ? "medium" : "low"
        ))
        if (!matchedBySourceSlots) {
          warnings.push({
            round: 2,
            conference,
            slot: Number(series.seriesNumber ?? null),
            providerSeries: `${group.homeTeamName} vs ${group.awayTeamName}`,
            message: "Round 2 provider pair did not match this slot's Round 1 sources; assigned by provider order fallback.",
          })
        }
        const sourceHome = sourceSeriesForProviderTeam(sourceLookupSeries, group.homeTeamName, conference)
        const sourceAway = sourceSeriesForProviderTeam(sourceLookupSeries, group.awayTeamName, conference)
        if (sourceHome && sourceAway && sourceHome.id !== sourceAway.id) {
          sourceUpdates.set(series.id, {
            sourceSeriesHome: Number(sourceHome.seriesNumber),
            sourceSeriesAway: Number(sourceAway.seriesNumber),
          })
        } else {
          warnings.push({
            round: 2,
            conference,
            slot: Number(series.seriesNumber ?? null),
            providerSeries: `${group.homeTeamName} vs ${group.awayTeamName}`,
            message: "Could not confidently trace both provider teams to distinct Round 1 source slots for My Projection.",
          })
        }
      }
      for (const group of remainingGroups) {
        unmapped.push(groupDiagnostic(group))
      }
      continue
    }
    for (const series of seriesForConference) {
      const compatibleIndex = remainingGroups.findIndex((group) => groupMatchesSourceWinners(series, group, bySeriesNumber))
      if (compatibleIndex < 0) continue
      const [group] = remainingGroups.splice(compatibleIndex, 1)
      map.set(series.id, group)
      assignments.push(assignmentDiagnostic(group, series, "source_winners", "high"))
    }
    for (const series of seriesForConference) {
      if (map.has(series.id)) continue
      const group = remainingGroups.shift()
      if (!group) continue
      map.set(series.id, group)
      assignments.push(assignmentDiagnostic(group, series, "conference_order", group.conference ? "medium" : "low"))
    }
    for (const group of remainingGroups) {
      unmapped.push(groupDiagnostic(group))
    }
  }
}

function sampleExistingSeriesDiagnostics(series: any[]): TeamPairDiagnostic[] {
  return series.slice(0, 5).map((item) => ({
    round: Number(item.roundIndex ?? null),
    homeTeam: displayName(item.homeTeamName),
    awayTeam: displayName(item.awayTeamName),
    eventName: null,
    status: item.status ?? null,
  }))
}

function earliestStart(games: PlayoffSeriesSyncGame[]): Date | null {
  const times = games
    .map((game) => game.startTime ? new Date(game.startTime).getTime() : Number.NaN)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  return times.length > 0 ? new Date(times[0]) : null
}

function gameStartTime(game: PlayoffSeriesSyncGame): number {
  return game.startTime ? new Date(game.startTime).getTime() : Number.NaN
}

function isDateOnlyStartTime(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{8}$/.test(text)
}

function hasKnownStartDate(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim()
  if (!text) return false
  if (isDateOnlyStartTime(text)) return true
  return Number.isFinite(new Date(text).getTime())
}

function nextScheduledGame(games: PlayoffSeriesSyncGame[]): PlayoffSeriesSyncGame | null {
  const now = Date.now()
  return games
    .filter((game) => {
      const status = statusFromGame(game)
      const start = gameStartTime(game)
      return status === "in_progress" || status === "scheduled" && (!Number.isFinite(start) || isDateOnlyStartTime(game.startTime) || start >= now)
    })
    .sort((a, b) => {
      const aStatus = statusFromGame(a)
      const bStatus = statusFromGame(b)
      if (aStatus !== bStatus) return aStatus === "in_progress" ? -1 : 1
      return (gameStartTime(a) || Number.MAX_SAFE_INTEGER) - (gameStartTime(b) || Number.MAX_SAFE_INTEGER)
    })[0] ?? null
}

function liveGame(games: PlayoffSeriesSyncGame[]): PlayoffSeriesSyncGame | null {
  return games.find((game) => statusFromGame(game) === "in_progress") ?? null
}

function buildSeriesSummary(homeTeamName: string, awayTeamName: string, homeWins: number, awayWins: number, winnerTeamName: string | null): string {
  if (winnerTeamName) {
    const verb = winnerTeamName.toLowerCase().endsWith("s") ? "win" : "wins"
    return `${winnerTeamName} ${verb} series ${Math.max(homeWins, awayWins)}-${Math.min(homeWins, awayWins)}`
  }
  if (homeWins === 0 && awayWins === 0) return "Series starts TBD"
  if (homeWins === awayWins) return `Series tied ${homeWins}-${awayWins}`
  const leader = homeWins > awayWins ? homeTeamName : awayTeamName
  return `${leader} leads series ${Math.max(homeWins, awayWins)}-${Math.min(homeWins, awayWins)}`
}

function safeProviderGame(game: PlayoffSeriesSyncGame) {
  return {
    gameId: game.gameId ?? null,
    homeTeam: displayName(game.homeTeamFull || game.homeTeam),
    awayTeam: displayName(game.awayTeamFull || game.awayTeam),
    homeTeamId: game.homeTeamId ?? null,
    awayTeamId: game.awayTeamId ?? null,
    homeScore: game.homeScore ?? null,
    awayScore: game.awayScore ?? null,
    status: game.status ?? null,
    statusDetail: game.statusDetail ?? null,
    startTime: game.startTime ?? null,
    venue: game.venue ?? null,
    broadcast: game.broadcast ?? null,
    eventName: game.eventName ?? null,
    seasonType: game.seasonType ?? null,
  }
}

function aggregateSeriesGames(series: any, games: PlayoffSeriesSyncGame[]): PlayoffSeriesAggregate | null {
  if (games.length === 0) return null
  const homeTeamName = displayName(games[0].homeTeamFull || games[0].homeTeam || series.homeTeamName)
  const awayTeamName = displayName(games[0].awayTeamFull || games[0].awayTeam || series.awayTeamName)
  const bestOf = Number(series.bestOf ?? 7)
  const winsNeeded = Math.floor(bestOf / 2) + 1
  let homeWins = 0
  let awayWins = 0
  let hasLive = false
  let hasScheduled = false
  let hasFinal = false

  for (const game of games) {
    if (homeWins >= winsNeeded || awayWins >= winsNeeded) break
    const status = statusFromGame(game)
    if (status === "in_progress") hasLive = true
    if (status === "scheduled") hasScheduled = true
    if (!isFinalGame(game)) continue
    hasFinal = true
    const winner = winnerFromGame(game)
    if (!winner) continue
    if (sameTeam(winner, series.homeTeamName)) {
      homeWins += 1
    } else if (sameTeam(winner, series.awayTeamName)) {
      awayWins += 1
    }
  }

  const winnerTeamName = homeWins >= winsNeeded
    ? displayName(series.homeTeamName || homeTeamName)
    : awayWins >= winsNeeded
      ? displayName(series.awayTeamName || awayTeamName)
      : null
  const completedWithoutWinnerSource = hasFinal && !winnerTeamName && homeWins === 0 && awayWins === 0 && !hasScheduled && !hasLive
  const status = winnerTeamName
    ? "final"
    : hasLive
      ? "in_progress"
      : completedWithoutWinnerSource
        ? "final"
      : hasScheduled
        ? "scheduled"
        : homeWins > 0 || awayWins > 0
          ? "in_progress"
          : "scheduled"

  const nextGame = nextScheduledGame(games)
  const activeGame = liveGame(games)
  const seriesSummary = buildSeriesSummary(homeTeamName, awayTeamName, homeWins, awayWins, winnerTeamName)

  return {
    games,
    homeWins,
    awayWins,
    status,
    startsAt: earliestStart(games),
    winnerTeamName,
    homeTeamName,
    awayTeamName,
    roundIndex: Number(series.roundIndex ?? roundIndexFromGame(games[0]) ?? 0),
    seriesSummary,
    nextGameAt: nextGame?.startTime && !isDateOnlyStartTime(nextGame.startTime) ? new Date(nextGame.startTime) : null,
    venue: nextGame?.venue ?? null,
    broadcastNetwork: nextGame?.broadcast ?? null,
    liveHomeScore: activeGame?.homeScore ?? null,
    liveAwayScore: activeGame?.awayScore ?? null,
    liveStatus: activeGame?.statusDetail ?? activeGame?.status ?? null,
    providerGamesJson: games.map(safeProviderGame),
    completedWithoutWinnerSource,
  }
}

function aggregateProviderSeriesGroup(group: ProviderSeriesGroup, bestOf = 7): PlayoffSeriesAggregate {
  return aggregateSeriesGames(
    {
      roundIndex: group.roundIndex,
      homeTeamName: group.homeTeamName,
      awayTeamName: group.awayTeamName,
      bestOf,
    },
    group.games
  ) ?? {
    games: group.games,
    homeWins: 0,
    awayWins: 0,
    status: "scheduled",
    startsAt: earliestStart(group.games),
    winnerTeamName: null,
    homeTeamName: group.homeTeamName,
    awayTeamName: group.awayTeamName,
    roundIndex: group.roundIndex,
    seriesSummary: "Series starts TBD",
    nextGameAt: earliestStart(group.games),
    venue: null,
    broadcastNetwork: null,
    liveHomeScore: null,
    liveAwayScore: null,
    liveStatus: null,
    providerGamesJson: group.games.map(safeProviderGame),
    completedWithoutWinnerSource: false,
  }
}

async function fetchFinalScoreSupplementGames(input: {
  sport: PlayoffSport
  seasonYear: number
  dates: string[]
}): Promise<{ source: "espn_final_scores" | "rolling_insights_final_scores" | "none"; games: PlayoffSeriesSyncGame[]; warnings: string[] }> {
  const leagueSport = SPORT_TO_LEAGUE_SPORT[input.sport]
  const dates = Array.from(new Set(input.dates)).filter(Boolean).slice(0, 90)
  if (dates.length === 0) {
    return { source: "none", games: [], warnings: [] }
  }

  const espnRows = await fetchEspnScoreboard(leagueSport, { dates })
  if (espnRows.length > 0) {
    return { source: "espn_final_scores", games: espnRows.map(rowToSyncGame), warnings: [] }
  }

  const rollingRows = await fetchRollingInsightsScoreboard(leagueSport, { forceRefresh: true })
  const dateSet = new Set(dates)
  const rollingGames = rollingRows
    .map(rowToSyncGame)
    .filter((game) => {
      const date = espnDateFromStartTime(game.startTime)
      return date ? dateSet.has(date) : false
    })
  return {
    source: rollingGames.length > 0 ? "rolling_insights_final_scores" : "none",
    games: rollingGames,
    warnings: rollingGames.length > 0 ? [] : ["No final score supplement data found for completed series."],
  }
}

function gameKey(game: PlayoffSeriesSyncGame): string {
  return [
    normalizeName(game.homeTeamFull || game.homeTeam).toLowerCase(),
    normalizeName(game.awayTeamFull || game.awayTeam).toLowerCase(),
    game.startTime ?? "",
  ].join("|")
}

async function fetchEspnScheduleSupplementGames(input: {
  sport: PlayoffSport
  seasonYear: number
  windowDays?: number
}): Promise<{ source: "espn_live"; games: PlayoffSeriesSyncGame[]; warnings: string[] }> {
  const leagueSport = SPORT_TO_LEAGUE_SPORT[input.sport]
  const dates = buildEspnScoreboardDateWindow(input.windowDays ?? 7)
  const rows = await fetchEspnScoreboard(leagueSport, { dates })
  const games = rows.map(rowToSyncGame)
  return {
    source: "espn_live",
    games,
    warnings: games.length === 0 ? [`ESPN returned no ${input.sport.toUpperCase()} near-term schedule/live games.`] : [],
  }
}

export async function refreshPlayoffScheduleMetadataForChallenge(input: {
  challengeId: string
  provider?: "espn"
  windowDays?: number
  dryRun?: boolean
  scheduleSupplementProvider?: PlayoffSeriesScheduleSupplementProvider
}): Promise<RefreshPlayoffScheduleMetadataResult> {
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: {
      series: {
        orderBy: [{ roundIndex: "asc" }, { seriesNumber: "asc" }],
      },
    },
  })

  if (!challenge) {
    throw new Error("Challenge not found")
  }

  const sport = assertSyncableSport(challenge.sport, "schedule refresh")

  const warnings: string[] = []
  const scheduleProvider = input.scheduleSupplementProvider ?? ((providerInput) =>
    fetchEspnScheduleSupplementGames({ ...providerInput, windowDays: input.windowDays ?? 7 }))
  const supplementPayload = await scheduleProvider({
    sport,
    seasonYear: challenge.seasonYear,
  })
  warnings.push(...(supplementPayload.warnings ?? []))

  const supplementDiagnostics = scheduleSupplementDiagnostics({
    series: challenge.series,
    source: supplementPayload.source,
    games: supplementPayload.games,
  })

  let updatedSeries = 0
  for (const series of challenge.series) {
    const games = gamesForSeries(series, supplementPayload.games)
    const aggregate = aggregateSeriesGames(series, games)
    if (!aggregate) continue
    updatedSeries += 1

    if (input.dryRun) continue

    await (prisma as any).playoffBracketSeries.update({
      where: { id: series.id },
      data: {
        nextGameAt: aggregate.nextGameAt,
        venue: aggregate.venue,
        broadcastNetwork: aggregate.broadcastNetwork,
        liveHomeScore: aggregate.liveHomeScore,
        liveAwayScore: aggregate.liveAwayScore,
        liveStatus: aggregate.liveStatus,
        providerGamesJson: aggregate.providerGamesJson,
        lastSyncedAt: new Date(),
      },
    })
  }

  if (updatedSeries === 0) {
    warnings.push("No playoff series matched ESPN schedule/live games.")
  }

  return {
    ok: warnings.length === 0 || updatedSeries > 0,
    challengeId: challenge.id,
    sport,
    provider: "espn",
    dryRun: input.dryRun === true,
    updatedSeries,
    scheduleGamesSeen: supplementDiagnostics.scheduleGamesSeen,
    scheduleGamesMatched: supplementDiagnostics.scheduleGamesMatched,
    liveGamesMatched: supplementDiagnostics.liveGamesMatched,
    broadcastFieldsFound: supplementDiagnostics.broadcastFieldsFound,
    venueFieldsFound: supplementDiagnostics.venueFieldsFound,
    warnings,
    diagnostics: {
      scheduleSupplementProvider: supplementDiagnostics.scheduleSupplementProvider,
      scheduleGamesSeen: supplementDiagnostics.scheduleGamesSeen,
      scheduleGamesMatched: supplementDiagnostics.scheduleGamesMatched,
      liveGamesMatched: supplementDiagnostics.liveGamesMatched,
      broadcastFieldsFound: supplementDiagnostics.broadcastFieldsFound,
      venueFieldsFound: supplementDiagnostics.venueFieldsFound,
      unmatchedScheduleExamples: supplementDiagnostics.unmatchedScheduleExamples,
      scheduleDateKnownButTimeMissing: supplementDiagnostics.scheduleDateKnownButTimeMissing,
      nextGameDateOnlyExamples: supplementDiagnostics.nextGameDateOnlyExamples,
    },
  }
}

function mergeProviderGames(primaryGames: PlayoffSeriesSyncGame[], supplementGames: PlayoffSeriesSyncGame[]): PlayoffSeriesSyncGame[] {
  const byKey = new Map<string, PlayoffSeriesSyncGame>()
  for (const game of primaryGames) {
    byKey.set(gameKey(game), game)
  }
  for (const game of supplementGames) {
    const key = gameKey(game)
    const existing = byKey.get(key)
    byKey.set(key, {
      ...(existing ?? {}),
      ...game,
      eventName: existing?.eventName ?? game.eventName ?? null,
      seasonType: existing?.seasonType ?? game.seasonType ?? null,
      providerRound: existing?.providerRound ?? game.providerRound ?? null,
      venue: game.venue ?? existing?.venue ?? null,
      broadcast: game.broadcast ?? existing?.broadcast ?? null,
      startTime: game.startTime ?? existing?.startTime ?? null,
      status: game.status ?? existing?.status ?? null,
      statusDetail: game.statusDetail ?? existing?.statusDetail ?? null,
      homeScore: game.homeScore ?? existing?.homeScore ?? null,
      awayScore: game.awayScore ?? existing?.awayScore ?? null,
      completed: game.completed ?? existing?.completed ?? false,
    })
  }
  return Array.from(byKey.values())
}

function scheduleSupplementDiagnostics(input: {
  series: any[]
  source: "espn_live" | "rolling_insights_live" | "none"
  games: PlayoffSeriesSyncGame[]
}) {
  const matchedGameKeys = new Set<string>()
  let scheduleGamesMatched = 0
  let liveGamesMatched = 0
  let scheduleDateKnownButTimeMissing = 0
  const unmatchedGames: PlayoffSeriesSyncGame[] = []
  const dateOnlyGames: PlayoffSeriesSyncGame[] = []
  for (const game of input.games) {
    const matched = input.series.some((series) => gameMatchesSeries(series, game))
    if (!matched) {
      unmatchedGames.push(game)
      continue
    }
    matchedGameKeys.add(gameKey(game))
    scheduleGamesMatched += 1
    if (statusFromGame(game) === "in_progress") liveGamesMatched += 1
    if (isDateOnlyStartTime(game.startTime) || (hasKnownStartDate(game.startTime) && !Number.isFinite(gameStartTime(game)))) {
      scheduleDateKnownButTimeMissing += 1
      dateOnlyGames.push(game)
    }
  }
  return {
    scheduleSupplementProvider: input.source,
    scheduleGamesSeen: input.games.length,
    scheduleGamesMatched,
    liveGamesMatched,
    broadcastFieldsFound: input.games.filter((game) => !!game.broadcast).length,
    venueFieldsFound: input.games.filter((game) => !!game.venue).length,
    unmatchedScheduleExamples: sampleGameDiagnostics(unmatchedGames),
    scheduleDateKnownButTimeMissing,
    nextGameDateOnlyExamples: sampleGameDiagnostics(dateOnlyGames),
    matchedGameKeys,
  }
}

function scheduleSafeSeriesSummary(aggregate: PlayoffSeriesAggregate): string {
  if (aggregate.liveStatus) return "Series in progress"
  if (aggregate.startsAt || aggregate.nextGameAt) return "Series scheduled"
  return "Series starts TBD"
}

export async function syncPlayoffChallengeSeries(input: {
  challengeId: string
  provider?: PlayoffSeriesSyncProvider
  scheduleSupplementProvider?: PlayoffSeriesScheduleSupplementProvider
  finalScoreSupplementProvider?: PlayoffSeriesFinalScoreSupplementProvider
  providerPreference?: PlayoffSeriesSyncProviderPreference
  mode?: PlayoffSeriesSyncMode
}): Promise<SyncPlayoffChallengeSeriesResult> {
  const warnings: string[] = []
  const mode = input.mode ?? "official_bracket"
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: {
      series: {
        orderBy: [{ roundIndex: "asc" }, { seriesNumber: "asc" }],
      },
    },
  })

  if (!challenge) {
    throw new Error("Challenge not found")
  }

  const sport = assertSyncableSport(challenge.sport, "sync")

  if (mode === "autofill_results" && !challenge.isTestMode) {
    throw new Error("Auto-fill official results is only available for commissioner test pools")
  }

  const provider = input.provider ?? fetchLivePlayoffSeriesGames
  const payload = await provider({
    sport,
    seasonYear: challenge.seasonYear,
    providerPreference: input.providerPreference ?? "auto",
  })
  const attemptedProviders = payload.attemptedProviders ?? [payload.source].filter(Boolean)
  warnings.push(...(payload.warnings ?? []))
  const diagnostics: PlayoffSyncDiagnostics = {
    seasonYear: challenge.seasonYear,
    challengeSeasonYear: payload.diagnostics?.challengeSeasonYear ?? challenge.seasonYear,
    selectedProviderSeason: payload.diagnostics?.selectedProviderSeason ?? null,
    providerSeasonAttempts: payload.diagnostics?.providerSeasonAttempts ?? [],
    seasonSelectionExplanation: payload.diagnostics?.seasonSelectionExplanation ?? null,
    sport,
    selectedProvider: payload.source,
    providerAttempts: payload.diagnostics?.providerAttempts ?? [],
    existingSeriesExamples: sampleExistingSeriesDiagnostics(challenge.series),
    providerGameExamples: payload.diagnostics?.providerGameExamples?.length
      ? payload.diagnostics.providerGameExamples
      : sampleGameDiagnostics(payload.games),
    providerSeriesExamples: payload.diagnostics?.providerSeriesExamples?.length
      ? payload.diagnostics.providerSeriesExamples
      : [],
    ignoredPlayInGames: payload.diagnostics?.ignoredPlayInGames ?? payload.games.filter(isPlayInGame).length,
    eventNameRoundMapExamples: payload.diagnostics?.eventNameRoundMapExamples ?? sampleEventNameRoundDiagnostics(payload.games, sport),
    providerSeriesByRound: payload.diagnostics?.providerSeriesByRound ?? {},
    providerAssignments: payload.diagnostics?.providerAssignments ?? [],
    officialSeriesByRound: payload.diagnostics?.officialSeriesByRound ?? {},
    officialSeriesSlotAssignments: payload.diagnostics?.officialSeriesSlotAssignments ?? [],
    providerRound2WestSeries: payload.diagnostics?.providerRound2WestSeries ?? [],
    providerRound2EastSeries: payload.diagnostics?.providerRound2EastSeries ?? [],
    slotAssignmentWarnings: payload.diagnostics?.slotAssignmentWarnings ?? [],
    unmappedProviderSeries: payload.diagnostics?.unmappedProviderSeries ?? [],
    conflictingSlotAssignments: payload.diagnostics?.conflictingSlotAssignments ?? [],
    expectedVsActualSlotExamples: payload.diagnostics?.expectedVsActualSlotExamples ?? [],
    completedProviderSeries: payload.diagnostics?.completedProviderSeries ?? 0,
    completedSeriesWithWinner: payload.diagnostics?.completedSeriesWithWinner ?? 0,
    completedSeriesWithoutWinner: payload.diagnostics?.completedSeriesWithoutWinner ?? 0,
    resultsOnlyStrippedWinners: payload.diagnostics?.resultsOnlyStrippedWinners ?? false,
    resultPersistenceExamples: payload.diagnostics?.resultPersistenceExamples ?? [],
    finalScoreSupplementProvider: payload.diagnostics?.finalScoreSupplementProvider ?? "none",
    finalScoreDatesFetched: payload.diagnostics?.finalScoreDatesFetched ?? 0,
    finalScoreRowsSeen: payload.diagnostics?.finalScoreRowsSeen ?? 0,
    finalScoreRowsMatched: payload.diagnostics?.finalScoreRowsMatched ?? 0,
    seriesWinsComputed: payload.diagnostics?.seriesWinsComputed ?? 0,
    seriesWinnersComputed: payload.diagnostics?.seriesWinnersComputed ?? 0,
    templateReplacementCount: 0,
    updatedSeriesExamples: [],
    scheduleSupplementProvider: "none",
    scheduleGamesSeen: 0,
    scheduleGamesMatched: 0,
    liveGamesMatched: 0,
    broadcastFieldsFound: 0,
    venueFieldsFound: 0,
    unmatchedScheduleExamples: [],
    scheduleDateKnownButTimeMissing: 0,
    nextGameDateOnlyExamples: [],
    noMatchReason: null,
  }

  const scheduleSupplementProvider = input.scheduleSupplementProvider ?? (input.provider ? async () => ({
    source: "none" as const,
    games: [],
    warnings: [],
  }) : fetchEspnScheduleSupplementGames)
  const supplementPayload = await scheduleSupplementProvider({
    sport,
    seasonYear: challenge.seasonYear,
  })
  warnings.push(...(supplementPayload.warnings ?? []))
  const supplementDiagnostics = scheduleSupplementDiagnostics({
    series: challenge.series,
    source: supplementPayload.source,
    games: supplementPayload.games,
  })
  diagnostics.scheduleSupplementProvider = supplementDiagnostics.scheduleSupplementProvider
  diagnostics.scheduleGamesSeen = supplementDiagnostics.scheduleGamesSeen
  diagnostics.scheduleGamesMatched = supplementDiagnostics.scheduleGamesMatched
  diagnostics.liveGamesMatched = supplementDiagnostics.liveGamesMatched
  diagnostics.broadcastFieldsFound = supplementDiagnostics.broadcastFieldsFound
  diagnostics.venueFieldsFound = supplementDiagnostics.venueFieldsFound
  diagnostics.unmatchedScheduleExamples = supplementDiagnostics.unmatchedScheduleExamples
  diagnostics.scheduleDateKnownButTimeMissing = supplementDiagnostics.scheduleDateKnownButTimeMissing
  diagnostics.nextGameDateOnlyExamples = supplementDiagnostics.nextGameDateOnlyExamples

  let seriesUpdated = 0
  let winnersUpdated = 0
  let gamesMatched = 0
  let seriesMatched = 0
  const matchedGameKeys = new Set<string>()
  const providerSeriesGroups = buildProviderSeriesGroups(payload.games, sport)
  diagnostics.providerSeriesExamples = sampleSeriesDiagnostics(providerSeriesGroups)
  diagnostics.providerSeriesByRound = providerSeriesByRound(providerSeriesGroups)
  const usedGroupKeys = new Set<string>()
  const invalidatedSeriesIds = new Set<string>()
  const templateReplacementResult = mapTemplateReplacementGroups(challenge.series, providerSeriesGroups)
  const templateReplacementGroups = templateReplacementResult.map
  const finalScoreGamesByGroupKey = new Map<string, PlayoffSeriesSyncGame[]>()
  const matchedFinalScoreKeys = new Set<string>()
  diagnostics.providerAssignments = templateReplacementResult.assignments
  diagnostics.officialSeriesByRound = officialSeriesByRound(providerSeriesGroups)
  diagnostics.officialSeriesSlotAssignments = templateReplacementResult.assignments
  diagnostics.providerRound2WestSeries = providerSeriesGroups
    .filter((group) => group.roundIndex === 2 && group.conference === "west")
    .map(groupDiagnostic)
  diagnostics.providerRound2EastSeries = providerSeriesGroups
    .filter((group) => group.roundIndex === 2 && group.conference === "east")
    .map(groupDiagnostic)
  diagnostics.slotAssignmentWarnings = templateReplacementResult.warnings
  diagnostics.unmappedProviderSeries = templateReplacementResult.unmapped
  diagnostics.conflictingSlotAssignments = templateReplacementResult.conflicts
  diagnostics.expectedVsActualSlotExamples = templateReplacementResult.expectedVsActual.slice(0, 12)
  const resultsOnlyMode = mode === "results_only"
  const finalScoreDates = resultsOnlyMode ? collectProviderGameDates(providerSeriesGroups) : []
  const finalScoreProvider = input.finalScoreSupplementProvider ?? fetchFinalScoreSupplementGames
  const finalScorePayload = resultsOnlyMode
    ? await finalScoreProvider({
      sport,
      seasonYear: challenge.seasonYear,
      dates: finalScoreDates,
    })
    : { source: "none" as const, games: [], warnings: [] }
  warnings.push(...(finalScorePayload.warnings ?? []))
  diagnostics.finalScoreSupplementProvider = finalScorePayload.source
  diagnostics.finalScoreDatesFetched = finalScoreDates.length
  diagnostics.finalScoreRowsSeen = finalScorePayload.games.length
  if (resultsOnlyMode && finalScorePayload.games.length > 0) {
    for (const group of providerSeriesGroups) {
      const groupDates = new Set(group.games.map((game) => espnDateFromStartTime(game.startTime)).filter(Boolean) as string[])
      const matchedScores = finalScorePayload.games.filter((game) => {
        const date = espnDateFromStartTime(game.startTime)
        return (!date || groupDates.has(date)) && gameMatchesSeries(
          {
            roundIndex: group.roundIndex,
            homeTeamName: group.homeTeamName,
            awayTeamName: group.awayTeamName,
          },
          game
        )
      })
      if (matchedScores.length > 0) {
        finalScoreGamesByGroupKey.set(group.key, matchedScores)
        for (const game of matchedScores) matchedFinalScoreKeys.add(gameKey(game))
      }
    }
  }
  diagnostics.finalScoreRowsMatched = matchedFinalScoreKeys.size
  let templateReplacementCount = 0
  const updatedSeriesExamples: UpdatedSeriesDiagnostic[] = []
  const resultPersistenceExamples: ResultPersistenceDiagnostic[] = []
  const officialWinnerBySeriesId = new Map<string, string>()

  for (const series of challenge.series) {
    const replacementGroup = templateReplacementGroups.get(series.id) ?? null
    const seriesGames = mergeProviderGames(
      gamesForSeries(series, payload.games),
      gamesForSeries(series, supplementPayload.games)
    )
    let matchedGroup: ProviderSeriesGroup | null = replacementGroup
    let aggregate = matchedGroup ? aggregateProviderSeriesGroup(matchedGroup, Number(series.bestOf ?? 7)) : aggregateSeriesGames(series, seriesGames)
    if (matchedGroup) {
      usedGroupKeys.add(matchedGroup.key)
      templateReplacementCount += 1
    }
    if (!aggregate) {
      matchedGroup = templateReplacementGroups.get(series.id) ?? providerSeriesGroups.find((group) => {
        if (usedGroupKeys.has(group.key)) return false
        if (group.roundIndex !== Number(series.roundIndex)) return false
        if (gameMatchesSeries(series, group.games[0])) return true
        if (!isTemplateSeries(series)) return false
        const seriesConference = String(series.conference ?? "").toLowerCase()
        return !group.conference || !seriesConference || group.conference === seriesConference
      }) ?? null
      if (matchedGroup) {
        aggregate = aggregateProviderSeriesGroup(matchedGroup, Number(series.bestOf ?? 7))
        usedGroupKeys.add(matchedGroup.key)
        if (templateReplacementGroups.get(series.id)?.key === matchedGroup.key) {
          templateReplacementCount += 1
        }
      }
    }
    if (!aggregate) continue
    const resultScoreGames = matchedGroup ? finalScoreGamesByGroupKey.get(matchedGroup.key) ?? [] : gamesForSeries(series, finalScorePayload.games)
    const aggregateGames = matchedGroup
      ? mergeProviderGames(mergeProviderGames(matchedGroup.games, gamesForSeries(series, supplementPayload.games)), resultScoreGames)
      : mergeProviderGames(seriesGames, resultScoreGames)
    aggregate = aggregateSeriesGames(
      {
        ...series,
        homeTeamName: matchedGroup?.homeTeamName ?? series.homeTeamName,
        awayTeamName: matchedGroup?.awayTeamName ?? series.awayTeamName,
      },
      aggregateGames
    ) ?? aggregate
    if (!aggregate) continue
    gamesMatched += aggregateGames.length
    seriesMatched += 1
    for (const game of aggregateGames) {
      matchedGameKeys.add(gameKey(game))
    }
    const teamsScheduleOnly = mode === "teams_schedule_only" || mode === "schedule_only"
    const resultsOnly = mode === "results_only"
    const shouldUpdateOfficialTeams = !resultsOnly
    const nextHomeTeamName = shouldUpdateOfficialTeams ? aggregate.homeTeamName : series.homeTeamName
    const nextAwayTeamName = shouldUpdateOfficialTeams ? aggregate.awayTeamName : series.awayTeamName
    const nextWinnerTeamName = teamsScheduleOnly ? null : aggregate.winnerTeamName
    const nextHomeWins = teamsScheduleOnly ? 0 : aggregate.homeWins
    const nextAwayWins = teamsScheduleOnly ? 0 : aggregate.awayWins
    const nextStatus = teamsScheduleOnly
      ? (aggregate.liveStatus ? "in_progress" : "scheduled")
      : aggregate.status
    const nextSeriesSummary = teamsScheduleOnly ? scheduleSafeSeriesSummary(aggregate) : aggregate.seriesSummary
    const scoreSource = resultScoreGames.length > 0 ? finalScorePayload.source : null
    if (scoreSource && (nextHomeWins > 0 || nextAwayWins > 0)) {
      diagnostics.seriesWinsComputed += 1
    }
    if (scoreSource && nextWinnerTeamName) {
      diagnostics.seriesWinnersComputed += 1
    }
    const providerCompleted = aggregate.status === "final" || aggregate.games.some((game) => statusFromGame(game) === "final")
    if (providerCompleted) {
      diagnostics.completedProviderSeries += 1
      if (nextWinnerTeamName) {
        diagnostics.completedSeriesWithWinner += 1
      } else {
        diagnostics.completedSeriesWithoutWinner += 1
      }
    }
    if (teamsScheduleOnly && aggregate.winnerTeamName) {
      diagnostics.resultsOnlyStrippedWinners = mode === "results_only"
    }
    if (resultPersistenceExamples.length < 8 && (resultsOnly || providerCompleted)) {
      resultPersistenceExamples.push({
        seriesNumber: Number(series.seriesNumber ?? 0),
        providerStatus: aggregate.status,
        persistedStatus: nextStatus,
        providerWinner: aggregate.winnerTeamName,
        persistedWinner: nextWinnerTeamName,
        seriesSummary: nextSeriesSummary,
        scoreSource,
      })
    }
    const previousTeams = [series.homeTeamName, series.awayTeamName].map((name) => normalizeName(name).toLowerCase())
    const nextTeams = [nextHomeTeamName, nextAwayTeamName].map((name) => normalizeName(name).toLowerCase())
    const teamsChanged = !previousTeams.every((name) => nextTeams.includes(name))
    if (shouldUpdateOfficialTeams && teamsChanged) {
      invalidatedSeriesIds.add(series.id)
    }

    await (prisma as any).playoffBracketSeries.update({
      where: { id: series.id },
      data: {
        homeTeamName: nextHomeTeamName,
        awayTeamName: nextAwayTeamName,
        ...(shouldUpdateOfficialTeams && templateReplacementResult.sourceUpdates.has(series.id)
          ? templateReplacementResult.sourceUpdates.get(series.id)
          : {}),
        status: nextStatus,
        startsAt: aggregate.startsAt,
        winnerTeamName: nextWinnerTeamName,
        homeTeamWins: nextHomeWins,
        awayTeamWins: nextAwayWins,
        seriesSummary: nextSeriesSummary,
        nextGameAt: aggregate.nextGameAt,
        venue: aggregate.venue,
        broadcastNetwork: aggregate.broadcastNetwork,
        liveHomeScore: aggregate.liveHomeScore,
        liveAwayScore: aggregate.liveAwayScore,
        liveStatus: aggregate.liveStatus,
        providerGamesJson: aggregate.providerGamesJson,
        lastSyncedAt: new Date(),
      },
    })
    seriesUpdated += 1
    if (updatedSeriesExamples.length < 8) {
      updatedSeriesExamples.push({
        round: Number(series.roundIndex ?? aggregate.roundIndex),
        oldHomeTeam: displayName(series.homeTeamName),
        oldAwayTeam: displayName(series.awayTeamName),
        newHomeTeam: nextHomeTeamName,
        newAwayTeam: nextAwayTeamName,
        eventName: matchedGroup?.eventName ?? aggregateGames[0]?.eventName ?? null,
        status: nextStatus,
      })
    }
    if (nextWinnerTeamName) winnersUpdated += 1
    if (nextWinnerTeamName) {
      officialWinnerBySeriesId.set(series.id, nextWinnerTeamName)
    }
  }

  diagnostics.resultPersistenceExamples = resultPersistenceExamples
  diagnostics.resultsOnlyStrippedWinners = mode === "results_only" ? false : diagnostics.resultsOnlyStrippedWinners
  if (mode === "results_only" && diagnostics.completedProviderSeries > 0 && diagnostics.finalScoreRowsMatched > 0) {
    warnings.push(`Rolling Insights schedule-season had completed series but no scores; ${diagnostics.finalScoreSupplementProvider} final score supplement found ${diagnostics.finalScoreRowsMatched} matched games.`)
  }
  if (mode === "results_only" && diagnostics.completedProviderSeries > 0 && winnersUpdated === 0) {
    warnings.push("Results sync matched completed series but found no winner data to persist.")
  }

  if (invalidatedSeriesIds.size > 0) {
    const officialTeamNames = Array.from(new Set(providerSeriesGroups.flatMap((group) => [group.homeTeamName, group.awayTeamName])))
    await (prisma as any).playoffBracketPick.deleteMany({
      where: {
        challengeId: challenge.id,
        seriesId: { in: Array.from(invalidatedSeriesIds) },
        NOT: {
          pickTeamName: {
            in: officialTeamNames,
          },
        },
      },
    })
  }

  let picksAutoFilled = 0
  if (mode === "autofill_results") {
    const entries = await (prisma as any).playoffBracketEntry.findMany({
      where: { challengeId: challenge.id },
      select: { id: true },
    })
    for (const entry of entries) {
      for (const [seriesId, winnerTeamName] of officialWinnerBySeriesId) {
        await (prisma as any).playoffBracketPick.upsert({
          where: {
            entryId_seriesId: {
              entryId: entry.id,
              seriesId,
            },
          },
          create: {
            challengeId: challenge.id,
            entryId: entry.id,
            seriesId,
            pickTeamName: winnerTeamName,
          },
          update: {
            pickTeamName: winnerTeamName,
          },
        })
        picksAutoFilled += 1
      }
    }
  }

  if (seriesUpdated === 0) {
    warnings.push("No playoff series matched provider games.")
    diagnostics.noMatchReason = providerSeriesGroups.length === 0
      ? "No provider playoff series could be built after event name round mapping."
      : "Provider playoff series were built, but none matched existing bracket series or eligible template slots."
  }
  diagnostics.templateReplacementCount = templateReplacementCount
  diagnostics.updatedSeriesExamples = updatedSeriesExamples
  const unmatchedGames = payload.games.filter((game) => !matchedGameKeys.has(gameKey(game)))
  const ignoredPlayInGames = unmatchedGames.filter(isPlayInGame)
  const trueUnmatchedGames = unmatchedGames.filter((game) => !isPlayInGame(game))
  diagnostics.ignoredPlayInGames = ignoredPlayInGames.length
  if (ignoredPlayInGames.length > 0) {
    warnings.push(`${ignoredPlayInGames.length} Play-In games ignored because this pool does not include Play-In picks.`)
  }
  if (trueUnmatchedGames.length > 0) {
    warnings.push(`${trueUnmatchedGames.length} provider games did not match playoff series.`)
  }

  return {
    ok: warnings.length === 0 || seriesUpdated > 0,
    challengeId: challenge.id,
    sport,
    mode,
    source: payload.source,
    challengeSeasonYear: challenge.seasonYear,
    selectedProviderSeason: diagnostics.selectedProviderSeason,
    providerSeasonAttempts: diagnostics.providerSeasonAttempts,
    attemptedProviders,
    postseasonGames: payload.games.filter((game) => String(game.seasonType ?? "").toLowerCase() === "postseason").length,
    gamesSeen: payload.games.length,
    gamesMatched,
    seriesReturned: providerSeriesGroups.length,
    seriesMatched,
    seriesUpdated,
    winnersUpdated,
    picksAutoFilled,
    warnings,
    unmatchedExamples: trueUnmatchedGames.slice(0, 5).map((game) => ({
      homeTeam: displayName(game.homeTeamFull || game.homeTeam),
      awayTeam: displayName(game.awayTeamFull || game.awayTeam),
      eventName: game.eventName ?? null,
      round: game.providerRound ?? null,
    })),
    diagnostics,
  }
}
