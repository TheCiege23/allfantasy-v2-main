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
  /** Every play, in game order. */
  plays: BasketballPlay[]
  shots: BasketballShot[]
  box: { home: BasketballBoxTeam | null; away: BasketballBoxTeam | null }
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
      mainValue: str(pick(entry, 'mainStat', 'value')),
      mainLabel: str(pick(entry, 'mainStat', 'label')),
      summary: str(entry.summary) ?? str(entry.displayValue),
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
      const groupName = str(group?.name) ?? (labels.includes('PTS') ? 'basketball' : null)
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

const NON_BASKETBALL_PLAY = /timeout|end (of )?(period|quarter|half|game)|end game|jumpball|jump ball|substitution|review/i

function mapBasketball(root: Obj, home: GameDetailTeam, away: GameDetailTeam): BasketballDetail {
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
      !/free throw/i.test(type ?? '')
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
  return {
    plays,
    shots,
    box: { home: boxFor(teamRaw(home.id)), away: boxFor(teamRaw(away.id)) },
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

  // A basketball summary carries a flat `plays` list and no `drives` (NBA 401810798).
  const basketball = Array.isArray(root.plays) && !drivesRoot ? mapBasketball(root, home, away) : null
  const lastBasketballPlay = basketball
    ? [...basketball.plays].reverse().find((p) => p.text && !NON_BASKETBALL_PLAY.test(p.type ?? '')) ?? null
    : null

  const allPlays = (drive?.plays ?? []).filter((p) => !NON_SNAP.test(p.type ?? ''))
  const lastPlay: GameDetailPlay | null = lastBasketballPlay
    ? {
        id: lastBasketballPlay.id,
        text: lastBasketballPlay.text,
        type: lastBasketballPlay.type,
        typeAbbrev: null,
        period: lastBasketballPlay.period,
        clock: lastBasketballPlay.clock,
        downDistance: null,
        startBallOn: null,
        endBallOn: null,
        statYardage: null,
        yardsAfterCatch: null,
        scoring: lastBasketballPlay.scoring,
        awayScore: lastBasketballPlay.awayScore,
        homeScore: lastBasketballPlay.homeScore,
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
    lastPlayAthleteIds: lastBasketballPlay
      ? lastBasketballPlay.athleteIds.slice(0, 2)
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
    teamStats: mapTeamStats(
      arr(pick(root, 'boxscore', 'teams')),
      home,
      away,
      basketball ? BASKETBALL_TEAM_STATS : TEAM_STATS,
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
    fetchedAt: opts.fetchedAt,
  }
}

/**
 * Sports the clicked-game view covers. NFL and NCAAF share the football summary
 * shape; NBA's basketball shape (flat plays, shot spots, single box-score group)
 * was measured 2026-09-13 on CHI @ GS (401810798).
 */
export const GAME_VIEW_SPORTS: readonly string[] = ['NFL', 'NCAAF', 'NBA']

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
