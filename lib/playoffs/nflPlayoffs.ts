import type { PlayoffSeriesView, PlayoffTemplateSeries } from "./types"

/**
 * NFL playoffs: fourteen teams, seven a conference, the 1 seed on a bye.
 *
 *   S1-S3   AFC Wild Card     2v7, 3v6, 4v5       S4-S6   NFC Wild Card
 *   S7-S8   AFC Divisional    reseeded            S9-S10  NFC Divisional
 *   S11     AFC Championship  S7 v S8             S12     NFC Championship
 *   S13     Super Bowl        S11 v S12 (conference "finals")
 *
 * 🛑 THE DIVISIONAL ROUND RESEEDS, SO IT HAS NO FIXED FEEDERS. The 1 seed plays
 * the LOWEST seed left after the Wild Card round; the other two winners play
 * each other, the better seed at home. Which game a Wild Card winner reaches
 * therefore depends on all three Wild Card results in its conference, and a
 * two-slot `sourceSeriesHome` / `sourceSeriesAway` edge cannot express it.
 * The divisional rows carry no sources; `nflDivisionalMatchups` computes them,
 * and `nflImpliedSources` tells the pick cascade that changing ANY Wild Card
 * pick reshapes BOTH divisional games of that conference.
 *
 * Pure and client-safe: no provider call and no database here. The ESPN read
 * lives in `syncNflPlayoffs.ts`.
 */

export type NflConference = "afc" | "nfc"
export const NFL_ROUNDS = ["nfl_wild_card", "nfl_divisional", "nfl_conference", "nfl_super_bowl"] as const

/** Placeholder names for divisional slots the reseeding has not resolved. Never "official". */
export const nflLowestSeedLeft = (conf: NflConference) => `${conf.toUpperCase()} Lowest Seed Left`
export const nflWildCardWinner = (conf: NflConference) => `${conf.toUpperCase()} Wild Card Winner`
export const NFL_PLACEHOLDER = /^(?:AFC|NFC) (?:Lowest Seed Left|Wild Card Winner)$/i

/** The unseeded slot name, `AFC2` … `NFC7`, which seeding later replaces with a club. */
export const nflSeedSlot = (conf: NflConference, seed: number) => `${conf.toUpperCase()}${seed}`

const TEST_TEAMS: Record<NflConference, string[]> = {
  afc: ["Denver Broncos", "New England Patriots", "Jacksonville Jaguars", "Pittsburgh Steelers", "Houston Texans", "Buffalo Bills", "Los Angeles Chargers"],
  nfc: ["Seattle Seahawks", "Chicago Bears", "Philadelphia Eagles", "Carolina Panthers", "Los Angeles Rams", "San Francisco 49ers", "Green Bay Packers"],
}

const WILD_CARD_PAIRS = [[2, 7], [3, 6], [4, 5]] as const

function row(data: PlayoffTemplateSeries): PlayoffTemplateSeries {
  return data
}

export function buildNflTemplate(isTestMode: boolean): PlayoffTemplateSeries[] {
  const seed = (conf: NflConference, n: number) => isTestMode ? TEST_TEAMS[conf][n - 1] : nflSeedSlot(conf, n)
  const base = { winnerTeamName: null, bestOf: 1, status: "scheduled" as const, startsAt: null }
  const out: PlayoffTemplateSeries[] = []
  ;(["afc", "nfc"] as const).forEach((conf, c) => {
    WILD_CARD_PAIRS.forEach(([home, away], i) => {
      out.push(row({
        ...base, round: "nfl_wild_card", roundIndex: 1, seriesNumber: c * 3 + i + 1, conference: conf,
        homeSeed: home, awaySeed: away, homeTeamName: seed(conf, home), awayTeamName: seed(conf, away),
        // Reseeded: no fixed next game. See the header.
        nextSeriesNumber: null, nextSeriesSlot: null, sourceSeriesHome: null, sourceSeriesAway: null,
      }))
    })
  })
  ;(["afc", "nfc"] as const).forEach((conf, c) => {
    const first = 7 + c * 2
    out.push(row({
      ...base, round: "nfl_divisional", roundIndex: 2, seriesNumber: first, conference: conf,
      homeSeed: 1, awaySeed: 0, homeTeamName: seed(conf, 1), awayTeamName: nflLowestSeedLeft(conf),
      nextSeriesNumber: 11 + c, nextSeriesSlot: "home", sourceSeriesHome: null, sourceSeriesAway: null,
    }))
    out.push(row({
      ...base, round: "nfl_divisional", roundIndex: 2, seriesNumber: first + 1, conference: conf,
      homeSeed: 0, awaySeed: 0, homeTeamName: nflWildCardWinner(conf), awayTeamName: nflWildCardWinner(conf),
      nextSeriesNumber: 11 + c, nextSeriesSlot: "away", sourceSeriesHome: null, sourceSeriesAway: null,
    }))
  })
  ;(["afc", "nfc"] as const).forEach((conf, c) => {
    out.push(row({
      ...base, round: "nfl_conference", roundIndex: 3, seriesNumber: 11 + c, conference: conf,
      homeSeed: 0, awaySeed: 0, homeTeamName: `Winner S${7 + c * 2}`, awayTeamName: `Winner S${8 + c * 2}`,
      nextSeriesNumber: 13, nextSeriesSlot: c === 0 ? "home" : "away", sourceSeriesHome: 7 + c * 2, sourceSeriesAway: 8 + c * 2,
    }))
  })
  out.push(row({
    ...base, round: "nfl_super_bowl", roundIndex: 4, seriesNumber: 13, conference: "finals",
    homeSeed: 0, awaySeed: 0, homeTeamName: "Winner S11", awayTeamName: "Winner S12",
    nextSeriesNumber: null, nextSeriesSlot: null, sourceSeriesHome: 11, sourceSeriesAway: 12,
  }))
  return out
}

type SeriesLike = Pick<PlayoffSeriesView, "id" | "round" | "conference" | "seriesNumber" | "homeSeed" | "awaySeed" | "homeTeamName" | "awayTeamName">

export type NflDivisionalMatchup = { homeTeamName: string; awayTeamName: string; homeSeed: number; awaySeed: number }

/**
 * The two divisional games of each conference, given who won each Wild Card
 * game (a user's picks, or official results). A game is only filled in when
 * all three Wild Card winners of its conference are known, because until then
 * "the lowest seed left" is not decided; until then its slots keep their
 * placeholder names, which are not pickable.
 *
 * `winnerBySeriesNumber` maps a Wild Card series number to the winning team's
 * name. A name that is neither side of that game is ignored.
 */
export function nflDivisionalMatchups(
  series: SeriesLike[],
  winnerBySeriesNumber: Map<number, string>,
): Map<number, NflDivisionalMatchup> {
  const out = new Map<number, NflDivisionalMatchup>()
  for (const conf of ["afc", "nfc"] as const) {
    const wildCard = series.filter((s) => s.round === "nfl_wild_card" && s.conference === conf)
    const divisional = series.filter((s) => s.round === "nfl_divisional" && s.conference === conf)
      .sort((a, b) => a.seriesNumber - b.seriesNumber)
    if (wildCard.length !== 3 || divisional.length !== 2) continue
    const winners: Array<{ name: string; seed: number }> = []
    for (const game of wildCard) {
      const name = winnerBySeriesNumber.get(game.seriesNumber)
      if (name && name === game.homeTeamName) winners.push({ name, seed: game.homeSeed })
      else if (name && name === game.awayTeamName) winners.push({ name, seed: game.awaySeed })
    }
    if (winners.length !== 3 || winners.some((w) => !(w.seed > 0))) continue
    winners.sort((a, b) => a.seed - b.seed)
    const [best, middle, lowest] = winners
    const [gameA, gameB] = divisional
    out.set(gameA.seriesNumber, { homeTeamName: gameA.homeTeamName, homeSeed: 1, awayTeamName: lowest.name, awaySeed: lowest.seed })
    out.set(gameB.seriesNumber, { homeTeamName: best.name, homeSeed: best.seed, awayTeamName: middle.name, awaySeed: middle.seed })
  }
  return out
}

/**
 * The series a divisional game implicitly depends on: every Wild Card game of
 * its conference. Used by the pick cascade so a changed Wild Card pick clears
 * the divisional (and later) picks it can reshape.
 */
export function nflImpliedSources(item: Pick<SeriesLike, "round" | "conference">, series: SeriesLike[]): number[] {
  if (item.round !== "nfl_divisional") return []
  return series.filter((s) => s.round === "nfl_wild_card" && s.conference === item.conference).map((s) => s.seriesNumber)
}

/** The rows whose kickoff locks an NFL bracket: the Wild Card round, the only times known in advance. */
export function nflLockRows<T extends { round?: string | null }>(series: T[]): T[] {
  return series.some((s) => s.round === "nfl_wild_card") ? series.filter((s) => s.round === "nfl_wild_card") : series
}

// ── ESPN postseason scoreboard ───────────────────────────────────────────────

export type NflRound = (typeof NFL_ROUNDS)[number]

export type NflPlayoffGame = {
  eventId: string
  round: NflRound
  conference: NflConference | "finals"
  label: string
  startsAt: string | null
  homeTeamName: string
  awayTeamName: string
  status: "scheduled" | "in_progress" | "final"
  homeScore: number | null
  awayScore: number | null
  winnerTeamName: string | null
  venue: string | null
  location: string | null
  statusDetail: string | null
}

/**
 * Read NFL playoff games from an ESPN scoreboard payload.
 *
 * Shape from contracts/espn/fixtures/scoreboard.NFL.2026*.json: the round is
 * ONLY in `competitions[0].notes[]` (headline "AFC Wild Card Playoffs",
 * "NFC Divisional Playoffs", "AFC Championship", "Super Bowl LX"), the season
 * is the START year with type 3, and no seed is present anywhere. Any event
 * without one of those headlines, or from another season, is not a playoff
 * game for this bracket.
 */
export function parseNflPlayoffScoreboard(payload: unknown, season: number): NflPlayoffGame[] {
  const events = (payload as { events?: unknown[] })?.events
  if (!Array.isArray(events)) throw new Error("NFL scoreboard events missing")
  const out: NflPlayoffGame[] = []
  for (const raw of events) {
    const event = raw as any
    if (Number(event?.season?.year) !== season || Number(event?.season?.type) !== 3) continue
    if (!/^\d+$/.test(String(event?.id ?? ""))) continue
    const competition = event?.competitions?.[0]
    const headline = String(competition?.notes?.find((n: any) => n?.type === "event")?.headline ?? "")
    const conf = /^(AFC|NFC)\b/i.exec(headline)?.[1]?.toLowerCase() as NflConference | undefined
    const round: NflRound | null = /^Super Bowl\b/i.test(headline) ? "nfl_super_bowl"
      : conf && /Wild Card/i.test(headline) ? "nfl_wild_card"
      : conf && /Divisional/i.test(headline) ? "nfl_divisional"
      : conf && /Championship/i.test(headline) ? "nfl_conference" : null
    if (!round) continue
    const competitors = competition?.competitors
    if (!Array.isArray(competitors) || competitors.length !== 2) continue
    const home = competitors.find((t: any) => t?.homeAway === "home")
    const away = competitors.find((t: any) => t?.homeAway === "away")
    const h = home?.team?.displayName, a = away?.team?.displayName
    if (typeof h !== "string" || typeof a !== "string" || !h || !a || h === a) continue
    const type = event?.status?.type
    const ok = ["STATUS_SCHEDULED", "STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_FINAL", "STATUS_FINAL_OVERTIME"].includes(type?.name)
    const status = type?.completed === true && /^STATUS_FINAL/.test(type?.name ?? "") ? "final" : type?.state === "in" ? "in_progress" : "scheduled"
    const score = (v: unknown) => typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null
    const hs = status === "scheduled" ? null : score(home.score)
    const as = status === "scheduled" ? null : score(away.score)
    const ts = Date.parse(event?.date ?? "")
    const venue = competition?.venue
    out.push({
      eventId: String(event.id), round, conference: round === "nfl_super_bowl" ? "finals" : conf!, label: headline,
      startsAt: ok && Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      homeTeamName: h, awayTeamName: a, status,
      homeScore: hs, awayScore: as,
      winnerTeamName: ok && status === "final" && hs != null && as != null && hs !== as ? (hs > as ? h : a) : null,
      venue: venue?.fullName ?? null,
      location: [venue?.address?.city, venue?.address?.state].filter(Boolean).join(", ") || null,
      statusDetail: typeof type?.shortDetail === "string" ? type.shortDetail.slice(0, 40) : null,
    })
  }
  return out
}

/**
 * Put each ESPN game in its bracket slot, using the seeded field.
 *
 * 🛑 A GAME IS ONLY PLACED WHEN ITS TEAMS ARE THE TEAMS THE FIELD PUTS THERE.
 * ESPN carries no seeds (contracts/espn/GAPS.md P-01), so seeds come from
 * standings — and a standings feed that disagrees with the real bracket must
 * stop publishing, not publish into the wrong slot:
 *  - Wild Card: the two teams must be exactly a seeded 2v7, 3v6 or 4v5 pair.
 *  - Divisional: the game with the 1 seed is the first divisional slot; the
 *    other is the second. Both teams must be in the conference's field.
 *  - Conference and Super Bowl: one game each, so the slot is the round.
 * Anything that does not fit is returned in `rejected`, never guessed.
 */
export function assignNflSlots(
  games: NflPlayoffGame[],
  seeds: Map<string, Map<number, string>>,
): { placed: Array<NflPlayoffGame & { seriesNumber: number }>; rejected: Array<{ game: NflPlayoffGame; reason: string }> } {
  const placed: Array<NflPlayoffGame & { seriesNumber: number }> = []
  const rejected: Array<{ game: NflPlayoffGame; reason: string }> = []
  const seedOf = (conf: string, name: string) => {
    for (const [n, team] of seeds.get(conf) ?? new Map<number, string>()) if (team === name) return n
    return null
  }
  for (const game of games) {
    const c = game.conference === "nfc" ? 1 : 0
    if (game.round === "nfl_super_bowl") { placed.push({ ...game, seriesNumber: 13 }); continue }
    if (game.round === "nfl_conference") { placed.push({ ...game, seriesNumber: 11 + c }); continue }
    const hs = seedOf(game.conference, game.homeTeamName), as = seedOf(game.conference, game.awayTeamName)
    if (hs == null || as == null) { rejected.push({ game, reason: "team not in the seeded field" }); continue }
    if (game.round === "nfl_wild_card") {
      const pair = WILD_CARD_PAIRS.findIndex(([x, y]) => (hs === x && as === y) || (hs === y && as === x))
      if (pair < 0) { rejected.push({ game, reason: `seeds ${hs} v ${as} are not a Wild Card pairing` }); continue }
      placed.push({ ...game, seriesNumber: c * 3 + pair + 1 })
      continue
    }
    if (hs === 1 || as === 1) placed.push({ ...game, seriesNumber: 7 + c * 2 })
    else placed.push({ ...game, seriesNumber: 8 + c * 2 })
  }
  return { placed, rejected }
}

/**
 * Orient an ESPN game onto its slot's home/away. The template puts the better
 * seed at home; ESPN agrees in every round but the Super Bowl (neutral site),
 * whose sides are AFC/NFC in the template. Scores follow their team.
 */
export function orientToSlot(
  game: NflPlayoffGame,
  slotHome: string | null,
): { homeTeamName: string; awayTeamName: string; homeScore: number | null; awayScore: number | null } {
  const flip = slotHome != null && slotHome === game.awayTeamName
  return flip
    ? { homeTeamName: game.awayTeamName, awayTeamName: game.homeTeamName, homeScore: game.awayScore, awayScore: game.homeScore }
    : { homeTeamName: game.homeTeamName, awayTeamName: game.awayTeamName, homeScore: game.homeScore, awayScore: game.awayScore }
}
