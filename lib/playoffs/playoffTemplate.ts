import type {
  BuildPlayoffTemplateInput,
  PlayoffRoundKey,
  PlayoffSport,
  PlayoffTemplateSeries,
} from "./types"

const CONFERENCE_ROUND_ORDER: PlayoffRoundKey[] = [
  "round_1",
  "conference_semifinals",
  "conference_finals",
  "finals",
]

const MLB_ROUND_ORDER: PlayoffRoundKey[] = [
  "wild_card",
  "division_series",
  "league_championship",
  "world_series",
]

const ROUND_ORDER_BY_SPORT: Record<PlayoffSport, PlayoffRoundKey[]> = {
  nba: CONFERENCE_ROUND_ORDER,
  nhl: CONFERENCE_ROUND_ORDER,
  mlb: MLB_ROUND_ORDER,
}

const NBA_TEAMS = {
  east: ["Celtics", "Knicks", "Bucks", "Cavaliers", "Magic", "Pacers", "Heat", "76ers"],
  west: ["Thunder", "Nuggets", "Timberwolves", "Mavericks", "Suns", "Lakers", "Pelicans", "Warriors"],
} as const

const NHL_TEAMS = {
  east: ["Rangers", "Hurricanes", "Panthers", "Maple Leafs", "Bruins", "Lightning", "Islanders", "Red Wings"],
  west: ["Stars", "Avalanche", "Canucks", "Oilers", "Jets", "Kings", "Golden Knights", "Predators"],
} as const

/*
 * SIX per league, not eight — the MLB field is twelve. A seventh entry here
 * would be silently unreachable, because `buildMlbTemplate` never asks for a
 * seed above 6.
 */
const MLB_TEAMS = {
  al: ["Yankees", "Guardians", "Astros", "Orioles", "Royals", "Tigers"],
  nl: ["Dodgers", "Phillies", "Brewers", "Padres", "Mets", "Braves"],
} as const

const TEST_MODE_TEAMS: Record<PlayoffSport, Record<string, readonly string[]>> = {
  nba: NBA_TEAMS,
  nhl: NHL_TEAMS,
  mlb: MLB_TEAMS,
}

/**
 * ⚠ THE NON-TEST NAME IS THE SEED SLOT, AND IT MUST READ AS "OFFICIAL".
 * `isOfficialTeamName` in playoffBracketProjection.ts treats anything that is
 * not a `Winner S<n>` / `… Champion` placeholder as a settled team, which is
 * what makes a seeded slot pickable before the bracket is populated. `AL1`
 * qualifies; do not reword it into something ending in "Champion" or "Winner".
 */
function resolveSeedName(
  sport: BuildPlayoffTemplateInput["sport"],
  conference: "east" | "west" | "al" | "nl",
  seed: number,
  isTestMode: boolean,
) {
  const fallback = `${conference.toUpperCase()}${seed}`
  if (!isTestMode) return fallback
  return TEST_MODE_TEAMS[sport]?.[conference]?.[seed - 1] ?? fallback
}

function createSeries(data: PlayoffTemplateSeries): PlayoffTemplateSeries {
  return data
}

export function getPlayoffRoundOrder(sport?: PlayoffSport): PlayoffRoundKey[] {
  /*
   * The no-argument call keeps the conference order it has always returned.
   * Every caller that knows its sport should pass it; the default exists so an
   * older caller cannot silently start rendering baseball round headers.
   */
  return [...(sport ? ROUND_ORDER_BY_SPORT[sport] ?? CONFERENCE_ROUND_ORDER : CONFERENCE_ROUND_ORDER)]
}

/**
 * The MLB postseason, as it has actually been played since 2022.
 *
 * ⚠ THE DIVISION SERIES PAIRING IS FIXED, NOT RESEEDED. #1 meets the winner of
 * #4/#5 and #2 meets the winner of #3/#6 — MLB does not reseed after the Wild
 * Card round, so the higher seed is NOT handed the lowest survivor. Getting
 * this backwards produces a bracket that looks right and pays out wrong.
 *
 * ⚠ BYES ARE EXPRESSED BY ABSENCE. Seeds 1 and 2 simply do not appear in the
 * Wild Card round; they enter at the Division Series with a real seed name on
 * one side and a `Winner S<n>` placeholder on the other. There is no bye row,
 * and nothing should pre-fill the opponent.
 *
 * ⚠ SERIES LENGTHS ARE SCORING RULES. Bo3 / Bo5 / Bo7 / Bo7 are the real
 * formats; a wrong `bestOf` misprices a pool people entered.
 */
function buildMlbTemplate(isTestMode: boolean): PlayoffTemplateSeries[] {
  const seed = (conference: "al" | "nl", n: number) => resolveSeedName("mlb", conference, n, isTestMode)

  const wildCard = ([1, 2, 3, 4] as const).map((seriesNumber) => {
    // S1/S2 are American League, S3/S4 National League; within a league the
    // 3v6 series is first.
    const conference: "al" | "nl" = seriesNumber <= 2 ? "al" : "nl"
    const isThreeSix = seriesNumber % 2 === 1
    const homeSeed = isThreeSix ? 3 : 4
    const awaySeed = isThreeSix ? 6 : 5
    // 3/6 feeds the #2 seed's Division Series; 4/5 feeds the #1 seed's.
    const nextSeriesNumber = conference === "al" ? (isThreeSix ? 6 : 5) : (isThreeSix ? 8 : 7)
    return createSeries({
      round: "wild_card",
      roundIndex: 1,
      seriesNumber,
      conference,
      homeSeed,
      awaySeed,
      homeTeamName: seed(conference, homeSeed),
      awayTeamName: seed(conference, awaySeed),
      winnerTeamName: null,
      bestOf: 3,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber,
      nextSeriesSlot: "away",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    })
  })

  const divisionSeries = (
    [
      { seriesNumber: 5, conference: "al", topSeed: 1, from: 2, nextSeriesNumber: 9, nextSeriesSlot: "home" },
      { seriesNumber: 6, conference: "al", topSeed: 2, from: 1, nextSeriesNumber: 9, nextSeriesSlot: "away" },
      { seriesNumber: 7, conference: "nl", topSeed: 1, from: 4, nextSeriesNumber: 10, nextSeriesSlot: "home" },
      { seriesNumber: 8, conference: "nl", topSeed: 2, from: 3, nextSeriesNumber: 10, nextSeriesSlot: "away" },
    ] as const
  ).map((spec) =>
    createSeries({
      round: "division_series",
      roundIndex: 2,
      seriesNumber: spec.seriesNumber,
      conference: spec.conference,
      homeSeed: spec.topSeed,
      awaySeed: 0,
      homeTeamName: seed(spec.conference, spec.topSeed),
      awayTeamName: `Winner S${spec.from}`,
      winnerTeamName: null,
      bestOf: 5,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: spec.nextSeriesNumber,
      nextSeriesSlot: spec.nextSeriesSlot,
      sourceSeriesHome: null,
      sourceSeriesAway: spec.from,
    }),
  )

  const championshipSeries = (
    [
      { seriesNumber: 9, conference: "al", home: 5, away: 6, nextSeriesSlot: "home" },
      { seriesNumber: 10, conference: "nl", home: 7, away: 8, nextSeriesSlot: "away" },
    ] as const
  ).map((spec) =>
    createSeries({
      round: "league_championship",
      roundIndex: 3,
      seriesNumber: spec.seriesNumber,
      conference: spec.conference,
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: `Winner S${spec.home}`,
      awayTeamName: `Winner S${spec.away}`,
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 11,
      nextSeriesSlot: spec.nextSeriesSlot,
      sourceSeriesHome: spec.home,
      sourceSeriesAway: spec.away,
    }),
  )

  const worldSeries = createSeries({
    round: "world_series",
    roundIndex: 4,
    seriesNumber: 11,
    conference: "finals",
    homeSeed: 0,
    awaySeed: 0,
    // "… Champion" is a placeholder by `isOfficialTeamName`'s reckoning, which
    // is what keeps the World Series unpickable until both LCS are called.
    homeTeamName: "AL Champion",
    awayTeamName: "NL Champion",
    winnerTeamName: null,
    bestOf: 7,
    status: "scheduled",
    startsAt: null,
    nextSeriesNumber: null,
    nextSeriesSlot: null,
    sourceSeriesHome: 9,
    sourceSeriesAway: 10,
  })

  return [...wildCard, ...divisionSeries, ...championshipSeries, worldSeries]
}

export function buildPlayoffTemplate(input: BuildPlayoffTemplateInput): PlayoffTemplateSeries[] {
  const isTestMode = Boolean(input.isTestMode)

  if (input.sport === "mlb") return buildMlbTemplate(isTestMode)

  return [
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 1,
      conference: "east",
      homeSeed: 1,
      awaySeed: 8,
      homeTeamName: resolveSeedName(input.sport, "east", 1, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "east", 8, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 9,
      nextSeriesSlot: "home",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 2,
      conference: "east",
      homeSeed: 4,
      awaySeed: 5,
      homeTeamName: resolveSeedName(input.sport, "east", 4, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "east", 5, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 9,
      nextSeriesSlot: "away",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 3,
      conference: "east",
      homeSeed: 2,
      awaySeed: 7,
      homeTeamName: resolveSeedName(input.sport, "east", 2, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "east", 7, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 10,
      nextSeriesSlot: "home",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 4,
      conference: "east",
      homeSeed: 3,
      awaySeed: 6,
      homeTeamName: resolveSeedName(input.sport, "east", 3, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "east", 6, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 10,
      nextSeriesSlot: "away",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 5,
      conference: "west",
      homeSeed: 1,
      awaySeed: 8,
      homeTeamName: resolveSeedName(input.sport, "west", 1, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "west", 8, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 11,
      nextSeriesSlot: "home",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 6,
      conference: "west",
      homeSeed: 4,
      awaySeed: 5,
      homeTeamName: resolveSeedName(input.sport, "west", 4, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "west", 5, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 11,
      nextSeriesSlot: "away",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 7,
      conference: "west",
      homeSeed: 2,
      awaySeed: 7,
      homeTeamName: resolveSeedName(input.sport, "west", 2, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "west", 7, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 12,
      nextSeriesSlot: "home",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "round_1",
      roundIndex: 1,
      seriesNumber: 8,
      conference: "west",
      homeSeed: 3,
      awaySeed: 6,
      homeTeamName: resolveSeedName(input.sport, "west", 3, isTestMode),
      awayTeamName: resolveSeedName(input.sport, "west", 6, isTestMode),
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 12,
      nextSeriesSlot: "away",
      sourceSeriesHome: null,
      sourceSeriesAway: null,
    }),
    createSeries({
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 9,
      conference: "east",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S1",
      awayTeamName: "Winner S2",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 13,
      nextSeriesSlot: "home",
      sourceSeriesHome: 1,
      sourceSeriesAway: 2,
    }),
    createSeries({
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 10,
      conference: "east",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S3",
      awayTeamName: "Winner S4",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 13,
      nextSeriesSlot: "away",
      sourceSeriesHome: 3,
      sourceSeriesAway: 4,
    }),
    createSeries({
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 11,
      conference: "west",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S5",
      awayTeamName: "Winner S6",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 14,
      nextSeriesSlot: "home",
      sourceSeriesHome: 5,
      sourceSeriesAway: 6,
    }),
    createSeries({
      round: "conference_semifinals",
      roundIndex: 2,
      seriesNumber: 12,
      conference: "west",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "Winner S7",
      awayTeamName: "Winner S8",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 14,
      nextSeriesSlot: "away",
      sourceSeriesHome: 7,
      sourceSeriesAway: 8,
    }),
    createSeries({
      round: "conference_finals",
      roundIndex: 3,
      seriesNumber: 13,
      conference: "east",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "East Winner A",
      awayTeamName: "East Winner B",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 15,
      nextSeriesSlot: "home",
      sourceSeriesHome: 9,
      sourceSeriesAway: 10,
    }),
    createSeries({
      round: "conference_finals",
      roundIndex: 3,
      seriesNumber: 14,
      conference: "west",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "West Winner A",
      awayTeamName: "West Winner B",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: 15,
      nextSeriesSlot: "away",
      sourceSeriesHome: 11,
      sourceSeriesAway: 12,
    }),
    createSeries({
      round: "finals",
      roundIndex: 4,
      seriesNumber: 15,
      conference: "finals",
      homeSeed: 0,
      awaySeed: 0,
      homeTeamName: "East Champion",
      awayTeamName: "West Champion",
      winnerTeamName: null,
      bestOf: 7,
      status: "scheduled",
      startsAt: null,
      nextSeriesNumber: null,
      nextSeriesSlot: null,
      sourceSeriesHome: 13,
      sourceSeriesAway: 14,
    }),
  ]
}
