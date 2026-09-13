import { ballOnFromAwayGoal } from '@/lib/live/espnGamePresentation'

/**
 * The clicked-game view ("gamecast"), trimmed out of ESPN's per-game summary.
 *
 * ⚠ THE RAW PAYLOAD IS ~535 KB AND THIS KEEPS A SMALL FRACTION OF IT. Measured
 * 2026-09-13 on NFL TB @ CIN (401872925, live) and NCAAF OSU @ TEX (401856682,
 * final): both carry `header`, `drives.{current,previous}`, per-team `leaders`
 * (passing, rushing, receiving, sacks, tackles), `boxscore.{teams,players}`,
 * `scoringPlays`, `winprobability` and `gameInfo`. News, odds, videos, pickcenter,
 * standings and injuries are dropped here, before anything is cached.
 *
 * Shape notes that decide the code below:
 *
 *   - A drive's `start.text` / `end.text` and a play's `possessionText` read
 *     "TB 44". Ball position is placed from that text with the same helper the
 *     score cards use, never from `yardLine` (which is relative to the offense).
 *   - `drives.current` is ABSENT on a final. The view then shows the last drive,
 *     marked as not current, rather than inventing one.
 *   - Plays name no athletes (only `teamParticipants`), so player stat lines are
 *     keyed by athlete id from `boxscore.players` and joined to the scoreboard's
 *     `lastPlay.athletesInvolved` by the loader.
 *   - `winprobability[].homeWinPercentage` is ESPN's own figure (0–1). It is a
 *     provider number, unlike the card's labelled AF estimate.
 *
 * Pure and dependency-light so it is testable without a database.
 */

export type GameDetailState = 'pre' | 'in' | 'post'

export type GameDetailTeam = {
  id: string
  /** ESPN's raw abbreviation — the vocabulary its possession text is written in. */
  abbrev: string
  name: string
  logo: string | null
  color: string | null
  altColor: string | null
  score: number | null
  record: string | null
  rank: number | null
  linescores: number[]
  possession: boolean
}

export type GameDetailLeader = {
  category: string
  label: string
  athleteId: string | null
  name: string
  shortName: string | null
  position: string | null
  headshot: string | null
  /** The big number, e.g. "205" with label "YDS". */
  mainValue: string | null
  mainLabel: string | null
  /** The line under the name, e.g. "22/32, 1 TD, 1 INT". */
  summary: string | null
}

export type GameDetailPlay = {
  id: string
  text: string
  type: string | null
  typeAbbrev: string | null
  period: number | null
  clock: string | null
  /** "3rd & 5 at TB 12" before the snap; null for kickoffs and tries. */
  downDistance: string | null
  startBallOn: number | null
  endBallOn: number | null
  statYardage: number | null
  yardsAfterCatch: number | null
  scoring: boolean
  awayScore: number | null
  homeScore: number | null
}

export type GameDetailDrive = {
  id: string
  teamId: string | null
  teamAbbrev: string | null
  teamLogo: string | null
  /** "8 plays, 31 yards, 5:12". */
  description: string | null
  result: string | null
  isScore: boolean
  isCurrent: boolean
  startBallOn: number | null
  startText: string | null
  endBallOn: number | null
  endText: string | null
  plays: GameDetailPlay[]
}

/** Down, distance and spot for the NEXT snap of the current drive. */
export type GameDetailSituation = {
  downDistance: string | null
  shortDownDistance: string | null
  possessionText: string | null
  ballOn: number | null
  distance: number | null
  /** Which side has the ball, so the field can point the drive the right way. */
  offense: 'home' | 'away' | null
}

export type GameDetailScoringPlay = {
  id: string
  period: number | null
  clock: string | null
  text: string
  type: string | null
  teamAbbrev: string | null
  teamLogo: string | null
  awayScore: number | null
  homeScore: number | null
}

export type GameDetailTeamStat = {
  key: string
  label: string
  away: string
  home: string
  /** Bar proportions, 0–1, summing to 1 (0.5/0.5 when both are zero). */
  awayShare: number
  homeShare: number
}

export type GameDetailPlayerLine = {
  group: string
  teamId: string | null
  name: string
  headshot: string | null
  jersey: string | null
  labels: string[]
  stats: string[]
}

/* ── basketball ────────────────────────────────────────────────────────────── */

/**
 * One field-goal attempt with a court spot.
 *
 * ⚠ ESPN WRITES A SENTINEL, NOT NULL, FOR PLAYS WITH NO SPOT. Measured on NBA
 * CHI @ GS (401810798): free throws carry `coordinate: { x: -214748340,
 * y: -214748365 }`. Plotted as-is they land 200 million feet off the court, so
 * only in-bounds spots are kept and free throws are dropped outright.
 */
export type BasketballShot = {
  id: string
  teamId: string | null
  athleteId: string | null
  /** Feet across the court, 0–50. */
  x: number
  /** Feet from the rim end, as ESPN reports it. */
  y: number
  made: boolean
  value: number | null
  period: number | null
  clock: string | null
  text: string
}

export type BasketballPlay = {
  id: string
  text: string
  type: string | null
  period: number | null
  clock: string | null
  teamId: string | null
  scoring: boolean
  scoreValue: number | null
  awayScore: number | null
  homeScore: number | null
  /** Unlike football, NBA plays name their athletes by id. */
  athleteIds: string[]
}

export type BasketballBoxPlayer = {
  athleteId: string
  name: string
  shortName: string | null
  headshot: string | null
  jersey: string | null
  position: string | null
  starter: boolean
  didNotPlay: boolean
  /** "LEFT ANKLE SPRAIN", "COACH'S DECISION" — ESPN's own words. */
  reason: string | null
  stats: string[]
}

export type BasketballBoxTeam = {
  teamId: string
  labels: string[]
  players: BasketballBoxPlayer[]
  totals: string[]
}

export type BasketballDetail = {
  /**
   * "halves" when the plays' periods are named halves — men's college basketball
   * ("1st Half", "2nd Half", then "OT" on NCAAB 401825532) — else "quarters".
   * Read from the data, not the sport code.
   */
  periods: 'halves' | 'quarters'
  /** Which court to draw: the NCAA men's lane and 3-point line, or the NBA's. */
  court: 'college' | 'pro'
  /** Every play, in game order. */
  plays: BasketballPlay[]
  shots: BasketballShot[]
  box: { home: BasketballBoxTeam | null; away: BasketballBoxTeam | null }
}

/* ── hockey ────────────────────────────────────────────────────────────────── */

/**
 * One shot with a rink spot, NORMALISED so every team attacks the +x net.
 *
 * ⚠ ESPN'S RINK COORDINATES ARE FULL-RINK AND TEAMS SWITCH ENDS EVERY PERIOD.
 * Measured on NHL LA @ BOS (401803363, Final/OT): x −99…99, y −42…41 centred at
 * centre ice. BOS shot at +x in P1 (mean +33), −x in P2 (−36.8), +x in P3 (+38.9);
 * LA the mirror. The overtime winner sat at x −83 — the P2 end — so overtime
 * follows the even periods. Plotting raw spots would scatter one team's shots
 * across both nets; `hockeyAttackSigns` works out each team's period-1 end and
 * every shot is mirrored to one offensive zone.
 */
export type HockeyShot = {
  id: string
  teamId: string | null
  athleteId: string | null
  /** Feet from centre ice toward the attacked net (goal line at 89). */
  x: number
  y: number
  kind: 'goal' | 'shot' | 'missed'
  period: number | null
  clock: string | null
  strength: string | null
  text: string
}

export type HockeyPlay = {
  id: string
  text: string
  type: string | null
  period: number | null
  clock: string | null
  teamId: string | null
  scoring: boolean
  /** "Even Strength", "Power Play", "Shorthanded". */
  strength: string | null
  awayScore: number | null
  homeScore: number | null
  athleteIds: string[]
}

export type HockeyPlayer = {
  athleteId: string
  name: string
  shortName: string | null
  headshot: string | null
  jersey: string | null
  position: string | null
  stats: string[]
}

export type HockeyBoxTeam = {
  teamId: string
  skaterLabels: string[]
  /** Forwards then defense. */
  skaters: Array<HockeyPlayer & { unit: 'F' | 'D' }>
  goalieLabels: string[]
  goalies: HockeyPlayer[]
}

export type HockeyDetail = {
  /** Every play in game order, stoppages dropped. */
  plays: HockeyPlay[]
  shots: HockeyShot[]
  box: { home: HockeyBoxTeam | null; away: HockeyBoxTeam | null }
}

/* ── baseball ──────────────────────────────────────────────────────────────── */

export type BaseballPitch = {
  id: string
  /** 1-based within the at-bat. */
  number: number | null
  /** ESPN's call, verbatim: "Ball", "Strike Swinging", "Foul Ball", "Single". */
  call: string | null
  kind: 'ball' | 'strike' | 'foul' | 'inplay'
  pitchType: string | null
  velocity: number | null
  /** ESPN's pitch-location chart units (not inches); the view owns the zone box. */
  x: number | null
  y: number | null
  /** The count AFTER this pitch (ESPN's `resultCount`). */
  balls: number | null
  strikes: number | null
}

export type BaseballBattedBall = {
  /** Feet from home plate: +x toward right field, +y toward centre field. See SPRAY_PLATE. */
  x: number
  y: number
  kind: 'hr' | 'hit' | 'out'
  /** ESPN's trajectory letter: G ground, L line, F fly, P pop, B bunt. */
  trajectory: string | null
  call: string | null
}

export type BaseballAtBat = {
  id: string
  inning: number | null
  half: 'top' | 'bottom' | null
  battingTeamId: string | null
  batterId: string | null
  pitcherId: string | null
  /** The at-bat's own result — the LAST play-result, e.g. "McGonigle tripled to center". */
  result: string | null
  /** "Single", "Strikeout", "Home Run" — the in-play call, else read off the final count. */
  resultType: string | null
  /** Results logged mid-at-bat, before the batter's own ("Peck stole second."). */
  events: string[]
  scoring: boolean
  awayScore: number | null
  homeScore: number | null
  outs: number | null
  pitches: BaseballPitch[]
  battedBall: BaseballBattedBall | null
  /** False while the batter is still up. */
  complete: boolean
}

export type BaseballBoxPlayer = {
  athleteId: string
  name: string
  shortName: string | null
  headshot: string | null
  /** The position played in THIS game, which is not always the roster position. */
  position: string | null
  batOrder: number | null
  starter: boolean
  /** Pitching decision, verbatim: "W, 2-2". */
  note: string | null
  stats: string[]
}

export type BaseballBoxTable = { labels: string[]; totals: string[]; players: BaseballBoxPlayer[] }

export type BaseballBoxTeam = { teamId: string; batting: BaseballBoxTable | null; pitching: BaseballBoxTable | null }

export type BaseballDetail = {
  atBats: BaseballAtBat[]
  /** The H and E of the R-H-E line score (R is the score). */
  hitsErrors: { home: { hits: number | null; errors: number | null }; away: { hits: number | null; errors: number | null } }
  /** Live only: ESPN's situation — the count, who is up, and occupied bases. */
  current: {
    balls: number | null
    strikes: number | null
    outs: number | null
    batterId: string | null
    pitcherId: string | null
    on: { first: boolean; second: boolean; third: boolean }
    runners: { first: string | null; second: string | null; third: string | null }
  } | null
  /** Pitchers of record on a final: winning, losing, save. */
  decisions: Array<{ key: string; label: string; athleteId: string | null; name: string; teamId: string | null }>
  box: { home: BaseballBoxTeam | null; away: BaseballBoxTeam | null }
}

export type LiveGameDetail = {
  gameId: string
  sport: string
  status: { state: GameDetailState; detail: string | null; period: number | null; clock: string | null }
  home: GameDetailTeam
  away: GameDetailTeam
  leaders: { home: GameDetailLeader[]; away: GameDetailLeader[] }
  /** The current drive, or on a final the last one (`isCurrent: false`). */
  drive: GameDetailDrive | null
  situation: GameDetailSituation | null
  lastPlay: GameDetailPlay | null
  /** Box-score athlete ids the last play's text names (see `athletesInPlayText`). */
  lastPlayAthleteIds: string[]
  /** Every drive, oldest first, for the All Plays list. */
  drives: GameDetailDrive[]
  scoringPlays: GameDetailScoringPlay[]
  teamStats: GameDetailTeamStat[]
  /** athleteId -> one line per box-score group he appears in. */
  players: Record<string, GameDetailPlayerLine[]>
  /** ESPN's own win probability after the latest play, percent. */
  winProbability: { home: number; away: number } | null
  venue: { name: string; location: string | null } | null
  weather: string | null
  attendance: number | null
  /** Shots, box score and the full play list — present only for a basketball summary. */
  basketball: BasketballDetail | null
  /** Rink shots, skater/goalie box score and plays — present only for a hockey summary. */
  hockey: HockeyDetail | null
  /** At-bats with pitches, the spray chart, batting/pitching box score — present only for a baseball summary. */
  baseball: BaseballDetail | null
  fetchedAt: string
}

/* ── small readers ─────────────────────────────────────────────────────────── */

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const pick = (o: Obj | null, ...path: string[]): unknown => {
  let cur: unknown = o
  for (const key of path) {
    const next = obj(cur)
    if (!next) return undefined
    cur = next[key]
  }
  return cur
}
const href = (v: unknown): string | null => str(v) ?? str(pick(obj(v), 'href'))

/* ── pieces ────────────────────────────────────────────────────────────────── */

function mapTeam(raw: Obj): GameDetailTeam {
  const team = obj(raw.team) ?? {}
  const records = arr(raw.record)
  const total = records.map(obj).find((r) => r && (r.type === 'total' || r.type == null))
  return {
    id: str(team.id) ?? '',
    abbrev: str(team.abbreviation) ?? '',
    name: str(team.displayName) ?? str(team.name) ?? '',
    logo: str(team.logo) ?? href(arr(team.logos)[0]),
    color: str(team.color),
    altColor: str(team.alternateColor),
    score: num(raw.score),
    record: str(total?.summary) ?? str(total?.displayValue),
    rank: num(pick(raw, 'curatedRank', 'current')) ?? num(raw.rank),
    linescores: arr(raw.linescores)
      .map((l) => num(pick(obj(l), 'displayValue')) ?? num(pick(obj(l), 'value')))
      .filter((n): n is number => n != null),
    possession: raw.possession === true,
  }
}

const LEADER_ORDER = [
  'passingYards',
  'rushingYards',
  'receivingYards',
  'sacks',
  'totalTackles',
  // NHL sends goals / assists / points; NBA points / rebounds / assists.
  'goals',
  'points',
  'rebounds',
  'assists',
]
const LEADER_LABEL: Record<string, string> = {
  passingYards: 'Passing Yards',
  rushingYards: 'Rushing Yards',
  receivingYards: 'Receiving Yards',
  sacks: 'Sacks',
  totalTackles: 'Tackles',
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
}

function mapLeaders(raw: unknown): GameDetailLeader[] {
  const out: GameDetailLeader[] = []
  for (const cat of arr(pick(obj(raw), 'leaders')).map(obj)) {
    if (!cat) continue
    const category = str(cat.name)
    const entry = obj(arr(cat.leaders)[0])
    const athlete = obj(entry?.athlete)
    const name = str(athlete?.displayName) ?? str(athlete?.shortName)
    if (!category || !entry || !name) continue
    out.push({
      category,
      label: LEADER_LABEL[category] ?? str(cat.displayName) ?? category,
      athleteId: str(athlete?.id),
      name,
      shortName: str(athlete?.shortName),
      position: str(pick(athlete, 'position', 'abbreviation')) ?? str(athlete?.position),
      headshot: href(athlete?.headshot),
      // NHL leaders carry no `mainStat` or `summary` — only `displayValue` ("1").
      // A bare number there IS the big number; anything longer stays the summary line.
      mainValue:
        str(pick(entry, 'mainStat', 'value')) ??
        (/^\d+(\.\d+)?$/.test(str(entry.displayValue) ?? '') ? str(entry.displayValue) : null),
      mainLabel: str(pick(entry, 'mainStat', 'label')),
      summary:
        str(entry.summary) ??
        (/^\d+(\.\d+)?$/.test(str(entry.displayValue) ?? '') ? null : str(entry.displayValue)),
    })
  }
  return out.sort((a, b) => {
    const ai = LEADER_ORDER.indexOf(a.category)
    const bi = LEADER_ORDER.indexOf(b.category)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })
}

const NON_SNAP = /timeout|end (of )?(period|quarter|half|game)|two-minute|end game|coin toss/i

function mapPlay(raw: Obj, home: GameDetailTeam, away: GameDetailTeam): GameDetailPlay {
  const start = obj(raw.start)
  const end = obj(raw.end)
  const down = num(start?.down)
  return {
    id: str(raw.id) ?? str(raw.sequenceNumber) ?? '',
    text: (str(raw.text) ?? '').replace(/\s+/g, ' ').trim(),
    type: str(pick(raw, 'type', 'text')),
    typeAbbrev: str(pick(raw, 'type', 'abbreviation')),
    period: num(pick(raw, 'period', 'number')),
    clock: str(pick(raw, 'clock', 'displayValue')),
    downDistance: down != null && down > 0 ? str(start?.downDistanceText) : null,
    startBallOn: ballOnFromAwayGoal(str(start?.possessionText), home.abbrev, away.abbrev),
    endBallOn: ballOnFromAwayGoal(str(end?.possessionText), home.abbrev, away.abbrev),
    statYardage: num(raw.statYardage),
    yardsAfterCatch: num(raw.yardsAfterCatch),
    scoring: raw.scoringPlay === true,
    awayScore: num(raw.awayScore),
    homeScore: num(raw.homeScore),
  }
}

function mapDrive(raw: Obj, home: GameDetailTeam, away: GameDetailTeam, isCurrent: boolean): GameDetailDrive {
  const team = obj(raw.team)
  const startText = str(pick(raw, 'start', 'text'))
  const endText = str(pick(raw, 'end', 'text'))
  return {
    id: str(raw.id) ?? '',
    teamId: str(team?.id),
    teamAbbrev: str(team?.abbreviation),
    teamLogo: href(arr(team?.logos)[0]) ?? str(team?.logo),
    description: str(raw.description),
    result: str(raw.displayResult) ?? str(raw.result),
    isScore: raw.isScore === true,
    isCurrent,
    startBallOn: ballOnFromAwayGoal(startText, home.abbrev, away.abbrev),
    startText,
    endBallOn: ballOnFromAwayGoal(endText, home.abbrev, away.abbrev),
    endText,
    plays: arr(raw.plays)
      .map(obj)
      .filter((p): p is Obj => p != null)
      .map((p) => mapPlay(p, home, away)),
  }
}

/** Down/distance/spot for the next snap: the END of the last real snap of the drive. */
function mapSituation(drive: Obj | null, home: GameDetailTeam, away: GameDetailTeam): GameDetailSituation | null {
  if (!drive) return null
  const snaps = arr(drive.plays)
    .map(obj)
    .filter((p): p is Obj => p != null && !NON_SNAP.test(str(pick(p, 'type', 'text')) ?? ''))
  const last = snaps[snaps.length - 1]
  const end = obj(last?.end)
  if (!end) return null
  const down = num(end.down)
  const possessionText = str(end.possessionText)
  const offenseId = str(pick(end, 'team', 'id'))
  return {
    downDistance: down != null && down > 0 ? str(end.downDistanceText) : null,
    shortDownDistance: down != null && down > 0 ? str(end.shortDownDistanceText) : null,
    possessionText,
    ballOn: ballOnFromAwayGoal(possessionText, home.abbrev, away.abbrev),
    distance: down != null && down > 0 ? num(end.distance) : null,
    offense: offenseId == null ? null : offenseId === home.id ? 'home' : offenseId === away.id ? 'away' : null,
  }
}

type TeamStatSpec = { key: string; label: string; kind: 'count' | 'ratio' | 'time' }

/*
 * Basketball's made-attempted stats are keyed by their composite ESPN names
 * ("fieldGoalsMade-fieldGoalsAttempted"), measured on NBA 401810798. The bars
 * compare shooting RATE, so 50/112 against 47/100 is not read as volume.
 */
const BASKETBALL_TEAM_STATS: TeamStatSpec[] = [
  { key: 'fieldGoalsMade-fieldGoalsAttempted', label: 'Field Goals', kind: 'ratio' },
  { key: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', label: '3-Pointers', kind: 'ratio' },
  { key: 'freeThrowsMade-freeThrowsAttempted', label: 'Free Throws', kind: 'ratio' },
  { key: 'totalRebounds', label: 'Rebounds', kind: 'count' },
  { key: 'offensiveRebounds', label: 'Offensive Rebounds', kind: 'count' },
  { key: 'assists', label: 'Assists', kind: 'count' },
  { key: 'steals', label: 'Steals', kind: 'count' },
  { key: 'blocks', label: 'Blocks', kind: 'count' },
  { key: 'totalTurnovers', label: 'Turnovers', kind: 'count' },
  { key: 'pointsInPaint', label: 'Points in Paint', kind: 'count' },
  { key: 'fastBreakPoints', label: 'Fast Break Points', kind: 'count' },
  { key: 'largestLead', label: 'Largest Lead', kind: 'count' },
]

/* NHL team stat names, measured on 401803363. */
const HOCKEY_TEAM_STATS: TeamStatSpec[] = [
  { key: 'shotsTotal', label: 'Shots', kind: 'count' },
  { key: 'faceoffPercent', label: 'Faceoff %', kind: 'count' },
  { key: 'powerPlayGoals', label: 'Power Play Goals', kind: 'count' },
  { key: 'powerPlayOpportunities', label: 'Power Plays', kind: 'count' },
  { key: 'hits', label: 'Hits', kind: 'count' },
  { key: 'blockedShots', label: 'Blocked Shots', kind: 'count' },
  { key: 'takeaways', label: 'Takeaways', kind: 'count' },
  { key: 'giveaways', label: 'Giveaways', kind: 'count' },
  { key: 'penaltyMinutes', label: 'Penalty Minutes', kind: 'count' },
]

/*
 * MLB team stats arrive GROUPED — { name: 'batting', stats: [{ name, displayValue }] } —
 * measured on 401816920; `flattenStatGroups` keys them "batting.hits" for mapTeamStats.
 */
const BASEBALL_TEAM_STATS: TeamStatSpec[] = [
  { key: 'batting.hits', label: 'Hits', kind: 'count' },
  { key: 'batting.homeRuns', label: 'Home Runs', kind: 'count' },
  { key: 'batting.walks', label: 'Walks', kind: 'count' },
  { key: 'batting.strikeouts', label: 'Strikeouts', kind: 'count' },
  { key: 'batting.stolenBases', label: 'Stolen Bases', kind: 'count' },
  { key: 'batting.runnersLeftOnBase', label: 'Left on Base', kind: 'count' },
  { key: 'batting.avg', label: 'Batting Avg', kind: 'count' },
  { key: 'fielding.errors', label: 'Errors', kind: 'count' },
  { key: 'pitching.pitches', label: 'Pitches Thrown', kind: 'count' },
]

function flattenStatGroups(boxTeams: unknown[]): unknown[] {
  return boxTeams.map(obj).map((t) => ({
    team: t?.team,
    statistics: arr(t?.statistics)
      .map(obj)
      .flatMap((g) =>
        arr(g?.stats)
          .map(obj)
          .map((s) => ({ name: `${str(g?.name)}.${str(s?.name)}`, displayValue: s?.displayValue })),
      ),
  }))
}

const TEAM_STATS: TeamStatSpec[] = [
  { key: 'totalYards', label: 'Total Yards', kind: 'count' },
  { key: 'turnovers', label: 'Turnovers', kind: 'count' },
  { key: 'firstDowns', label: '1st Downs', kind: 'count' },
  { key: 'totalPenaltiesYards', label: 'Penalties', kind: 'count' },
  { key: 'thirdDownEff', label: '3rd Down', kind: 'ratio' },
  { key: 'fourthDownEff', label: '4th Down', kind: 'ratio' },
  { key: 'netPassingYards', label: 'Passing Yards', kind: 'count' },
  { key: 'rushingYards', label: 'Rushing Yards', kind: 'count' },
  { key: 'redZoneAttempts', label: 'Red Zone', kind: 'ratio' },
  { key: 'possessionTime', label: 'Possession', kind: 'time' },
]

function statNumber(display: string, kind: 'count' | 'ratio' | 'time'): number {
  if (kind === 'time') {
    const m = /^(\d+):(\d{2})$/.exec(display)
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0
  }
  const parts = display.split(/[-/]/).map((p) => Number(p))
  if (kind === 'ratio') return parts.length === 2 && parts[1]! > 0 ? parts[0]! / parts[1]! : 0
  return Number.isFinite(parts[0]) ? parts[0]! : 0
}

function mapTeamStats(
  boxTeams: unknown[],
  home: GameDetailTeam,
  away: GameDetailTeam,
  specs: TeamStatSpec[] = TEAM_STATS,
): GameDetailTeamStat[] {
  const byTeam = new Map<string, Map<string, string>>()
  for (const t of boxTeams.map(obj)) {
    const id = str(pick(t, 'team', 'id'))
    if (!t || !id) continue
    const stats = new Map<string, string>()
    for (const s of arr(t.statistics).map(obj)) {
      const key = str(s?.name)
      const display = str(s?.displayValue)
      // First occurrence wins: `interceptions` appears twice in the NFL payload.
      if (key && display != null && !stats.has(key)) stats.set(key, display)
    }
    byTeam.set(id, stats)
  }
  const h = byTeam.get(home.id)
  const a = byTeam.get(away.id)
  if (!h || !a) return []
  const out: GameDetailTeamStat[] = []
  for (const spec of specs) {
    const hv = h.get(spec.key)
    const av = a.get(spec.key)
    if (hv == null || av == null) continue
    const hn = statNumber(hv, spec.kind)
    const an = statNumber(av, spec.kind)
    const total = hn + an
    const pretty = (v: string) => (spec.kind === 'ratio' ? v.replace('-', '/') : v)
    out.push({
      key: spec.key,
      label: spec.label,
      away: pretty(av),
      home: pretty(hv),
      awayShare: total > 0 ? an / total : 0.5,
      homeShare: total > 0 ? hn / total : 0.5,
    })
  }
  return out
}

function mapPlayers(boxPlayers: unknown[]): Record<string, GameDetailPlayerLine[]> {
  const out: Record<string, GameDetailPlayerLine[]> = {}
  for (const team of boxPlayers.map(obj)) {
    const teamId = str(pick(team, 'team', 'id'))
    for (const group of arr(team?.statistics).map(obj)) {
      const labels = arr(group?.labels).map((l) => str(l) ?? '')
      // NBA's single box-score group has no `name`; its PTS column identifies it.
      // MLB's groups have no `name` either; they carry `type: 'batting' | 'pitching'`.
      const type = str(group?.type)
      const groupName =
        str(group?.name) ??
        (labels.includes('PTS') ? 'basketball' : null) ??
        (type === 'batting' || type === 'pitching' ? type : null)
      if (!groupName) continue
      for (const entry of arr(group?.athletes).map(obj)) {
        const athlete = obj(entry?.athlete)
        const id = str(athlete?.id)
        const name = str(athlete?.displayName)
        if (!id || !name) continue
        const line: GameDetailPlayerLine = {
          group: groupName,
          teamId,
          name,
          headshot: href(athlete?.headshot),
          jersey: str(athlete?.jersey),
          labels,
          stats: arr(entry?.stats).map((s) => str(s) ?? ''),
        }
        ;(out[id] ??= []).push(line)
      }
    }
  }
  return out
}

// "Coach's Challenge (Stands)" is the last non-end play of some college games (NCAAB 401858383).
const NON_BASKETBALL_PLAY = /timeout|end (of )?(period|quarter|half|game)|end game|jumpball|jump ball|substitution|review|challenge/i

function mapBasketball(root: Obj, home: GameDetailTeam, away: GameDetailTeam, sport: string): BasketballDetail {
  const plays: BasketballPlay[] = []
  const shots: BasketballShot[] = []
  for (const p of arr(root.plays).map(obj)) {
    if (!p) continue
    const id = str(p.id) ?? str(p.sequenceNumber) ?? ''
    const type = str(pick(p, 'type', 'text'))
    // Substitutions are a sixth of the play list (95 of 568 on 401810798) and the
    // view never shows them; they are dropped before the cache write.
    if (/substitution/i.test(type ?? '')) continue
    const text = (str(p.text) ?? '').replace(/\s+/g, ' ').trim()
    const period = num(pick(p, 'period', 'number'))
    const clock = str(pick(p, 'clock', 'displayValue'))
    const teamId = str(pick(p, 'team', 'id'))
    const athleteIds = arr(p.participants)
      .map((x) => str(pick(obj(x), 'athlete', 'id')))
      .filter((x): x is string => x != null)
    plays.push({
      id,
      text,
      type,
      period,
      clock,
      teamId,
      scoring: p.scoringPlay === true,
      scoreValue: num(p.scoreValue),
      awayScore: num(p.awayScore),
      homeScore: num(p.homeScore),
      athleteIds,
    })
    const x = num(pick(p, 'coordinate', 'x'))
    const y = num(pick(p, 'coordinate', 'y'))
    if (
      p.shootingPlay === true &&
      x != null &&
      y != null &&
      // The court bounds are what reject ESPN's -214748340 sentinel; there is no separate check.
      x >= 0 &&
      x <= 50 &&
      y >= 0 &&
      // ⚠ Free throws never go on the chart, and the two leagues spell them differently.
      // NBA: "Free Throw - 1 of 2" with the sentinel spot. College: makes AND misses are
      // "MadeFreeThrow" — no space — with a REAL spot at the rim, (25, 0), on 130 of 130
      // across three NCAAB games. The old /free throw/ let every one of those onto the
      // chart; the optional space is the whole fix.
      !/free ?throw/i.test(type ?? '')
    ) {
      shots.push({
        id,
        teamId,
        athleteId: athleteIds[0] ?? null,
        x,
        y,
        made: p.scoringPlay === true,
        value: num(p.scoreValue) ?? num(p.pointsAttempted),
        period,
        clock,
        text,
      })
    }
  }

  const boxFor = (teamRaw: Obj | null): BasketballBoxTeam | null => {
    const teamId = str(pick(teamRaw, 'team', 'id'))
    const group = obj(arr(teamRaw?.statistics)[0])
    if (!teamId || !group) return null
    return {
      teamId,
      labels: arr(group.labels).map((l) => str(l) ?? ''),
      totals: arr(group.totals).map((t) => str(t) ?? ''),
      players: arr(group.athletes)
        .map(obj)
        .map((entry): BasketballBoxPlayer | null => {
          const athlete = obj(entry?.athlete)
          const athleteId = str(athlete?.id)
          const name = str(athlete?.displayName)
          if (!entry || !athleteId || !name) return null
          return {
            athleteId,
            name,
            shortName: str(athlete?.shortName),
            headshot: href(athlete?.headshot),
            jersey: str(athlete?.jersey),
            position: str(pick(athlete, 'position', 'abbreviation')) ?? str(athlete?.position),
            starter: entry.starter === true,
            didNotPlay: entry.didNotPlay === true,
            reason: str(entry.reason),
            stats: arr(entry.stats).map((s) => str(s) ?? ''),
          }
        })
        .filter((x): x is BasketballBoxPlayer => x != null),
    }
  }
  const teams = arr(pick(root, 'boxscore', 'players')).map(obj)
  const teamRaw = (id: string) => teams.find((t) => str(pick(t, 'team', 'id')) === id) ?? null
  const halves = arr(root.plays).some((p) => /half/i.test(str(pick(obj(p), 'period', 'displayValue')) ?? ''))
  return {
    periods: halves ? 'halves' : 'quarters',
    court: sport === 'NCAAB' ? 'college' : 'pro',
    plays,
    shots,
    box: { home: boxFor(teamRaw(home.id)), away: boxFor(teamRaw(away.id)) },
  }
}

const NON_HOCKEY_PLAY = /period (start|end)|end of game|game end|stoppage/i
const HOCKEY_SHOT_KIND: Record<string, HockeyShot['kind']> = { goal: 'goal', shot: 'shot', missed: 'missed' }

/**
 * Each team's attacking direction in PERIOD 1: +1 toward +x, −1 toward −x.
 *
 * Teams switch ends every period, overtime included (measured, see HockeyShot),
 * so a team attacks the same end in periods 1 and 3 and the other end in 2 and
 * OT. Evidence is pooled across regulation — a shot at +x in period 2 counts as
 * a vote for −x in period 1 — because one period's handful of shots can mislead
 * (BOS's three overtime shots split 2–1 the "wrong" way around its winner).
 */
export function hockeyAttackSigns(
  shots: ReadonlyArray<{ teamId: string | null; period: number | null; x: number }>,
): Map<string, 1 | -1> {
  const evidence = new Map<string, number>()
  for (const s of shots) {
    if (!s.teamId || s.period == null || s.period < 1 || s.period > 3 || s.x === 0) continue
    const flip = s.period % 2 === 1 ? 1 : -1
    evidence.set(s.teamId, (evidence.get(s.teamId) ?? 0) + Math.sign(s.x) * flip)
  }
  const out = new Map<string, 1 | -1>()
  for (const [teamId, e] of evidence) out.set(teamId, e < 0 ? -1 : 1)
  return out
}

function mapHockey(root: Obj, home: GameDetailTeam, away: GameDetailTeam): HockeyDetail {
  const plays: HockeyPlay[] = []
  const rawShots: HockeyShot[] = []
  for (const p of arr(root.plays).map(obj)) {
    if (!p) continue
    const type = str(pick(p, 'type', 'text'))
    // Stoppages are an eighth of the list (40 of 309) and say nothing a viewer reads.
    if (/^stoppage$/i.test(type ?? '')) continue
    const id = str(p.id) ?? str(p.sequenceNumber) ?? ''
    const text = (str(p.text) ?? '').replace(/\s+/g, ' ').trim()
    const period = num(pick(p, 'period', 'number'))
    const clock = str(pick(p, 'clock', 'displayValue'))
    const teamId = str(pick(p, 'team', 'id'))
    const strength = str(pick(p, 'strength', 'text'))
    const athleteIds = arr(p.participants)
      .map((x) => str(pick(obj(x), 'athlete', 'id')))
      .filter((x): x is string => x != null)
    plays.push({
      id,
      text,
      type,
      period,
      clock,
      teamId,
      scoring: p.scoringPlay === true,
      strength,
      awayScore: num(p.awayScore),
      homeScore: num(p.homeScore),
      athleteIds,
    })
    const kind = HOCKEY_SHOT_KIND[(type ?? '').toLowerCase()]
    const x = num(pick(p, 'coordinate', 'x'))
    const y = num(pick(p, 'coordinate', 'y'))
    if (kind && x != null && y != null && Math.abs(x) <= 100 && Math.abs(y) <= 42.5) {
      rawShots.push({ id, teamId, athleteId: athleteIds[0] ?? null, x, y, kind, period, clock, strength, text })
    }
  }

  const signs = hockeyAttackSigns(rawShots)
  const shots = rawShots
    .map((s) => {
      const base = (s.teamId ? signs.get(s.teamId) : undefined) ?? 1
      const dir = s.period != null && s.period % 2 === 0 ? -base : base
      return { ...s, x: s.x * dir, y: s.y * dir }
    })
    // A shot from behind centre ice after normalising is a clearance, not a chance.
    .filter((s) => s.x >= 0)

  const teams = arr(pick(root, 'boxscore', 'players')).map(obj)
  const group = (t: Obj | null, name: string) => arr(t?.statistics).map(obj).find((g) => str(g?.name) === name) ?? null
  const people = (g: Obj | null): HockeyPlayer[] =>
    arr(g?.athletes)
      .map(obj)
      .map((entry): HockeyPlayer | null => {
        const athlete = obj(entry?.athlete)
        const athleteId = str(athlete?.id)
        const name = str(athlete?.displayName)
        if (!entry || !athleteId || !name) return null
        return {
          athleteId,
          name,
          shortName: str(athlete?.shortName),
          headshot: href(athlete?.headshot),
          jersey: str(athlete?.jersey),
          position: str(pick(athlete, 'position', 'abbreviation')) ?? str(athlete?.position),
          stats: arr(entry.stats).map((s) => str(s) ?? ''),
        }
      })
      .filter((x): x is HockeyPlayer => x != null)
  const boxFor = (id: string): HockeyBoxTeam | null => {
    const t = teams.find((x) => str(pick(x, 'team', 'id')) === id) ?? null
    if (!t) return null
    const forwards = group(t, 'forwards')
    const defenses = group(t, 'defenses')
    const goalies = group(t, 'goalies')
    return {
      teamId: id,
      skaterLabels: arr((forwards ?? defenses)?.labels).map((l) => str(l) ?? ''),
      skaters: [
        ...people(forwards).map((p) => ({ ...p, unit: 'F' as const })),
        ...people(defenses).map((p) => ({ ...p, unit: 'D' as const })),
      ],
      goalieLabels: arr(goalies?.labels).map((l) => str(l) ?? ''),
      goalies: people(goalies),
    }
  }

  return { plays, shots, box: { home: boxFor(home.id), away: boxFor(away.id) } }
}

/**
 * ESPN's `hitCoordinate` is a spray-chart pixel space, not feet. Fitted on the
 * four home runs whose play text prints a distance (COL @ DET 401816920 and
 * KC @ BOS 401816922, 2026-09-13): home plate sits at (125.5, 205.5) and one unit
 * is 2.37 ft, which reproduces all four printed distances to within 0.6 ft. With
 * that origin every one of the 57 balls in play in both games lands inside the
 * foul lines (±45°), and "to left" / "to right" in the text match the sign of x.
 */
export const SPRAY_PLATE = { x: 125.5, y: 205.5, feetPerUnit: 2.37 } as const

const HIT_CALLS = /^(single|double|triple|ground-rule-double)$/
const round1 = (n: number) => Math.round(n * 10) / 10

function pitchKind(type: string | null): BaseballPitch['kind'] {
  const t = type ?? ''
  // "Automatic Ball/Strike" is a pitch-clock call; college games carry them (NCAA 401874442).
  if (/^(ball|intent|pitchout|hit-by-pitch|automatic-ball)/.test(t)) return 'ball'
  if (/^(strike|automatic-strike)/.test(t)) return 'strike'
  /*
   * ⚠ EXACT, NOT /^foul/. "foul-out" is a ball CAUGHT IN PLAY — an out with a
   * spray-chart spot — and the prefix match filed it as a foul pitch, so foul
   * outs never reached the chart. "bunted-foul" is a foul pitch (college).
   */
  if (t === 'foul-ball' || t === 'bunted-foul') return 'foul'
  return 'inplay'
}

/** ESPN sends a bare id string as `team` on at-bat plays, and `{ id }` on inning markers. */
const playTeamId = (p: Obj | null) => str(p?.team) ?? str(pick(p, 'team', 'id'))

/**
 * ESPN's machine name for a play type ("play-result", "start-batterpitcher").
 *
 * ⚠ COLLEGE BASEBALL SENDS NO `type.type` — only the readable `type.text`
 * ("Play Result", "Start Batter/Pitcher"), measured on three NCAA games
 * (401874384, 401874442, 401874453). Every rule here keys on the machine name,
 * so a college game produced 260 at-bats with no result and an empty spray
 * chart. The machine name is derived from the text when absent: lowercase, "/"
 * dropped, spaces to "-" — which reproduces ESPN's own `type.type` on 1,571 of
 * 1,571 MLB plays that carry both.
 */
export function baseballPlayType(p: Obj | null): string | null {
  const machine = str(pick(p, 'type', 'type'))
  if (machine) return machine
  const text = str(pick(p, 'type', 'text'))
  return text ? text.toLowerCase().replace(/\//g, '').replace(/\s/g, '-') : null
}
const playType = baseballPlayType

function mapBaseball(root: Obj, comp: Obj, homeRaw: Obj, awayRaw: Obj, state: GameDetailState): BaseballDetail {
  // Every play carries its at-bat's id (73 of 73 at-bats on 401816920), including
  // the start/end-inning markers, which borrow the first/last at-bat's id.
  const order: string[] = []
  const groups = new Map<string, Obj[]>()
  for (const p of arr(root.plays).map(obj)) {
    const id = str(p?.atBatId)
    if (!p || !id) continue
    if (!groups.has(id)) {
      groups.set(id, [])
      order.push(id)
    }
    groups.get(id)!.push(p)
  }

  const atBats: BaseballAtBat[] = []
  for (const id of order) {
    const plays = (groups.get(id) ?? []).filter((p) => !/inning$/.test(playType(p) ?? ''))
    if (plays.length === 0) continue
    const start = plays.find((p) => playType(p) === 'start-batterpitcher') ?? plays[0]!
    const results = plays.filter((p) => playType(p) === 'play-result')
    const complete = plays.some((p) => playType(p) === 'end-batterpitcher')
    // ⚠ Substitutions are play-results too, with the same summaryType, so "the last
    // play-result" is not always what the batter did. Measured on TEX @ ARI
    // (401816932): "Duran at third base." sat in the at-bat still in progress, and the
    // last-result rule showed it as that batter's outcome. Two bounds:
    //   - the game's last at-bat with no end marker is still going, so nothing in it is
    //     the batter's result yet — a substitution, steal or wild pitch is an event;
    //   - a play-result after the end-of-at-bat marker is an event (not seen in the five
    //     games measured on 2026-09-13; guarded because it would mislabel the at-bat).
    const endAt = plays.findIndex((p) => playType(p) === 'end-batterpitcher')
    const inProgress = state === 'in' && !complete && id === order[order.length - 1]
    const own = inProgress ? [] : plays.filter((p, i) => playType(p) === 'play-result' && (endAt < 0 || i < endAt))
    const last = own[own.length - 1] ?? null
    const before = last ? (plays[plays.indexOf(last) - 1] ?? null) : null
    const pitchPlays = plays.filter((p) => p.summaryType === 'P')
    const pitches = pitchPlays.map(
      (p): BaseballPitch => ({
        id: str(p.id) ?? '',
        number: num(p.atBatPitchNumber),
        call: str(pick(p, 'type', 'text')),
        kind: pitchKind(playType(p)),
        pitchType: str(pick(p, 'pitchType', 'text')),
        velocity: num(p.pitchVelocity),
        x: num(pick(p, 'pitchCoordinate', 'x')),
        y: num(pick(p, 'pitchCoordinate', 'y')),
        balls: num(pick(p, 'resultCount', 'balls')),
        strikes: num(pick(p, 'resultCount', 'strikes')),
      }),
    )
    // ⚠ The batted-ball spot is read ONLY off the in-play pitch. Foul balls and the
    // end-of-at-bat marker repeat a coordinate too — a strikeout after a foul would
    // otherwise plot a ball in play that never happened. The in-play pitch carried a
    // spot 45 of 45 times; the play-result only 13 of 85.
    const inPlay = [...pitchPlays].reverse().find((p) => pitchKind(playType(p)) === 'inplay') ?? null
    const hx = num(pick(inPlay, 'hitCoordinate', 'x'))
    const hy = num(pick(inPlay, 'hitCoordinate', 'y'))
    const inPlayType = playType(inPlay)
    const battedBall: BaseballBattedBall | null =
      inPlay && hx != null && hy != null
        ? {
            x: round1((hx - SPRAY_PLATE.x) * SPRAY_PLATE.feetPerUnit),
            y: round1((SPRAY_PLATE.y - hy) * SPRAY_PLATE.feetPerUnit),
            kind: inPlayType === 'home-run' ? 'hr' : HIT_CALLS.test(inPlayType ?? '') ? 'hit' : 'out',
            trajectory: str(inPlay.trajectory),
            call: str(pick(inPlay, 'type', 'text')),
          }
        : null
    // What ended the at-bat, read off the play just before the result: the in-play call,
    // strike three, ball four, else that play's own name ("Hit By Pitch", "Pick Off").
    const resultType =
      !last || !before
        ? null
        : before.summaryType === 'P'
          ? pitchKind(playType(before)) === 'inplay'
            ? str(pick(before, 'type', 'text'))
            : num(pick(before, 'resultCount', 'strikes')) === 3
              ? 'Strikeout'
              : num(pick(before, 'resultCount', 'balls')) === 4
                ? 'Walk'
                : str(pick(before, 'type', 'text'))
          : playType(before) === 'start-batterpitcher'
            ? null
            : str(pick(before, 'type', 'text'))
    const participant = (role: string) =>
      str(pick(arr(start.participants).map(obj).find((x) => x?.type === role) ?? null, 'athlete', 'id'))
    const half = str(pick(start, 'period', 'type'))
    atBats.push({
      id,
      inning: num(pick(start, 'period', 'number')),
      half: half === 'Top' ? 'top' : half === 'Bottom' ? 'bottom' : null,
      battingTeamId: playTeamId(start),
      batterId: participant('batter'),
      pitcherId: participant('pitcher'),
      result: last ? (str(last.text) ?? '').replace(/\s+/g, ' ').trim() || null : null,
      resultType,
      events: results
        .filter((r) => r !== last)
        .map((r) => (str(r.text) ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
      scoring: results.some((r) => r.scoringPlay === true),
      awayScore: num(last?.awayScore),
      homeScore: num(last?.homeScore),
      outs: num(last?.outs),
      pitches,
      battedBall,
      complete,
    })
  }

  const teams = arr(pick(root, 'boxscore', 'players')).map(obj)
  const table = (teamRaw: Obj | null, type: 'batting' | 'pitching'): BaseballBoxTable | null => {
    const g = arr(teamRaw?.statistics).map(obj).find((x) => str(x?.type) === type) ?? null
    if (!g) return null
    return {
      labels: arr(g.labels).map((l) => str(l) ?? ''),
      totals: arr(g.totals).map((t) => str(t) ?? ''),
      players: arr(g.athletes)
        .map(obj)
        .map((entry): BaseballBoxPlayer | null => {
          const athlete = obj(entry?.athlete)
          const athleteId = str(athlete?.id)
          const name = str(athlete?.displayName)
          if (!entry || !athleteId || !name) return null
          const note = arr(entry.notes).map(obj).find((n) => n?.type === 'pitchingDecision') ?? null
          return {
            athleteId,
            name,
            shortName: str(athlete?.shortName),
            headshot: href(athlete?.headshot),
            position: str(pick(entry, 'position', 'abbreviation')) ?? str(pick(athlete, 'position', 'abbreviation')),
            batOrder: num(entry.batOrder),
            starter: entry.starter === true,
            note: str(note?.text),
            stats: arr(entry.stats).map((s) => str(s) ?? ''),
          }
        })
        .filter((x): x is BaseballBoxPlayer => x != null),
    }
  }
  const boxFor = (teamId: string | null): BaseballBoxTeam | null => {
    const t = teams.find((x) => str(pick(x, 'team', 'id')) === teamId) ?? null
    return t && teamId ? { teamId, batting: table(t, 'batting'), pitching: table(t, 'pitching') } : null
  }

  // Situation, measured live on KC @ BOS: counts are numbers, the batter and pitcher
  // are `{ playerId }` only, and an occupied base is `{ playerId }` — an empty one is absent.
  const sit = obj(root.situation)
  const runner = (key: string) => {
    const v = obj(sit?.[key])
    return { on: v != null, id: v ? (str(v.playerId) ?? str(pick(v, 'athlete', 'id'))) : null }
  }
  const [first, second, third] = [runner('onFirst'), runner('onSecond'), runner('onThird')]

  return {
    atBats,
    hitsErrors: {
      home: { hits: num(homeRaw.hits), errors: num(homeRaw.errors) },
      away: { hits: num(awayRaw.hits), errors: num(awayRaw.errors) },
    },
    current:
      state === 'in' && sit
        ? {
            balls: num(sit.balls),
            strikes: num(sit.strikes),
            outs: num(sit.outs),
            batterId: str(pick(sit, 'batter', 'playerId')) ?? str(pick(sit, 'batter', 'athlete', 'id')),
            pitcherId: str(pick(sit, 'pitcher', 'playerId')) ?? str(pick(sit, 'pitcher', 'athlete', 'id')),
            on: { first: first.on, second: second.on, third: third.on },
            runners: { first: first.id, second: second.id, third: third.id },
          }
        : null,
    decisions: arr(pick(comp, 'status', 'featuredAthletes'))
      .map(obj)
      .map((f) => {
        const name = str(pick(f, 'athlete', 'displayName'))
        const label = str(f?.displayName) ?? str(f?.name)
        if (!f || !name || !label) return null
        return {
          key: str(f.name) ?? label,
          label,
          athleteId: str(pick(f, 'athlete', 'id')),
          name,
          teamId: str(pick(f, 'team', 'id')),
        }
      })
      .filter((x): x is BaseballDetail['decisions'][number] => x != null),
    box: { home: boxFor(str(pick(homeRaw, 'team', 'id'))), away: boxFor(str(pick(awayRaw, 'team', 'id'))) },
  }
}

/* ── entry point ───────────────────────────────────────────────────────────── */

/**
 * Trim a raw ESPN summary into the view's shape. Returns null when the payload
 * does not describe a two-team game (no header, or a missing side) — the loader
 * then says the game could not be read, instead of rendering half a page.
 */
export function trimEspnGameSummary(
  raw: unknown,
  opts: { sport: string; gameId: string; fetchedAt: string },
): LiveGameDetail | null {
  const root = obj(raw)
  const comp = obj(arr(pick(root, 'header', 'competitions'))[0])
  const competitors = arr(comp?.competitors).map(obj)
  const homeRaw = competitors.find((c) => c?.homeAway === 'home')
  const awayRaw = competitors.find((c) => c?.homeAway === 'away')
  if (!root || !comp || !homeRaw || !awayRaw) return null

  const home = mapTeam(homeRaw)
  const away = mapTeam(awayRaw)
  const stateRaw = str(pick(comp, 'status', 'type', 'state'))
  const state: GameDetailState = stateRaw === 'in' || stateRaw === 'post' ? stateRaw : 'pre'

  const leaderTeams = arr(root.leaders).map(obj)
  const leadersFor = (team: GameDetailTeam) =>
    mapLeaders(leaderTeams.find((t) => str(pick(t, 'team', 'id')) === team.id) ?? null)

  const drivesRoot = obj(root.drives)
  const currentRaw = obj(drivesRoot?.current)
  const previousRaw = arr(drivesRoot?.previous).map(obj).filter((d): d is Obj => d != null)
  const drives = previousRaw.map((d) => mapDrive(d, home, away, false))
  // `current` is usually also the tail of `previous`; keep it once, marked current.
  const current = currentRaw ? mapDrive(currentRaw, home, away, true) : null
  if (current) {
    const dup = drives.findIndex((d) => d.id && d.id === current.id)
    if (dup >= 0) drives.splice(dup, 1)
    drives.push(current)
  }
  const drive = current ?? drives[drives.length - 1] ?? null
  const players = mapPlayers(arr(pick(root, 'boxscore', 'players')))

  // Basketball, hockey and baseball summaries all carry a flat `plays` list and no
  // `drives`; the box score tells them apart. Baseball has a `type: 'pitching'` group
  // (MLB 401816920), hockey a `goalies` group (NHL 401803363).
  const boxGroups = arr(pick(root, 'boxscore', 'players')).flatMap((t) => arr(obj(t)?.statistics).map(obj))
  const isBaseball = boxGroups.some((g) => str(g?.type) === 'pitching')
  const isHockey = !isBaseball && boxGroups.some((g) => str(g?.name) === 'goalies')
  const flatPlays = Array.isArray(root.plays) && !drivesRoot
  const baseball = flatPlays && isBaseball ? mapBaseball(root, comp, homeRaw, awayRaw, state) : null
  const hockey = flatPlays && isHockey ? mapHockey(root, home, away) : null
  const basketball = flatPlays && !isBaseball && !isHockey ? mapBasketball(root, home, away, opts.sport) : null
  // Baseball's last play is the last at-bat that has a result, not the pitch in progress.
  const lastAtBat = baseball ? ([...baseball.atBats].reverse().find((a) => a.result) ?? null) : null
  const lastFlat =
    (basketball
      ? [...basketball.plays].reverse().find((p) => p.text && !NON_BASKETBALL_PLAY.test(p.type ?? ''))
      : hockey
        ? [...hockey.plays].reverse().find((p) => p.text && !NON_HOCKEY_PLAY.test(p.type ?? ''))
        : null) ?? null

  const allPlays = (drive?.plays ?? []).filter((p) => !NON_SNAP.test(p.type ?? ''))
  const lastPlay: GameDetailPlay | null = lastAtBat
    ? {
        id: lastAtBat.id,
        text: lastAtBat.result ?? '',
        type: lastAtBat.resultType,
        typeAbbrev: null,
        period: lastAtBat.inning,
        clock: null,
        downDistance: null,
        startBallOn: null,
        endBallOn: null,
        statYardage: null,
        yardsAfterCatch: null,
        scoring: lastAtBat.scoring,
        awayScore: lastAtBat.awayScore,
        homeScore: lastAtBat.homeScore,
      }
    : lastFlat
    ? {
        id: lastFlat.id,
        text: lastFlat.text,
        type: lastFlat.type,
        typeAbbrev: null,
        period: lastFlat.period,
        clock: lastFlat.clock,
        downDistance: null,
        startBallOn: null,
        endBallOn: null,
        statYardage: null,
        yardsAfterCatch: null,
        scoring: lastFlat.scoring,
        awayScore: lastFlat.awayScore,
        homeScore: lastFlat.homeScore,
      }
    : (allPlays[allPlays.length - 1] ?? null)

  const wp = arr(root.winprobability).map(obj)
  const lastWp = wp[wp.length - 1]
  const homePct = num(lastWp?.homeWinPercentage)
  const tiePct = num(lastWp?.tiePercentage) ?? 0

  const venue = obj(pick(root, 'gameInfo', 'venue'))
  const city = str(pick(venue, 'address', 'city'))
  const region = str(pick(venue, 'address', 'state'))
  const weather = obj(pick(root, 'gameInfo', 'weather'))
  const temp = num(weather?.temperature)
  const condition = str(weather?.conditionId) ?? str(weather?.displayValue)

  return {
    gameId: opts.gameId,
    sport: opts.sport,
    status: {
      state,
      detail: str(pick(comp, 'status', 'type', 'shortDetail')),
      period: num(pick(comp, 'status', 'period')),
      clock: str(pick(comp, 'status', 'displayClock')),
    },
    home,
    away,
    leaders: { home: leadersFor(home), away: leadersFor(away) },
    drive,
    situation: state === 'in' ? mapSituation(currentRaw ?? null, home, away) : null,
    lastPlay,
    // Basketball plays name their athletes by id; football plays only in text.
    lastPlayAthleteIds: lastAtBat
      ? [lastAtBat.batterId, lastAtBat.pitcherId].filter((id): id is string => id != null)
      : lastFlat
      ? lastFlat.athleteIds.slice(0, 2)
      : lastPlay
        ? athletesInPlayText(lastPlay.text, players)
        : [],
    drives,
    scoringPlays: arr(root.scoringPlays)
      .map(obj)
      .filter((p): p is Obj => p != null)
      .map((p) => ({
        id: str(p.id) ?? '',
        period: num(pick(p, 'period', 'number')),
        clock: str(pick(p, 'clock', 'displayValue')),
        text: (str(p.text) ?? '').replace(/\s+/g, ' ').trim(),
        type: str(pick(p, 'type', 'text')),
        teamAbbrev: str(pick(p, 'team', 'abbreviation')),
        teamLogo: str(pick(p, 'team', 'logo')) ?? href(arr(pick(p, 'team', 'logos'))[0]),
        awayScore: num(p.awayScore),
        homeScore: num(p.homeScore),
      })),
    teamStats: baseball
      ? mapTeamStats(flattenStatGroups(arr(pick(root, 'boxscore', 'teams'))), home, away, BASEBALL_TEAM_STATS)
      : mapTeamStats(
          arr(pick(root, 'boxscore', 'teams')),
          home,
          away,
          basketball ? BASKETBALL_TEAM_STATS : hockey ? HOCKEY_TEAM_STATS : TEAM_STATS,
        ),
    players,
    winProbability:
      homePct != null
        ? {
            home: Math.round(homePct * 1000) / 10,
            away: Math.round(Math.max(0, 1 - homePct - tiePct) * 1000) / 10,
          }
        : null,
    venue: str(venue?.fullName)
      ? { name: str(venue?.fullName)!, location: city && region ? `${city}, ${region}` : city ?? region }
      : null,
    weather: temp != null ? `${temp}°${condition ? ` · ${condition}` : ''}` : condition,
    attendance: num(pick(root, 'gameInfo', 'attendance')),
    basketball,
    hockey,
    baseball,
    fetchedAt: opts.fetchedAt,
  }
}

/**
 * Sports the clicked-game view covers. NFL and NCAAF share the football summary
 * shape; NBA's basketball shape (flat plays, shot spots, single box-score group)
 * was measured 2026-09-13 on CHI @ GS (401810798); NHL's hockey shape (full-rink
 * coordinates, forwards/defenses/goalies box score) on LA @ BOS (401803363); MLB's
 * baseball shape (pitch-level plays grouped by at-bat, batting/pitching box score)
 * on COL @ DET (401816920) and KC @ BOS live (401816922). Men's college basketball
 * shares the NBA shape with two halves and a real free-throw spot, measured on UConn
 * vs Michigan (401856600), Oklahoma vs Baylor (401858383) and Illinois @ UCLA in OT
 * (401825532).
 */
export const GAME_VIEW_SPORTS: readonly string[] = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'NCAABASE']

const NAME_SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i

function playTextKey(displayName: string): string | null {
  const parts = displayName.replace(NAME_SUFFIX, '').trim().split(/\s+/)
  if (parts.length < 2 || !parts[0]) return null
  return `${parts[0][0]}.${parts[parts.length - 1]}`.toLowerCase()
}

/**
 * The athletes a play's text names, as box-score athlete ids, in order.
 *
 * ⚠ ESPN'S PLAYS CARRY NO ATHLETE IDS (only `teamParticipants`), so the "who was
 * involved" cards match ESPN's own play-text convention — "J.Burrow pass short
 * right to S.Perine" — against box-score names, "Joe Burrow" -> "j.burrow".
 *
 * Deliberately strict: an abbreviation shared by two players in the game ("J.Allen"
 * on both teams) matches NEITHER, and a name the pattern cannot read (a multi-word
 * surname, "A.St. Brown") matches nothing. No card is better than the wrong
 * player's stat line beside a play he was not in.
 */
export function athletesInPlayText(
  text: string,
  players: Record<string, GameDetailPlayerLine[]>,
  max = 2,
): string[] {
  const byKey = new Map<string, Set<string>>()
  for (const [id, lines] of Object.entries(players)) {
    const key = lines[0]?.name ? playTextKey(lines[0].name) : null
    if (!key) continue
    const ids = byKey.get(key) ?? new Set<string>()
    ids.add(id)
    byKey.set(key, ids)
  }
  const out: string[] = []
  for (const m of text.matchAll(/\b([A-Z])\.([A-Z][A-Za-z'’-]+)/g)) {
    const ids = byKey.get(`${m[1]}.${m[2]}`.toLowerCase())
    if (!ids || ids.size !== 1) continue
    const id = [...ids][0]!
    if (!out.includes(id)) out.push(id)
    if (out.length >= max) break
  }
  return out
}

/** Which state a cached copy may live for, in ms. */
export function summaryTtlMs(state: GameDetailState): number {
  return state === 'in' ? 20_000 : state === 'pre' ? 5 * 60_000 : 6 * 60 * 60_000
}
