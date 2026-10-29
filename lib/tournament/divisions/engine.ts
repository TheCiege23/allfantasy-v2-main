/**
 * Divisions & conferences — the tournament's second format, as pure functions.
 *
 * Two named divisions, each split into conference leagues. Every team in a division
 * is ranked by record, then points. The top `autoBids` take seed lines four at a
 * time; a wildcard pool (the next `wildcardSpots` ranks — "the bubble" — plus the
 * `wildcardSpots` highest scorers below them) is re-ranked on points only and its
 * top `wildcardSpots` take the remaining seed lines. Seed lines snake across four
 * regions (odd lines N,E,S,W; even lines W,S,E,N). The division brackets end the
 * week before the cross-division championship, which is one week before the season
 * ends (NFL week 17).
 *
 * 🛑 THE BACKEND IS THE ONLY PLACE THESE NUMBERS ARE CALCULATED. Screens display
 * what this module returns and never re-sort. Nothing here touches the database —
 * `divisionsStore.ts` reads the rows and calls in.
 *
 * Tiebreakers (tournament-extras README, "Decided rules"):
 *   1. higher seed  2. better record  3. best single week  4. commissioner review.
 * Before the bracket there are no seeds, so standings ties start at record and the
 * wildcard pool (ranked on points) breaks a points tie on record, then best week.
 * A tie nothing can separate is never broken at random: it is reported as `review`.
 */

export const REGIONS = ['North', 'East', 'South', 'West'] as const
export type Region = (typeof REGIONS)[number]

/** Odd seed lines go N, E, S, W; even seed lines go W, S, E, N. */
const ODD_LINE: Region[] = ['North', 'East', 'South', 'West']
const EVEN_LINE: Region[] = ['West', 'South', 'East', 'North']

export const VALID_BRACKET_SIZES = [32, 64, 128] as const

export type DivisionTeamInput = {
  id: string
  name: string
  conferenceId: string
  wins: number
  losses: number
  ties?: number
  /** Season points. Must be a real number — a missing score is NOT zero (see `provisional`). */
  points: number
  /** Highest single-week score, when known. `null` means the tiebreak cannot use it. */
  bestWeek?: number | null
  /** True while any of this team's scores are missing or not final. Blocks seeding commits. */
  provisional?: boolean
  /**
   * The commissioner's call on a tie nothing else separates (tiebreaker 4). Higher wins.
   * Only consulted after record, points and best week are all level.
   */
  commissionerRank?: number | null
}

/** Why a row sits where it does relative to a neighbour with the same leading key. */
export type TieReason = 'points' | 'record' | 'best_week' | 'commissioner' | 'review'

export type RankedTeam = DivisionTeamInput & {
  rank: number
  /** null when nothing was tied; otherwise the key that separated it from its neighbour. */
  tiebreak: TieReason | null
}

export type FormatSettings = {
  sport: 'NFL' | 'NBA'
  conferencesPerDivision: number
  teamsPerConference: number
  autoBids: number
  wildcardSpots: number
  /** Always 4 in this format. */
  regions: 4
  /** Weeks in the sport's regular season (NFL 18). The championship is the week before it ends. */
  seasonLength: number
}

export const DEFAULT_SEASON_LENGTH: Record<FormatSettings['sport'], number> = { NFL: 18, NBA: 25 }

export function defaultFormatSettings(sport: FormatSettings['sport'] = 'NFL'): FormatSettings {
  return { sport, conferencesPerDivision: 10, teamsPerConference: 12, autoBids: 52, wildcardSpots: 12, regions: 4, seasonLength: DEFAULT_SEASON_LENGTH[sport] }
}

/** Options shown in the commissioner picker (TournamentFormat.png). */
export const SETTING_OPTIONS = {
  conferencesPerDivision: [4, 6, 8, 10],
  teamsPerConference: [8, 10, 12, 14],
  autoBids: [24, 28, 52, 56],
  wildcardSpots: [4, 8, 12, 16],
} as const

const record = (t: { wins: number; ties?: number }) => t.wins + (t.ties ?? 0) / 2

// ── tie-aware sorting ────────────────────────────────────────────────────────

type Key<T> = { reason: TieReason | null; value: (t: T) => number | null }

/**
 * Sort descending on each key in turn. A `null` value cannot separate two rows,
 * so it falls through to the next key. Rows still equal after every key are left in
 * id order (stable, deterministic) and flagged `review`.
 */
function tieAwareRank<T extends { id: string }>(rows: T[], keys: Key<T>[]): Array<T & { rank: number; tiebreak: TieReason | null }> {
  const cmp = (a: T, b: T): { order: number; decidedAt: number } => {
    for (let i = 0; i < keys.length; i++) {
      const va = keys[i]!.value(a), vb = keys[i]!.value(b)
      if (va === null || vb === null || va === vb) continue
      return { order: vb - va, decidedAt: i }
    }
    return { order: a.id < b.id ? -1 : a.id > b.id ? 1 : 0, decidedAt: keys.length }
  }
  const sorted = [...rows].sort((a, b) => cmp(a, b).order)
  return sorted.map((row, i) => {
    // The reason is the deepest key needed against either neighbour, if the leading key tied.
    let deepest = -1
    for (const other of [sorted[i - 1], sorted[i + 1]]) {
      if (!other) continue
      const d = cmp(row, other).decidedAt
      if (d > 0) deepest = Math.max(deepest, d)
    }
    const tiebreak: TieReason | null = deepest <= 0 ? null : deepest >= keys.length ? 'review' : keys[deepest]!.reason
    return { ...row, rank: i + 1, tiebreak }
  })
}

const STANDINGS_KEYS: Key<DivisionTeamInput>[] = [
  { reason: null, value: t => record(t) },
  { reason: 'points', value: t => t.points },
  { reason: 'best_week', value: t => t.bestWeek ?? null },
  { reason: 'commissioner', value: t => t.commissionerRank ?? null },
]

const POINTS_KEYS: Key<DivisionTeamInput>[] = [
  { reason: null, value: t => t.points },
  { reason: 'record', value: t => record(t) },
  { reason: 'best_week', value: t => t.bestWeek ?? null },
  { reason: 'commissioner', value: t => t.commissionerRank ?? null },
]

/** Every team in ONE division, ranked by record, then points, then best week. */
export function rankDivision(teams: DivisionTeamInput[]): RankedTeam[] {
  assertDistinct(teams)
  return tieAwareRank(teams, STANDINGS_KEYS)
}

function assertDistinct(teams: { id: string }[]) {
  if (new Set(teams.map(t => t.id)).size !== teams.length) throw new Error('Duplicate team in division')
}

// ── wildcard pool ────────────────────────────────────────────────────────────

export type WildcardEntry = RankedTeam & {
  /** Rank within the wildcard pool, 1-based, on points. */
  poolRank: number
  /** Division rank before the pool re-ranked it. */
  divisionRank: number
  via: 'bubble' | 'top_scorer'
  in: boolean
  /** Points above (+) or below (−) the line. See `buildWildcardPool`. */
  toLine: number
  poolTiebreak: TieReason | null
}

export type WildcardPool = {
  entries: WildcardEntry[]
  /** Points of the last team in (the "line to beat"); null when the pool is empty. */
  lineToBeat: number | null
  spots: number
}

/**
 * Ranks `autoBids+1 … autoBids+spots` (the bubble) plus the `spots` highest scorers
 * from every rank below, re-ranked by points. The top `spots` are in.
 *
 * `toLine` for a team that is in = its points minus the first team out (how much it
 * can lose); for a team that is out = its points minus the last team in (what it
 * needs). This matches DivisionWildcard.png (+1.8 on the 12th, −1.8 on the 13th).
 */
export function buildWildcardPool(ranked: RankedTeam[], autoBids: number, spots: number): WildcardPool {
  const bubble = ranked.filter(t => t.rank > autoBids && t.rank <= autoBids + spots)
  const below = ranked.filter(t => t.rank > autoBids + spots)
  const topScorers = tieAwareRank(below, POINTS_KEYS).slice(0, spots).map(t => below.find(b => b.id === t.id)!)
  const via = new Map<string, WildcardEntry['via']>([
    ...bubble.map(t => [t.id, 'bubble'] as const),
    ...topScorers.map(t => [t.id, 'top_scorer'] as const),
  ])
  const pool = tieAwareRank([...bubble, ...topScorers], POINTS_KEYS)
  const lastIn = pool[spots - 1]?.points ?? pool.at(-1)?.points ?? null
  const firstOut = pool[spots]?.points ?? null
  const entries: WildcardEntry[] = pool.map(row => {
    const original = ranked.find(r => r.id === row.id)!
    const isIn = row.rank <= spots
    const toLine = isIn ? (firstOut === null ? 0 : row.points - firstOut) : row.points - (lastIn ?? row.points)
    return { ...original, poolRank: row.rank, divisionRank: original.rank, via: via.get(row.id)!, in: isIn, toLine: round1(toLine), poolTiebreak: row.tiebreak }
  })
  return { entries, lineToBeat: lastIn, spots }
}

const round1 = (n: number) => Math.round(n * 10) / 10

// ── standings status ─────────────────────────────────────────────────────────

export type BidStatus = 'auto' | 'wildcard' | 'bubble_out' | 'out'

export function bidStatus(team: RankedTeam, autoBids: number, pool: WildcardPool): BidStatus {
  if (team.rank <= autoBids) return 'auto'
  const entry = pool.entries.find(e => e.id === team.id)
  if (!entry) return 'out'
  return entry.in ? 'wildcard' : 'bubble_out'
}

// ── seeding and regions ──────────────────────────────────────────────────────

export type SeededTeam = RankedTeam & {
  /** 1 … bracketSize, best first. */
  overallSeed: number
  /** 1 … bracketSize/4 — the seed shown in the bracket ("#1 seed"). */
  seedLine: number
  region: Region
  bid: 'auto' | 'wildcard'
}

/** Which region the p-th team (0-based, best first) on a seed line goes to. */
export function regionFor(seedLine: number, positionOnLine: number): Region {
  if (positionOnLine < 0 || positionOnLine > 3) throw new Error('A seed line holds four teams')
  return (seedLine % 2 === 1 ? ODD_LINE : EVEN_LINE)[positionOnLine]!
}

/**
 * Auto bids in rank order, then the wildcard pool's qualifiers in pool order. Each run
 * of four becomes one seed line and snakes across the regions.
 */
export function seedDivision(ranked: RankedTeam[], pool: WildcardPool, autoBids: number): SeededTeam[] {
  const field: Array<RankedTeam & { bid: 'auto' | 'wildcard' }> = [
    ...ranked.filter(t => t.rank <= autoBids).map(t => ({ ...t, bid: 'auto' as const })),
    ...pool.entries.filter(e => e.in).map(e => ({ ...ranked.find(r => r.id === e.id)!, bid: 'wildcard' as const })),
  ]
  if (field.length % 4 !== 0) throw new Error('The bracket field must fill whole seed lines of four')
  return field.map((t, i) => {
    const seedLine = Math.floor(i / 4) + 1
    return { ...t, overallSeed: i + 1, seedLine, region: regionFor(seedLine, i % 4) }
  })
}

// ── brackets ─────────────────────────────────────────────────────────────────

/** First-round seed pairing order inside one region. 16 follows the familiar 1-16, 8-9, 5-12, 4-13, 6-11, 3-14, 7-10, 2-15 layout. */
export function regionPairOrder(regionSize: number): number[] {
  if (regionSize === 16) return [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]
  if (!Number.isInteger(Math.log2(regionSize)) || regionSize < 2) throw new Error('Region size must be a power of two')
  let order = [1, 2]
  for (let width = 4; width <= regionSize; width *= 2) order = order.flatMap(seed => [seed, width + 1 - seed])
  return order
}

/** Final-four pairing keeps the line-1 seeds (N=1, E=2, S=3, W=4 overall) apart: N v W, E v S. */
export const FINAL_FOUR_ORDER: Region[] = ['North', 'West', 'East', 'South']

export type BracketEntrant = Pick<SeededTeam, 'id' | 'name' | 'conferenceId' | 'seedLine' | 'overallSeed' | 'region' | 'wins' | 'losses' | 'ties' | 'bestWeek'>

export type GameDecision = 'score' | 'seed' | 'record' | 'best_week' | 'review' | 'bye'

export type BracketGame = {
  round: number
  index: number
  a: BracketEntrant | null
  b: BracketEntrant | null
  scoreA: number | null
  scoreB: number | null
  winner: BracketEntrant | null
  decidedBy: GameDecision | null
}

export type GameScores = Record<string, { a: number; b: number }>
export const gameKey = (round: number, index: number) => `${round}:${index}`

/**
 * Decide one game: higher score; on a tie the higher seed (lower seed line); then
 * better record; then best single week; then commissioner review (no winner).
 */
export function decideGame(a: BracketEntrant, b: BracketEntrant, scoreA: number, scoreB: number): { winner: BracketEntrant | null; decidedBy: GameDecision } {
  if (scoreA !== scoreB) return { winner: scoreA > scoreB ? a : b, decidedBy: 'score' }
  if (a.seedLine !== b.seedLine) return { winner: a.seedLine < b.seedLine ? a : b, decidedBy: 'seed' }
  const ra = record(a), rb = record(b)
  if (ra !== rb) return { winner: ra > rb ? a : b, decidedBy: 'record' }
  if (a.bestWeek != null && b.bestWeek != null && a.bestWeek !== b.bestWeek) return { winner: a.bestWeek > b.bestWeek ? a : b, decidedBy: 'best_week' }
  return { winner: null, decidedBy: 'review' }
}

/**
 * Play a single-elimination bracket from its first-round pairs. `scores` holds the
 * final scores keyed by `gameKey(round, index)`; a game with no score (or no
 * opponent yet) is undecided and stops its branch. `overrides` records a
 * commissioner's review decision by winner id.
 */
export function playBracket(firstRound: Array<[BracketEntrant | null, BracketEntrant | null]>, scores: GameScores = {}, overrides: Record<string, string> = {}): BracketGame[][] {
  if (!Number.isInteger(Math.log2(firstRound.length * 2))) throw new Error('Bracket size must be a power of two')
  const rounds: BracketGame[][] = []
  let pairs = firstRound
  for (let round = 1; pairs.length >= 1; round++) {
    const games = pairs.map(([a, b], index): BracketGame => {
      const key = gameKey(round, index)
      const s = scores[key]
      const game: BracketGame = { round, index, a, b, scoreA: s?.a ?? null, scoreB: s?.b ?? null, winner: null, decidedBy: null }
      if (a && !b && round === 1) return { ...game, winner: a, decidedBy: 'bye' }
      if (b && !a && round === 1) return { ...game, winner: b, decidedBy: 'bye' }
      if (!a || !b || !s) return game
      const override = overrides[key]
      const decided = decideGame(a, b, s.a, s.b)
      if (decided.decidedBy === 'review' && override && (override === a.id || override === b.id)) {
        return { ...game, winner: override === a.id ? a : b, decidedBy: 'review' }
      }
      return { ...game, ...decided }
    })
    rounds.push(games)
    if (games.length === 1) break
    pairs = Array.from({ length: games.length / 2 }, (_, i) => [games[i * 2]!.winner, games[i * 2 + 1]!.winner])
  }
  return rounds
}

/** The division's first round: regions in final-four order, each in its pairing order. */
export function divisionFirstRound(seeded: SeededTeam[]): Array<[BracketEntrant, BracketEntrant]> {
  const regionSize = seeded.length / 4
  const order = regionPairOrder(regionSize)
  const pairs: Array<[BracketEntrant, BracketEntrant]> = []
  for (const region of FINAL_FOUR_ORDER) {
    const bySeed = new Map(seeded.filter(t => t.region === region).map(t => [t.seedLine, t]))
    for (let i = 0; i < order.length; i += 2) {
      const a = bySeed.get(order[i]!), b = bySeed.get(order[i + 1]!)
      if (!a || !b) throw new Error(`Region ${region} is missing seed ${!a ? order[i] : order[i + 1]}`)
      pairs.push([toEntrant(a), toEntrant(b)])
    }
  }
  return pairs
}

export function toEntrant(t: SeededTeam): BracketEntrant {
  return { id: t.id, name: t.name, conferenceId: t.conferenceId, seedLine: t.seedLine, overallSeed: t.overallSeed, region: t.region, wins: t.wins, losses: t.losses, ties: t.ties, bestWeek: t.bestWeek ?? null }
}

/** Games of one region, round by round, from a played division bracket. */
export function regionGames(rounds: BracketGame[][], region: Region): BracketGame[][] {
  const regionIndex = FINAL_FOUR_ORDER.indexOf(region)
  const regionRounds = Math.log2(rounds[0]!.length * 2) - 2
  return rounds.slice(0, regionRounds).map(games => {
    const per = games.length / 4
    return games.slice(regionIndex * per, (regionIndex + 1) * per)
  })
}

/** A committed seeding snapshot replays into the same bracket, independent of later standings. */
export function bracketFromSeeds(seeded: SeededTeam[], scores: GameScores = {}, overrides: Record<string, string> = {}): BracketGame[][] {
  return playBracket(divisionFirstRound(seeded), scores, overrides)
}

export type WeekScore = { points: number; final: boolean }

export type RoundPlan = {
  round: number
  games: Array<BracketGame & { key: string }>
  /** Reasons the round cannot be advanced yet. Empty means ready. */
  blockers: string[]
  /** Games level on points that nothing but the commissioner can decide. */
  needsReview: string[]
  /** Scores to commit for this round, keyed by game. */
  scores: GameScores
}

/**
 * What advancing `round` would do, from each team's score for that week.
 * A missing or non-final score is never read as zero: it blocks the round.
 */
export function planRound(rounds: BracketGame[][], round: number, weekScores: Map<string, WeekScore>, overrides: Record<string, string> = {}): RoundPlan {
  const games = rounds[round - 1]
  if (!games) return { round, games: [], blockers: ['That round does not exist.'], needsReview: [], scores: {} }
  const blockers: string[] = []
  const scores: GameScores = {}
  let missing = 0, provisional = 0, waiting = 0
  const planned = games.map(g => {
    const key = gameKey(round, g.index)
    if (!g.a || !g.b) { waiting++; return { ...g, key } }
    const sa = weekScores.get(g.a.id), sb = weekScores.get(g.b.id)
    if (!sa || !sb) { missing++; return { ...g, key } }
    if (!sa.final || !sb.final) provisional++
    scores[key] = { a: sa.points, b: sb.points }
    const decided = decideGame(g.a, g.b, sa.points, sb.points)
    const override = overrides[key]
    const winner = decided.decidedBy === 'review' && override ? (override === g.a.id ? g.a : override === g.b.id ? g.b : null) : decided.winner
    return { ...g, key, scoreA: sa.points, scoreB: sb.points, winner, decidedBy: decided.decidedBy }
  })
  if (waiting) blockers.push(`${waiting} game${waiting === 1 ? ' is' : 's are'} still waiting on the previous round.`)
  if (missing) blockers.push(`${missing} game${missing === 1 ? ' has' : 's have'} a missing score.`)
  if (provisional) blockers.push(`${provisional} game${provisional === 1 ? ' is' : 's are'} not final yet.`)
  const needsReview = planned.filter(g => g.decidedBy === 'review' && !g.winner).map(g => g.key)
  if (needsReview.length) blockers.push(`${needsReview.length} tied game${needsReview.length === 1 ? ' needs' : 's need'} a commissioner decision.`)
  return { round, games: planned, blockers, needsReview, scores }
}

// ── calendar ─────────────────────────────────────────────────────────────────

export type ScheduleWeek = { week: number; label: string; kind: 'regular' | 'division' | 'championship'; field: number }

export function roundLabel(field: number): string {
  if (field === 16) return 'Sweet 16'
  if (field === 8) return 'Region finals'
  if (field === 4) return 'Division final four'
  if (field === 2) return 'Division final'
  return 'Round of ' + field
}

/** Last week = season length − 1; the division bracket fills the weeks before it. */
export function divisionsCalendar(settings: Pick<FormatSettings, 'autoBids' | 'wildcardSpots' | 'seasonLength'>) {
  const bracketSize = settings.autoBids + settings.wildcardSpots
  const divisionRounds = Math.log2(bracketSize)
  const lastWeek = settings.seasonLength - 1
  const bracketStartWeek = lastWeek - divisionRounds
  const weeks: ScheduleWeek[] = []
  for (let r = 0; r < divisionRounds; r++) {
    const field = bracketSize / 2 ** r
    weeks.push({ week: bracketStartWeek + r, label: roundLabel(field), kind: 'division', field })
  }
  weeks.push({ week: lastWeek, label: 'Championship', kind: 'championship', field: 2 })
  return { bracketSize, lastWeek, bracketStartWeek, regularSeason: { start: 1, end: bracketStartWeek - 1 }, seedingLocksAfter: bracketStartWeek - 1, weeks }
}

// ── settings validation ──────────────────────────────────────────────────────

export type SettingsReport = { errors: string[]; warnings: string[]; bracketSize: number; divisionSize: number; totalTeams: number; leagues: number; missOut: number }

export function validateFormatSettings(s: FormatSettings): SettingsReport {
  const errors: string[] = [], warnings: string[] = []
  const bracketSize = s.autoBids + s.wildcardSpots
  const divisionSize = s.conferencesPerDivision * s.teamsPerConference
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi
  if (!inRange(s.conferencesPerDivision, 4, 10)) errors.push('Choose 4 to 10 conferences per division.')
  if (!inRange(s.teamsPerConference, 8, 14)) errors.push('Choose 8 to 14 teams per conference.')
  if (!inRange(s.autoBids, 24, 56)) errors.push('Choose 24 to 56 automatic bids.')
  if (!inRange(s.wildcardSpots, 4, 16)) errors.push('Choose 4 to 16 wildcard spots.')
  if (s.regions !== 4) errors.push('This format always uses four regions.')
  if (s.autoBids % 4 !== 0) errors.push('Automatic bids must fill whole seed lines (a multiple of 4).')
  if (s.wildcardSpots % 4 !== 0) errors.push('Wildcard spots must fill whole seed lines (a multiple of 4).')
  if (!(VALID_BRACKET_SIZES as readonly number[]).includes(bracketSize)) {
    errors.push(`Automatic bids plus wildcard spots must make a 32, 64 or 128-team bracket. Right now they make ${bracketSize}.`)
  } else if (divisionSize < bracketSize) {
    errors.push(`Each division has ${divisionSize} teams, too few for a ${bracketSize}-team bracket.`)
  } else if (divisionSize < bracketSize + s.wildcardSpots) {
    warnings.push(`Only ${divisionSize - bracketSize} teams sit below the bubble, so fewer than ${s.wildcardSpots} top scorers can join the wildcard pool.`)
  }
  if (s.seasonLength - 1 - Math.log2(Math.max(2, bracketSize)) < 4) warnings.push('The regular season is very short for this bracket size.')
  if (s.sport === 'NBA') warnings.push('NBA weeks are a planning grid until the season calendar is verified.')
  return { errors, warnings, bracketSize, divisionSize, totalTeams: divisionSize * 2, leagues: s.conferencesPerDivision * 2, missOut: Math.max(0, divisionSize - bracketSize) }
}

// ── conference points ────────────────────────────────────────────────────────

export type ConferenceTotal = { conferenceId: string; points: number; teams: number; inBracket: number }

/** Bragging rights only — never feeds seeding. */
export function conferencePoints(teams: DivisionTeamInput[], seeded: Array<{ id: string }>): ConferenceTotal[] {
  const inBracket = new Set(seeded.map(t => t.id))
  const totals = new Map<string, ConferenceTotal>()
  for (const t of teams) {
    const row = totals.get(t.conferenceId) ?? { conferenceId: t.conferenceId, points: 0, teams: 0, inBracket: 0 }
    row.points += t.points; row.teams += 1; if (inBracket.has(t.id)) row.inBracket += 1
    totals.set(t.conferenceId, row)
  }
  return [...totals.values()].map(r => ({ ...r, points: round1(r.points) }))
}

/** Seeding can be committed only when every score is final. */
export function seedingBlockers(teams: DivisionTeamInput[]): string[] {
  const provisional = teams.filter(t => t.provisional)
  return provisional.length ? [`${provisional.length} team${provisional.length === 1 ? ' has' : 's have'} missing or provisional scores.`] : []
}

// ── one call for a division ──────────────────────────────────────────────────

export type DivisionResult = {
  ranked: RankedTeam[]
  pool: WildcardPool
  seeded: SeededTeam[] | null
  status: Record<string, BidStatus>
  conferences: ConferenceTotal[]
  bracket: BracketGame[][] | null
  /** Unresolved ties that change who is in or out, by team id. */
  reviewTies: string[]
}

export function computeDivision(teams: DivisionTeamInput[], settings: Pick<FormatSettings, 'autoBids' | 'wildcardSpots'>, scores: GameScores = {}, overrides: Record<string, string> = {}): DivisionResult {
  const ranked = rankDivision(teams)
  const pool = buildWildcardPool(ranked, settings.autoBids, settings.wildcardSpots)
  const bracketSize = settings.autoBids + settings.wildcardSpots
  const enough = ranked.length >= bracketSize && pool.entries.filter(e => e.in).length === settings.wildcardSpots
  const seeded = enough ? seedDivision(ranked, pool, settings.autoBids) : null
  const status = Object.fromEntries(ranked.map(t => [t.id, bidStatus(t, settings.autoBids, pool)]))
  const bracket = seeded ? playBracket(divisionFirstRound(seeded), scores, overrides) : null
  const reviewTies = [
    ...ranked.filter(t => t.tiebreak === 'review' && Math.abs(t.rank - settings.autoBids - 0.5) <= 1).map(t => t.id),
    ...pool.entries.filter(e => e.poolTiebreak === 'review' && Math.abs(e.poolRank - settings.wildcardSpots - 0.5) <= 1).map(e => e.id),
  ]
  return { ranked, pool, seeded, status, conferences: conferencePoints(teams, seeded ?? []), bracket, reviewTies: [...new Set(reviewTies)] }
}

/** The championship: Division A champion v Division B champion. */
export function championshipGame(champA: BracketEntrant | null, champB: BracketEntrant | null, score?: { a: number; b: number }, override?: string): BracketGame {
  const game: BracketGame = { round: 1, index: 0, a: champA, b: champB, scoreA: score?.a ?? null, scoreB: score?.b ?? null, winner: null, decidedBy: null }
  if (!champA || !champB || !score) return game
  const decided = decideGame(champA, champB, score.a, score.b)
  if (decided.decidedBy === 'review' && override && (override === champA.id || override === champB.id)) return { ...game, winner: override === champA.id ? champA : champB, decidedBy: 'review' }
  return { ...game, ...decided }
}
