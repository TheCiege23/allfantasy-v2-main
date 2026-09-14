/**
 * The ESPN scoreboard fields that make a game card look like a game — leaders,
 * down and distance, where the ball is, the last play, the venue, the line score.
 *
 * ⚠ ALL OF THIS WAS ALREADY IN THE PAYLOAD WE FETCH ON EVERY POLL. The mapper in
 * `sports-live-scores-service.ts` kept one leader and the venue name and dropped
 * the rest, which is why `/core/live` carried a note saying a field diagram was
 * impossible "because the data layer has no yard line". The feed had one; we
 * discarded it. Shape read from the live NFL scoreboard on 2026-09-13 during
 * TB @ CIN (`situation.possessionText: "CIN 12"`, `yardLine: 12`,
 * `leaders[].shortDisplayName: "PASS"`, `venue.address.city: "Cincinnati"`).
 *
 * Pure and dependency-free so it can be tested without the service's prisma
 * import. Every field is optional on the way in: ESPN omits `situation` before
 * kickoff and at halftime, and non-football sports carry different leaders.
 */

export type EspnLeaderCategory = {
  name?: string
  displayName?: string
  shortDisplayName?: string
  leaders?: Array<{
    displayValue?: string
    value?: number
    team?: { id?: string }
    athlete?: {
      displayName?: string
      shortName?: string
      headshot?: string | { href?: string }
      position?: string | { abbreviation?: string }
      team?: { id?: string }
    }
  }>
}

type EspnSituationAthlete = {
  athlete?: {
    displayName?: string
    shortName?: string
    headshot?: string | { href?: string }
    position?: string | { abbreviation?: string }
    team?: { id?: string }
  }
  /** Today's line, e.g. "0-1, 2 R, 2 BB, K" or "1.2 IP, 0 ER, H, K, BB". */
  summary?: string
}

export type EspnSituation = {
  /* Baseball — read from the live MLB scoreboard 2026-09-13, COL @ DET "Bot 7th". */
  balls?: number
  strikes?: number
  outs?: number
  onFirst?: boolean
  onSecond?: boolean
  onThird?: boolean
  batter?: EspnSituationAthlete
  pitcher?: EspnSituationAthlete
  down?: number
  distance?: number
  yardLine?: number
  downDistanceText?: string
  shortDownDistanceText?: string
  possessionText?: string
  possession?: string
  isRedZone?: boolean
  homeTimeouts?: number
  awayTimeouts?: number
  lastPlay?: {
    text?: string
    type?: { text?: string; abbreviation?: string }
    team?: { id?: string }
  }
}

/** One category leader, as the card renders it. */
export type GameLeader = {
  /** ESPN's own short label — "PASS", "RUSH", "REC", "PTS". */
  label: string | null
  name: string
  /** "L. Ball" — ESPN's own short form, for layouts too narrow for the full name. */
  shortName: string | null
  /** ESPN's displayValue verbatim, e.g. "9/12, 73 YDS". Never recomposed. */
  statLine: string
  position: string | null
  headshot: string | null
  category: string | null
  teamId: string | null
}

export type BaseballPlayer = {
  name: string
  headshot: string | null
  position: string | null
  /** ESPN's line for today, verbatim. */
  summary: string | null
  teamId: string | null
}

/** Runners, count and the at-bat. Null for any sport whose situation carries none of it. */
export type BaseballSituation = {
  onFirst: boolean
  onSecond: boolean
  onThird: boolean
  balls: number | null
  strikes: number | null
  outs: number | null
  batter: BaseballPlayer | null
  pitcher: BaseballPlayer | null
}

export type GameSituation = {
  baseball: BaseballSituation | null
  /** "1st & 5 at CIN 12". */
  downDistanceText: string | null
  shortDownDistanceText: string | null
  distance: number | null
  possessionTeamId: string | null
  /**
   * Ball position on a 0–100 axis measured from the AWAY team's goal line, or
   * null when it cannot be placed. See `ballOnFromAwayGoal` for why this is
   * derived from `possessionText` rather than read from `yardLine`.
   */
  ballOnFromAway: number | null
  isRedZone: boolean
  homeTimeouts: number | null
  awayTimeouts: number | null
  lastPlayText: string | null
  lastPlayType: string | null
}

const FOOTBALL_LEADER_ORDER = ['passingYards', 'rushingYards', 'receivingYards']

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Up to three leaders, one per category.
 *
 * Football is ordered PASS, RUSH, REC — the order ESPN's own game strip uses.
 * Every other sport keeps the feed's order, because we have no measured ordering
 * for them and inventing one would be a guess dressed as a layout decision.
 *
 * ⚠ BOTH A NAME AND A STAT LINE ARE REQUIRED. Before kickoff ESPN can send a
 * category with no athlete; a name beside an empty line reads as a data bug.
 */
export function pickGameLeaders(categories: EspnLeaderCategory[] | undefined, max = 3): GameLeader[] {
  if (!Array.isArray(categories)) return []
  const ordered = [...categories].sort((a, b) => {
    const ai = FOOTBALL_LEADER_ORDER.indexOf(String(a?.name ?? ''))
    const bi = FOOTBALL_LEADER_ORDER.indexOf(String(b?.name ?? ''))
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  const out: GameLeader[] = []
  for (const category of ordered) {
    if (out.length >= max) break
    const leader = category?.leaders?.[0]
    const athlete = leader?.athlete
    const name = text(athlete?.displayName) ?? text(athlete?.shortName)
    const statLine = text(leader?.displayValue)
    if (!name || !statLine) continue
    const headshot =
      typeof athlete?.headshot === 'string' ? athlete.headshot : text(athlete?.headshot?.href)
    const position =
      typeof athlete?.position === 'string' ? athlete.position : text(athlete?.position?.abbreviation)
    out.push({
      label: text(category.shortDisplayName) ?? text(category.displayName),
      name,
      shortName: text(athlete?.shortName),
      statLine,
      position: text(position),
      headshot: text(headshot),
      category: text(category.name),
      teamId: text(leader?.team?.id) ?? text(athlete?.team?.id),
    })
  }
  return out
}

/**
 * Basketball's in-game leader categories, in the order ESPN's own game strip uses.
 *
 * ⚠ AN ALLOWLIST, BECAUSE BEFORE TIP-OFF THE SAME ARRAY CARRIES SEASON NUMBERS.
 * Measured 2026-09-13: a scheduled WNBA game's competitors sent `pointsPerGame`,
 * `reboundsPerGame` and `assistsPerGame` ("19.3") in the very `leaders` field that
 * carries `points` ("27") once the game is on. The fourth in-game category,
 * `rating` ("27 PTS, 8 AST"), is ESPN's composite and repeats the other three.
 * Across 90 finished NBA and college basketball team-games the in-game set was
 * always exactly points, rebounds, assists, rating.
 */
const TEAM_LEADER_CATEGORIES = ['points', 'rebounds', 'assists']

/** One team's PTS / REB / AST leaders, from that competitor's own `leaders`. */
export function pickTeamLeaders(categories: EspnLeaderCategory[] | undefined): GameLeader[] {
  if (!Array.isArray(categories)) return []
  const inGame = TEAM_LEADER_CATEGORIES.map((name) => categories.find((c) => c?.name === name)).filter(
    (c): c is EspnLeaderCategory => c != null,
  )
  return pickGameLeaders(inGame, TEAM_LEADER_CATEGORIES.length)
}

export type EspnTeamStatistic = { name?: string; abbreviation?: string; displayValue?: string }

/** Made, attempted, and ESPN's own percentage text ("38.6"), never recomputed. */
export type ShootingLine = { made: number; attempted: number; pct: string | null }

export type TeamShooting = {
  fieldGoals: ShootingLine | null
  threePointers: ShootingLine | null
  freeThrows: ShootingLine | null
}

function count(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v.trim())) return null
  return Number(v.trim())
}

/**
 * A basketball team's shooting, from its competitor `statistics`.
 *
 * Only `displayValue` is sent — there is no numeric `value` on these entries.
 * `threePointFieldGoalPct` is the name read because college basketball sends only
 * that one; the NBA sends it and a duplicate `threePointPct`.
 *
 * Checked against the score rather than trusted: on 90 of 90 finished NBA and
 * college team-games, 2×FGM + 3PM + FTM equalled the team's points exactly.
 *
 * ⚠ BEFORE TIP-OFF THESE ARE SEASON TOTALS (1,254 field goals made on a scheduled
 * WNBA game), so the caller must only ask once the game has started.
 */
export function teamShooting(statistics: EspnTeamStatistic[] | undefined): TeamShooting | null {
  if (!Array.isArray(statistics)) return null
  const byName = new Map(statistics.map((s) => [String(s?.name ?? ''), s]))
  const line = (made: string, attempted: string, pct: string): ShootingLine | null => {
    const m = count(byName.get(made)?.displayValue)
    const a = count(byName.get(attempted)?.displayValue)
    if (m == null || a == null || m > a) return null
    return { made: m, attempted: a, pct: text(byName.get(pct)?.displayValue) }
  }
  const out: TeamShooting = {
    fieldGoals: line('fieldGoalsMade', 'fieldGoalsAttempted', 'fieldGoalPct'),
    threePointers: line('threePointFieldGoalsMade', 'threePointFieldGoalsAttempted', 'threePointFieldGoalPct'),
    freeThrows: line('freeThrowsMade', 'freeThrowsAttempted', 'freeThrowPct'),
  }
  return out.fieldGoals || out.threePointers || out.freeThrows ? out : null
}

/** The basketball sports Live Scores shows: the pros in quarters, college in halves. */
export const BASKETBALL_SPORTS: readonly string[] = ['NBA', 'WNBA', 'NCAAB']

export function isBasketballSport(sport: string | null | undefined): boolean {
  return typeof sport === 'string' && BASKETBALL_SPORTS.includes(sport)
}

/**
 * "Q3", "OT", "2OT" for the NBA and the WNBA; "1H", "2H", "OT", "2OT" for college
 * basketball, which plays halves. Null for every other sport, and for a period it
 * cannot name.
 *
 * Multiple overtimes read "2OT" because that is how ESPN's own final status spells
 * them ("Final/2OT", DEN @ NY 2026-02-04, six periods in the line score).
 */
export function basketballPeriodLabel(sport: string, period: number): string | null {
  if (!Number.isInteger(period) || period < 1) return null
  const regulation = sport === 'NBA' || sport === 'WNBA' ? 4 : sport === 'NCAAB' ? 2 : null
  if (regulation == null) return null
  if (period <= regulation) return regulation === 4 ? `Q${period}` : `${period}H`
  const overtime = period - regulation
  return overtime === 1 ? 'OT' : `${overtime}OT`
}

/**
 * Where the ball is, from the away goal line.
 *
 * ⚠ `yardLine` IS NOT AN ABSOLUTE POSITION. On TB @ CIN it read `12` with the
 * ball on the CINCINNATI 12 — the same number would be printed for the Tampa Bay
 * 12, eighty yards away. It is the yard marker, not the field coordinate, and
 * plotting it directly puts every drive on the wrong half half the time.
 * `possessionText` ("CIN 12") names the side, so the side decides the axis.
 *
 * Returns null — no diagram — for anything it cannot place: an unrecognised
 * team prefix, a number outside 0–50, or a bare number other than midfield.
 */
export function ballOnFromAwayGoal(
  possessionText: string | null | undefined,
  homeAbbrev: string,
  awayAbbrev: string,
): number | null {
  const match = /^\s*(?:([A-Za-z]{1,5})\s+)?(\d{1,2})\s*$/.exec(String(possessionText ?? ''))
  if (!match) return null
  const yard = Number(match[2])
  if (!Number.isFinite(yard) || yard < 0 || yard > 50) return null
  const side = match[1]?.toUpperCase()
  if (!side) return yard === 50 ? 50 : null
  if (side === awayAbbrev.trim().toUpperCase()) return yard
  if (side === homeAbbrev.trim().toUpperCase()) return 100 - yard
  return null
}

export function mapGameSituation(
  situation: EspnSituation | undefined | null,
  homeAbbrev: string,
  awayAbbrev: string,
): GameSituation | null {
  if (!situation || typeof situation !== 'object') return null
  const mapped: GameSituation = {
    downDistanceText: text(situation.downDistanceText),
    shortDownDistanceText: text(situation.shortDownDistanceText),
    distance: finite(situation.distance),
    possessionTeamId: text(situation.possession),
    ballOnFromAway: ballOnFromAwayGoal(situation.possessionText, homeAbbrev, awayAbbrev),
    isRedZone: situation.isRedZone === true,
    homeTimeouts: finite(situation.homeTimeouts),
    awayTimeouts: finite(situation.awayTimeouts),
    lastPlayText: text(situation.lastPlay?.text),
    lastPlayType: text(situation.lastPlay?.type?.text),
    baseball: mapBaseballSituation(situation),
  }
  const hasAnything =
    mapped.downDistanceText != null ||
    mapped.ballOnFromAway != null ||
    mapped.lastPlayText != null ||
    mapped.baseball != null
  return hasAnything ? mapped : null
}

function mapBaseballPlayer(p: EspnSituationAthlete | undefined): BaseballPlayer | null {
  const a = p?.athlete
  const name = text(a?.displayName) ?? text(a?.shortName)
  if (!name) return null
  const headshot = typeof a?.headshot === 'string' ? a.headshot : text(a?.headshot?.href)
  const position = typeof a?.position === 'string' ? a.position : text(a?.position?.abbreviation)
  return {
    name,
    headshot: text(headshot),
    position: text(position),
    summary: text(p?.summary),
    teamId: text(a?.team?.id),
  }
}

/**
 * ⚠ ONLY WHEN THE FEED ACTUALLY SENT BASEBALL FIELDS. Football's situation has
 * no `onFirst`, and reading a missing boolean as `false` would draw an empty
 * diamond on an NFL card. The bases are booleans only once ESPN typed them so;
 * the count is null — not 0 — when absent, because "0-0, no outs" is a real count.
 */
export function mapBaseballSituation(situation: EspnSituation | undefined | null): BaseballSituation | null {
  if (!situation) return null
  const hasBases =
    typeof situation.onFirst === 'boolean' ||
    typeof situation.onSecond === 'boolean' ||
    typeof situation.onThird === 'boolean'
  const balls = finite(situation.balls)
  const strikes = finite(situation.strikes)
  const outs = finite(situation.outs)
  const batter = mapBaseballPlayer(situation.batter)
  const pitcher = mapBaseballPlayer(situation.pitcher)
  if (!hasBases && balls == null && strikes == null && outs == null && !batter && !pitcher) return null
  return {
    onFirst: situation.onFirst === true,
    onSecond: situation.onSecond === true,
    onThird: situation.onThird === true,
    balls,
    strikes,
    outs,
    batter,
    pitcher,
  }
}

/** "Cincinnati, OH" — or the country when there is no state, or null. */
export function formatVenueLocation(
  address: { city?: string; state?: string; country?: string } | undefined | null,
): string | null {
  const city = text(address?.city)
  const region = text(address?.state) ?? text(address?.country)
  if (city && region) return `${city}, ${region}`
  return city ?? region ?? null
}

const THREE_HOURS_MS = 3 * 60 * 60 * 1000
const ESPN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The ESPN `dates=YYYYMMDD` values covering a time window, as US EASTERN days.
 *
 * ⚠ WHY COLLEGE FOOTBALL NEEDS THIS AND THE PROS DO NOT. Measured 2026-09-13 on
 * ESPN's college-football scoreboard: the UNDATED call returns 24 featured
 * games spread across the week (Thu–Sat), with or without `limit=300`, while
 * the DATED call returns the whole FBS day — 80 games for 2026-09-12, 71 for
 * 2026-09-19. The live refresh used the undated call, so on a college Saturday
 * roughly two games in three arrived without `situation` and drew no field.
 *
 * ⚠ EASTERN, NOT UTC. ESPN keys the scoreboard on the US date, like Rolling
 * Insights' `/live/{date}` (see contracts/rolling-insights/GAPS.md): a 10pm ET
 * kickoff is 02:00Z the NEXT day, and a UTC date would ask for the wrong slate
 * through every late window.
 *
 * Steps in three-hour hops so no calendar day inside the window is skipped;
 * returns days in order, without duplicates.
 */
export function espnScoreboardDatesForWindow(fromMs: number, toMs: number): string[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return []
  const out: string[] = []
  const push = (ms: number) => {
    const day = ESPN_DATE_FORMAT.format(new Date(ms)).replace(/-/g, '')
    if (!out.includes(day)) out.push(day)
  }
  for (let t = fromMs; t < toMs; t += THREE_HOURS_MS) push(t)
  push(toMs)
  return out
}

/** Per-period points, in period order. Anything non-numeric ends the list. */
export function linescoreValues(
  linescores: Array<{ value?: number; displayValue?: string }> | undefined | null,
): number[] {
  if (!Array.isArray(linescores)) return []
  const out: number[] = []
  for (const l of linescores) {
    const n = finite(l?.value) ?? (l?.displayValue != null ? Number(l.displayValue) : NaN)
    if (!Number.isFinite(n)) break
    out.push(n)
  }
  return out
}
