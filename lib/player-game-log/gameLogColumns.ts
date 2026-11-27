/**
 * Per-game log columns for the daily sports (NHL, NBA, NCAAB, MLB, SOCCER).
 *
 * Pure and client-safe: the loader uses `computeGameLogValues` on the server, the table uses
 * `summarizeGameLog` / `formatGameLogValue` in the browser, and both read the SAME column list —
 * so a column can never be computed under one name and displayed under another.
 *
 * WHY A FIXED ORDER PER GROUP (2026-11-27). Yahoo's late-2026 refresh drew a specific set of
 * complaints from hockey managers, and the column list answers them directly:
 *   - time on ice was moved to the far right → it is the FIRST stat column here;
 *   - hits and blocks swapped places between forwards and defensemen, and D lost faceoffs →
 *     every skater gets the SAME columns in the SAME order, keyed by box GROUP (`skaters`),
 *     never by position;
 *   - the log stopped showing the game's score → the loader joins the final score per row.
 *
 * Every vendor field read below is a key in a committed fixture
 * (`contracts/rolling-insights/fixtures/live.{NHL,NBA,NCAABB,MLB}.json`) or, for soccer, the
 * production-measured field list in `lib/scoring-runtime/soccerStatNormalization.ts`. Canonical
 * keys come from the sport's normalizer, so scoring and this table agree on what a stat is.
 */

export type GameLogSport = 'NHL' | 'NBA' | 'NCAAB' | 'MLB' | 'SOCCER'

export const GAME_LOG_SPORTS: readonly GameLogSport[] = ['NHL', 'NBA', 'NCAAB', 'MLB', 'SOCCER']

export function isGameLogSport(sport: string | null | undefined): sport is GameLogSport {
  return (GAME_LOG_SPORTS as readonly string[]).includes(String(sport ?? '').trim().toUpperCase())
}

/** A cell's value. `split` is made/attempted (FG 5-12); `text` never aggregates. */
export type GameLogValue = number | { made: number; att: number } | string | null

/**
 * How a column's summary row is formed.
 * - `avg`:   mean of the games that carry a value.
 * - `split`: mean made and mean attempted, shown "5.2-11.8".
 * - `ratio`: sum(num) / sum(den) across games — a rate is never averaged game by game.
 * - `minutes`: mean of decimal minutes, shown as a clock.
 * - `count`: how many games carry a truthy value (decisions, clean sheets).
 * - `none`:  no summary.
 */
export type GameLogAggregate =
  | { kind: 'avg' }
  | { kind: 'split' }
  | { kind: 'ratio'; num: string; den: string; scale?: number }
  | { kind: 'minutes' }
  | { kind: 'count' }
  | { kind: 'none' }

export type GameLogFormat = 'int' | 'signed' | 'dec1' | 'pct3' | 'clock' | 'innings' | 'split' | 'text'

export interface GameLogColumn {
  key: string
  label: string
  /** Full name for the header tooltip / screen readers. */
  title: string
  format: GameLogFormat
  aggregate: GameLogAggregate
  /** Hidden in the compact (player card) view. */
  compactHidden?: boolean
}

/** One row's inputs: the normalizer's canonical stats plus the vendor's raw line. */
export interface GameLogInputs {
  stats: Record<string, number>
  raw: Record<string, unknown>
}

interface ColumnDef extends GameLogColumn {
  get: (i: GameLogInputs) => GameLogValue
}

const n = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }
  return null
}

/** "mm:ss" or a plain number of minutes → decimal minutes. */
export function clockToMinutes(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim()
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(s)
  if (m) return Number(m[1]) + Number(m[2]) / 60
  return n(s)
}

const stat = (key: string) => (i: GameLogInputs): number | null => n(i.stats[key])
const raw = (key: string) => (i: GameLogInputs): number | null => n(i.raw[key])
const split = (made: string, att: string) => (i: GameLogInputs): GameLogValue => {
  const m = n(i.raw[made])
  const a = n(i.raw[att])
  return m == null || a == null ? null : { made: m, att: a }
}

const AVG: GameLogAggregate = { kind: 'avg' }

// ── NHL ────────────────────────────────────────────────────────────────────────

const NHL_SKATERS: ColumnDef[] = [
  { key: 'toi', label: 'TOI', title: 'Time on ice', format: 'clock', aggregate: { kind: 'minutes' }, get: (i) => clockToMinutes(i.raw.time_on_ice) },
  { key: 'g', label: 'G', title: 'Goals', format: 'int', aggregate: AVG, get: stat('g') },
  { key: 'a', label: 'A', title: 'Assists', format: 'int', aggregate: AVG, get: stat('a') },
  { key: 'pts', label: 'PTS', title: 'Points', format: 'int', aggregate: AVG, get: stat('pts') },
  { key: 'plusminus', label: '+/-', title: 'Plus/minus', format: 'signed', aggregate: AVG, get: stat('plusminus') },
  { key: 'sog', label: 'SOG', title: 'Shots on goal', format: 'int', aggregate: AVG, get: stat('sog') },
  { key: 'ppp', label: 'PPP', title: 'Power-play points', format: 'int', aggregate: AVG, get: stat('ppp') },
  { key: 'shp', label: 'SHP', title: 'Short-handed points', format: 'int', aggregate: AVG, get: stat('shp'), compactHidden: true },
  { key: 'hits', label: 'HIT', title: 'Hits', format: 'int', aggregate: AVG, get: stat('hits') },
  { key: 'blks', label: 'BLK', title: 'Blocked shots', format: 'int', aggregate: AVG, get: stat('blks') },
  { key: 'pim', label: 'PIM', title: 'Penalty minutes', format: 'int', aggregate: AVG, get: stat('pim'), compactHidden: true },
  // Defensemen keep the column (usually 0) so every skater reads the same way.
  { key: 'fow', label: 'FOW', title: 'Faceoffs won', format: 'int', aggregate: AVG, get: stat('fow'), compactHidden: true },
]

function goalieDecision(i: GameLogInputs): string | null {
  if ((i.stats.g_win ?? 0) > 0) return 'W'
  if ((i.stats.g_otl ?? 0) > 0) return 'OTL'
  if ((i.stats.g_loss ?? 0) > 0) return 'L'
  return null
}

const NHL_GOALIES: ColumnDef[] = [
  { key: 'toi', label: 'TOI', title: 'Time on ice', format: 'clock', aggregate: { kind: 'minutes' }, get: (i) => clockToMinutes(i.raw.time_on_ice) },
  { key: 'dec', label: 'DEC', title: 'Decision', format: 'text', aggregate: { kind: 'none' }, get: goalieDecision },
  { key: 'g_sa', label: 'SA', title: 'Shots against', format: 'int', aggregate: AVG, get: (i) => n(i.stats.g_sa) ?? (i.stats.g_sv != null ? i.stats.g_sv + (i.stats.g_ga ?? 0) : null) },
  { key: 'g_sv', label: 'SV', title: 'Saves', format: 'int', aggregate: AVG, get: stat('g_sv') },
  { key: 'g_ga', label: 'GA', title: 'Goals against', format: 'int', aggregate: AVG, get: stat('g_ga') },
  { key: 'svpct', label: 'SV%', title: 'Save percentage', format: 'pct3', aggregate: { kind: 'ratio', num: 'g_sv', den: 'g_sa' }, get: (i) => {
    const sv = n(i.stats.g_sv)
    const sa = n(i.stats.g_sa) ?? (sv != null ? sv + (i.stats.g_ga ?? 0) : null)
    return sv == null || !sa ? null : sv / sa
  } },
  { key: 'g_so', label: 'SO', title: 'Shutout', format: 'int', aggregate: { kind: 'count' }, get: stat('g_so') },
]

// ── Basketball ─────────────────────────────────────────────────────────────────

const BASKETBALL: ColumnDef[] = [
  { key: 'min', label: 'MIN', title: 'Minutes', format: 'clock', aggregate: { kind: 'minutes' }, get: (i) => clockToMinutes(i.raw.minutes) },
  { key: 'pts', label: 'PTS', title: 'Points', format: 'int', aggregate: AVG, get: stat('pts') },
  { key: 'reb', label: 'REB', title: 'Rebounds', format: 'int', aggregate: AVG, get: stat('reb') },
  { key: 'ast', label: 'AST', title: 'Assists', format: 'int', aggregate: AVG, get: stat('ast') },
  { key: 'stl', label: 'STL', title: 'Steals', format: 'int', aggregate: AVG, get: stat('stl') },
  { key: 'blk', label: 'BLK', title: 'Blocks', format: 'int', aggregate: AVG, get: stat('blk') },
  { key: 'threes', label: '3PM', title: 'Three-pointers made', format: 'int', aggregate: AVG, get: stat('threes') },
  { key: 'to', label: 'TO', title: 'Turnovers', format: 'int', aggregate: AVG, get: stat('to') },
  { key: 'fg', label: 'FG', title: 'Field goals made-attempted', format: 'split', aggregate: { kind: 'split' }, get: split('field_goals_made', 'field_goals_attempted'), compactHidden: true },
  { key: 'ft', label: 'FT', title: 'Free throws made-attempted', format: 'split', aggregate: { kind: 'split' }, get: split('free_throws_made', 'free_throws_attempted'), compactHidden: true },
  { key: 'pf', label: 'PF', title: 'Personal fouls', format: 'int', aggregate: AVG, get: raw('fouls'), compactHidden: true },
]

// ── MLB ────────────────────────────────────────────────────────────────────────

const MLB_BATTING: ColumnDef[] = [
  { key: 'ab', label: 'AB', title: 'At bats', format: 'int', aggregate: AVG, get: stat('ab') },
  { key: 'r', label: 'R', title: 'Runs', format: 'int', aggregate: AVG, get: stat('r') },
  { key: 'h', label: 'H', title: 'Hits', format: 'int', aggregate: AVG, get: stat('h') },
  { key: 'hr', label: 'HR', title: 'Home runs', format: 'int', aggregate: AVG, get: stat('hr') },
  { key: 'rbi', label: 'RBI', title: 'Runs batted in', format: 'int', aggregate: AVG, get: stat('rbi') },
  { key: 'bb', label: 'BB', title: 'Walks', format: 'int', aggregate: AVG, get: stat('bb') },
  { key: 'bat_so', label: 'K', title: 'Strikeouts', format: 'int', aggregate: AVG, get: stat('bat_so') },
  { key: 'sb', label: 'SB', title: 'Stolen bases', format: 'int', aggregate: AVG, get: stat('sb') },
  { key: 'tb', label: 'TB', title: 'Total bases', format: 'int', aggregate: AVG, get: stat('tb'), compactHidden: true },
  { key: 'avg', label: 'AVG', title: 'Batting average', format: 'pct3', aggregate: { kind: 'ratio', num: 'h', den: 'ab' }, get: (i) => {
    const h = n(i.stats.h), ab = n(i.stats.ab)
    return h == null || !ab ? null : h / ab
  }, compactHidden: true },
]

function pitcherDecision(i: GameLogInputs): string | null {
  if ((i.stats.w ?? 0) > 0) return 'W'
  if ((i.stats.l ?? 0) > 0) return 'L'
  if ((i.stats.sv ?? 0) > 0) return 'SV'
  if ((i.stats.hld ?? 0) > 0) return 'HLD'
  if ((i.stats.bs ?? 0) > 0) return 'BS'
  return null
}

const MLB_PITCHING: ColumnDef[] = [
  { key: 'dec', label: 'DEC', title: 'Decision', format: 'text', aggregate: { kind: 'none' }, get: pitcherDecision },
  // True innings (5.667), shown back in baseball notation (5.2).
  { key: 'ip', label: 'IP', title: 'Innings pitched', format: 'innings', aggregate: AVG, get: stat('ip') },
  { key: 'p_h', label: 'H', title: 'Hits allowed', format: 'int', aggregate: AVG, get: stat('p_h') },
  { key: 'er', label: 'ER', title: 'Earned runs', format: 'int', aggregate: AVG, get: stat('er') },
  { key: 'p_bb', label: 'BB', title: 'Walks allowed', format: 'int', aggregate: AVG, get: stat('p_bb') },
  { key: 'so', label: 'K', title: 'Strikeouts', format: 'int', aggregate: AVG, get: stat('so') },
  { key: 'p_hr', label: 'HR', title: 'Home runs allowed', format: 'int', aggregate: AVG, get: stat('p_hr'), compactHidden: true },
  { key: 'pitches', label: 'PC', title: 'Pitch count', format: 'int', aggregate: AVG, get: raw('pitches'), compactHidden: true },
  { key: 'era', label: 'ERA', title: 'Earned run average', format: 'dec1', aggregate: { kind: 'ratio', num: 'er', den: 'ip', scale: 9 }, get: (i) => {
    const er = n(i.stats.er), ip = n(i.stats.ip)
    return er == null || !ip ? null : (er * 9) / ip
  }, compactHidden: true },
]

// ── Soccer ─────────────────────────────────────────────────────────────────────

const SOCCER_FIELDERS: ColumnDef[] = [
  { key: 'minutes_played', label: 'MIN', title: 'Minutes played', format: 'int', aggregate: AVG, get: stat('minutes_played') },
  { key: 'goals', label: 'G', title: 'Goals', format: 'int', aggregate: AVG, get: stat('goals') },
  { key: 'assists', label: 'A', title: 'Assists', format: 'int', aggregate: AVG, get: stat('assists') },
  { key: 'shots', label: 'SH', title: 'Shots', format: 'int', aggregate: AVG, get: stat('shots') },
  { key: 'shots_on_target', label: 'SOT', title: 'Shots on target', format: 'int', aggregate: AVG, get: stat('shots_on_target') },
  { key: 'fouls_drawn', label: 'FD', title: 'Fouls drawn', format: 'int', aggregate: AVG, get: stat('fouls_drawn'), compactHidden: true },
  { key: 'yellow_card', label: 'YC', title: 'Yellow cards', format: 'int', aggregate: { kind: 'count' }, get: stat('yellow_card') },
  { key: 'red_card', label: 'RC', title: 'Red cards', format: 'int', aggregate: { kind: 'count' }, get: stat('red_card'), compactHidden: true },
  { key: 'clean_sheet_def', label: 'CS', title: 'Clean sheet (defenders, 60+ minutes)', format: 'int', aggregate: { kind: 'count' }, get: stat('clean_sheet_def'), compactHidden: true },
]

const SOCCER_KEEPERS: ColumnDef[] = [
  { key: 'minutes_played', label: 'MIN', title: 'Minutes played', format: 'int', aggregate: AVG, get: stat('minutes_played') },
  { key: 'saves', label: 'SV', title: 'Saves', format: 'int', aggregate: AVG, get: stat('saves') },
  { key: 'gk_goals_against', label: 'GA', title: 'Goals against', format: 'int', aggregate: AVG, get: stat('gk_goals_against') },
  { key: 'clean_sheet_gk', label: 'CS', title: 'Clean sheet (60+ minutes)', format: 'int', aggregate: { kind: 'count' }, get: stat('clean_sheet_gk') },
  { key: 'pen_save', label: 'PKS', title: 'Penalties saved', format: 'int', aggregate: { kind: 'count' }, get: stat('pen_save'), compactHidden: true },
  { key: 'yellow_card', label: 'YC', title: 'Yellow cards', format: 'int', aggregate: { kind: 'count' }, get: stat('yellow_card'), compactHidden: true },
]

/** Box group → columns, per sport. Basketball has no group level (`all`). */
const COLUMNS: Record<GameLogSport, Record<string, ColumnDef[]>> = {
  NHL: { skaters: NHL_SKATERS, goalies: NHL_GOALIES },
  NBA: { all: BASKETBALL },
  NCAAB: { all: BASKETBALL },
  MLB: { batting: MLB_BATTING, pitching: MLB_PITCHING },
  SOCCER: { fielders: SOCCER_FIELDERS, goalkeepers: SOCCER_KEEPERS },
}

export const GROUP_LABELS: Record<string, string> = {
  skaters: 'Skater',
  goalies: 'Goalie',
  batting: 'Batting',
  pitching: 'Pitching',
  fielders: 'Outfield',
  goalkeepers: 'Goalkeeper',
  all: 'Game log',
}

function defsFor(sport: GameLogSport, group: string): ColumnDef[] | null {
  return COLUMNS[sport]?.[group] ?? null
}

/** The display columns for a sport's group (no getters — safe to send to the client). */
export function gameLogColumns(sport: GameLogSport, group: string): GameLogColumn[] {
  return (defsFor(sport, group) ?? []).map(({ get: _get, ...col }) => col)
}

export function gameLogGroups(sport: GameLogSport): string[] {
  return Object.keys(COLUMNS[sport] ?? {})
}

/** One row's cell values, keyed by column key, or null when the group has no columns. */
export function computeGameLogValues(
  sport: GameLogSport,
  group: string,
  inputs: GameLogInputs,
): Record<string, GameLogValue> | null {
  const defs = defsFor(sport, group)
  if (!defs) return null
  const out: Record<string, GameLogValue> = {}
  for (const def of defs) out[def.key] = def.get(inputs)
  return out
}

/**
 * Whether the line is a real appearance. The NHL box lists the dressed backup goalie at all zeros,
 * and basketball lists DNPs at zero minutes — shown as DNP, never counted in an average.
 */
export function gameLogLinePlayed(sport: GameLogSport, group: string, inputs: GameLogInputs): boolean {
  if (sport === 'NHL' && group === 'goalies') {
    if ((clockToMinutes(inputs.raw.time_on_ice) ?? 0) > 0) return true
    return ['g_sa', 'g_sv', 'g_ga', 'g_win', 'g_loss', 'g_otl'].some((k) => (inputs.stats[k] ?? 0) > 0)
  }
  if (sport === 'NBA' || sport === 'NCAAB') {
    const min = clockToMinutes(inputs.raw.minutes)
    if (min != null) return min > 0
    return Object.values(inputs.stats).some((v) => v > 0)
  }
  if (sport === 'SOCCER') return (inputs.stats.minutes_played ?? 0) > 0
  if (sport === 'MLB' && group === 'pitching') return (inputs.stats.ip ?? 0) > 0 || (inputs.stats.p_h ?? 0) > 0 || (inputs.stats.p_bb ?? 0) > 0
  if (sport === 'MLB' && group === 'batting') return (inputs.stats.ab ?? 0) > 0 || (inputs.stats.bb ?? 0) > 0 || (inputs.stats.hbp ?? 0) > 0 || (inputs.stats.r ?? 0) > 0
  return true
}

// ── Summary rows ───────────────────────────────────────────────────────────────

export interface GameLogRowLike {
  played: boolean
  values: Record<string, GameLogValue>
  /** Ratio inputs, carried separately because the display value is already a rate. */
  ratioInputs?: Record<string, number>
}

/** The raw numbers a `ratio` column needs, per row. Taken from the row's canonical stats. */
export function ratioInputsFor(sport: GameLogSport, group: string, stats: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const def of defsFor(sport, group) ?? []) {
    if (def.aggregate.kind !== 'ratio') continue
    const { num, den } = def.aggregate
    let a = stats[num]
    let b = stats[den]
    if (den === 'g_sa' && b == null && stats.g_sv != null) b = stats.g_sv + (stats.g_ga ?? 0)
    if (a != null) out[num] = a
    if (b != null) out[den] = b
  }
  return out
}

/** Average each column over the PLAYED rows given (callers slice to last 5 / 10 / season). */
export function summarizeGameLog(columns: GameLogColumn[], rows: GameLogRowLike[]): Record<string, GameLogValue> {
  const played = rows.filter((r) => r.played)
  const out: Record<string, GameLogValue> = {}
  for (const col of columns) {
    const agg = col.aggregate
    if (agg.kind === 'none') {
      out[col.key] = null
      continue
    }
    if (agg.kind === 'ratio') {
      let num = 0, den = 0
      for (const r of played) {
        const a = r.ratioInputs?.[agg.num], b = r.ratioInputs?.[agg.den]
        if (a == null || b == null) continue
        num += a
        den += b
      }
      out[col.key] = den > 0 ? (num * (agg.scale ?? 1)) / den : null
      continue
    }
    if (agg.kind === 'split') {
      let m = 0, a = 0, k = 0
      for (const r of played) {
        const v = r.values[col.key]
        if (v && typeof v === 'object') { m += v.made; a += v.att; k++ }
      }
      out[col.key] = k ? { made: m / k, att: a / k } : null
      continue
    }
    if (agg.kind === 'count') {
      let c = 0, seen = 0
      for (const r of played) {
        const v = r.values[col.key]
        if (typeof v === 'number') { seen++; if (v > 0) c++ }
      }
      out[col.key] = seen ? c : null
      continue
    }
    let sum = 0, k = 0
    for (const r of played) {
      const v = r.values[col.key]
      if (typeof v === 'number') { sum += v; k++ }
    }
    out[col.key] = k ? sum / k : null
  }
  return out
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function oneDecimal(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1)
}

/** `summary` true: averages get a decimal where a game cell would show an integer. */
export function formatGameLogValue(col: GameLogColumn, value: GameLogValue, summary = false): string {
  if (value == null) return '–'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    return summary ? `${oneDecimal(value.made)}-${oneDecimal(value.att)}` : `${value.made}-${value.att}`
  }
  if (summary && col.aggregate.kind === 'count') return String(value)
  switch (col.format) {
    case 'clock': {
      const total = Math.round(value * 60)
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
    }
    case 'pct3': {
      const s = value.toFixed(3)
      return value < 1 ? s.replace(/^0/, '') : s
    }
    case 'innings': {
      const whole = Math.floor(value + 1e-9)
      const outs = Math.round((value - whole) * 3)
      return outs === 3 ? `${whole + 1}.0` : `${whole}.${outs}`
    }
    case 'dec1':
      return value.toFixed(2)
    case 'signed': {
      const s = summary ? oneDecimal(value) : String(Math.round(value))
      return value > 0 ? `+${s}` : s
    }
    default:
      return summary ? oneDecimal(value) : String(Math.round(value * 100) / 100)
  }
}
