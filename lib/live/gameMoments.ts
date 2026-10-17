/**
 * Live game moments — pure detection, no I/O. Fed one ESPN scoreboard row at a time
 * (`LiveScoreRow` from lib/sports-live-scores-service), returns the moments that row shows NOW.
 * Whether a moment was already sent is the ledger's business (lib/live/gameMomentAlerts.ts).
 *
 * THE MOMENTS
 *   halftime       basketball, football, soccer — ESPN says STATUS_HALFTIME
 *   end_period     hockey, the 1st and 2nd intermissions — ESPN says STATUS_END_PERIOD
 *   seventh_inning baseball, the 7th inning is under way
 *   close_late     the game is in its last minutes (or innings) and within one score — see CLOSE
 *   overtime       play has gone past regulation (extra innings for baseball)
 *   final          ESPN says the game is complete
 *
 * ⚠ EVERY THRESHOLD IS A PUSH TO SOMEONE'S PHONE. "Close" is deliberately tight — one possession in
 * basketball, one goal in hockey and soccer, two runs in baseball, one score in football — because a
 * "close game" alert for a game that ends in a blowout teaches people to ignore the category.
 *
 * ⚠ ESPN's `displayClock` is a countdown in basketball, football and hockey ("4:32", "0.4") and a
 * count-up minute in soccer ("78'", "90'+3'"). `clockSeconds` reads the first; `soccerMinute` the
 * second. An unreadable clock is "unknown", and an unknown clock never makes a game close.
 */

export type MomentKind = 'halftime' | 'end_period' | 'seventh_inning' | 'close_late' | 'overtime' | 'final'

/** The fields this module reads — a structural subset of `LiveScoreRow`. */
export type MomentRow = {
  gameId: string
  homeTeam: string
  homeTeamFull: string
  awayTeam: string
  awayTeamFull: string
  homeScore: number | null
  awayScore: number | null
  status: string
  statusDetail: string
  period: number
  clock: string
  completed: boolean
  eventName?: string | null
}

export type GameMoment = {
  kind: MomentKind
  sport: string
  gameId: string
  /** Postseason game: the round label says so. Playoff checkpoints reach a wider audience. */
  postseason: boolean
}

/** Regulation length in periods (innings for baseball, halves for college basketball and soccer). */
const REGULATION: Record<string, number> = { NBA: 4, WNBA: 4, NCAAB: 2, NFL: 4, NCAAF: 4, NHL: 3, MLB: 9, SOCCER: 2 }

const HALVES = new Set(['NBA', 'WNBA', 'NCAAB', 'NFL', 'NCAAF', 'SOCCER'])

/** ESPN statuses that mean the ball is in play (or a break inside the game). */
const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_FIRST_HALF',
  'STATUS_SECOND_HALF',
  'STATUS_OVERTIME',
  'STATUS_END_OF_EXTRATIME',
  'STATUS_SHOOTOUT',
  'STATUS_DELAYED',
])

/**
 * A round label means a postseason game: ESPN puts "ALDS - Game 3", "East 1st Round - Game 2",
 * "Stanley Cup Final - Game 1", "Wild Card", "CFP Quarterfinal" in the competition note.
 */
const POSTSEASON =
  /\b(playoffs?|play-in|wild card|wildcard|division series|championship series|ALDS|NLDS|ALCS|NLCS|world series|stanley cup|finals?|conference (semi)?finals?|round|game \d|super bowl|divisional|bowl|CFP|semifinal|quarterfinal|elite eight|final four|sweet 16|cup)\b/i

export function isPostseasonLabel(label: string | null | undefined): boolean {
  if (!label) return false
  // A plain "Team A at Team B" event name is not a round.
  if (/^\S.* (at|vs\.?|@) .*\S$/i.test(label) && !POSTSEASON.test(label)) return false
  return POSTSEASON.test(label)
}

/** Seconds left on a countdown clock ("4:32" → 272, "0.4" → 0.4). null when unreadable. */
export function clockSeconds(clock: string | null | undefined): number | null {
  const c = String(clock ?? '').trim()
  const mmss = /^(\d{1,2}):(\d{2})(\.\d+)?$/.exec(c)
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  const ss = /^(\d{1,2})(\.\d+)?$/.exec(c)
  if (ss) return Number(c)
  return null
}

/** The match minute on a soccer clock ("78'" → 78, "90'+3'" → 93). null when unreadable. */
export function soccerMinute(clock: string | null | undefined): number | null {
  const m = /^(\d{1,3})'?(?:\s*\+\s*(\d{1,2})'?)?/.exec(String(clock ?? '').trim())
  if (!m) return null
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0)
}

function isLive(row: MomentRow): boolean {
  return !row.completed && LIVE_STATUSES.has(row.status)
}

/** In the last minutes of regulation (or later) and within one score. */
export function isCloseLate(sport: string, row: MomentRow): boolean {
  if (!isLive(row) || row.status === 'STATUS_HALFTIME' || row.status === 'STATUS_END_PERIOD') return false
  if (row.homeScore == null || row.awayScore == null) return false
  const margin = Math.abs(row.homeScore - row.awayScore)
  const reg = REGULATION[sport]
  if (!reg) return false
  const p = row.period
  const secs = clockSeconds(row.clock)
  switch (sport) {
    case 'NBA':
    case 'WNBA':
      return p >= reg && secs != null && secs <= 300 && margin <= 5
    case 'NCAAB':
      return p >= reg && secs != null && secs <= 300 && margin <= 5
    case 'NFL':
    case 'NCAAF':
      return p >= reg && secs != null && secs <= 300 && margin <= 8
    case 'NHL':
      return p >= reg && (p > reg || (secs != null && secs <= 600)) && margin <= 1
    case 'MLB':
      // From the 8th inning on, within two runs.
      return p >= 8 && margin <= 2
    case 'SOCCER': {
      const minute = soccerMinute(row.clock)
      return minute != null && minute >= 75 && margin <= 1
    }
    default:
      return false
  }
}

/** Every moment this row shows right now (usually zero or one). */
export function detectGameMoments(sport: string, row: MomentRow): GameMoment[] {
  const S = sport.toUpperCase()
  const reg = REGULATION[S]
  if (!reg) return []
  const base = { sport: S, gameId: row.gameId, postseason: isPostseasonLabel(row.eventName) }
  const out: GameMoment[] = []

  if (row.completed || row.status === 'STATUS_FINAL' || row.status === 'STATUS_FULL_TIME') {
    if (row.homeScore != null && row.awayScore != null) out.push({ kind: 'final', ...base })
    return out
  }
  if (!isLive(row)) return out

  if (row.status === 'STATUS_HALFTIME' && HALVES.has(S)) out.push({ kind: 'halftime', ...base })
  if (S === 'NHL' && row.status === 'STATUS_END_PERIOD' && row.period >= 1 && row.period < reg) {
    out.push({ kind: 'end_period', ...base })
  }
  if (S === 'MLB' && row.period === 7) out.push({ kind: 'seventh_inning', ...base })
  if (row.period > reg || row.status === 'STATUS_OVERTIME' || row.status === 'STATUS_SHOOTOUT') {
    out.push({ kind: 'overtime', ...base })
  }
  // Overtime already says "close"; two buzzes for one moment is one too many.
  else if (isCloseLate(S, row)) out.push({ kind: 'close_late', ...base })
  return out
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Push/email text for a moment. Only the scoreboard's own facts — names, score, clock. */
export function momentText(m: GameMoment, row: MomentRow): { title: string; body: string } {
  const away = row.awayTeamFull || row.awayTeam
  const home = row.homeTeamFull || row.homeTeam
  const a = row.awayScore ?? 0
  const h = row.homeScore ?? 0
  const line = `${away} ${a}, ${home} ${h}`
  const leader = a === h ? null : a > h ? away : home
  const round = m.postseason && row.eventName ? ` · ${row.eventName}` : ''
  switch (m.kind) {
    case 'halftime':
      return { title: `Halftime: ${line}`, body: `${leader ? `${leader} lead at the half.` : 'All square at the half.'}${round}` }
    case 'end_period':
      return { title: `End of the ${ordinal(row.period)}: ${line}`, body: `${leader ? `${leader} in front.` : 'Tied going into the next period.'}${round}` }
    case 'seventh_inning':
      return { title: `Seventh-inning stretch: ${line}`, body: `${leader ? `${leader} lead heading into the late innings.` : 'Tied in the 7th.'}${round}` }
    case 'close_late': {
      const unit = m.sport === 'MLB' ? 'run' : m.sport === 'NHL' || m.sport === 'SOCCER' ? 'goal' : 'point'
      const gap = Math.abs(a - h)
      return { title: `🔥 Close game: ${line}`, body: `${row.statusDetail}. ${gap === 0 ? 'All tied up' : `${gap}-${unit} game`} — tune in.${round}` }
    }
    case 'overtime':
      return m.sport === 'MLB'
        ? { title: `⚾ Extra innings: ${line}`, body: `${row.statusDetail || 'Free baseball'}.${round}` }
        : { title: `⏱️ Overtime: ${line}`, body: `${row.statusDetail || 'Going to extra time'}.${round}` }
    case 'final': {
      const result = leader ? `${leader} win ${Math.max(a, h)}–${Math.min(a, h)}.` : `${away} and ${home} draw ${a}–${h}.`
      return { title: `Final: ${line}`, body: `${result}${round}` }
    }
  }
}
