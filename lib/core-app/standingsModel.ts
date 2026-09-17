/**
 * Standings maths — PURE, and safe to import from a client component.
 *
 * Everything the league standings screen shows is derived here from three inputs: the league's weekly
 * results (`WeeklyMatchup`), what the platform reports per team (`LeagueTeam`), and the league's
 * settings. No prisma, no `server-only`, no clock — so every rule below is pinned by a unit test rather
 * than by a probe against a database.
 *
 * ── Two boards, on purpose ──────────────────────────────────────────────────
 *
 * OFFICIAL is the league table: record first, then the tiebreaker. That is what decides playoff seeding,
 * and a screen that ranks by anything else must not be mistaken for it.
 *
 * POWER is ours: an analytical ranking built on ALL-PLAY results (how a team would have done against
 * every other team, every week), weighted towards recent form. It says who is actually good, which a
 * record — a function of who you happened to draw — does not.
 *
 * ── Things production taught this file (2026-09-17, read-only) ──────────────
 *
 * 🛑 `WeeklyMatchup.win` IS NOT A RESULT. Fifteen Sleeper leagues with no head-to-head pairing store every
 * roster in its own `matchupId` with `pointsAgainst = 0`, and the writer sets `win = 1` whenever such a
 * row scored — so the old board showed all twelve teams at 1-0. Results here come from PAIRING rows by
 * `matchupId` and comparing scores; a row with no partner has no result. (The writer also stores a tie as
 * `win = 0` for both sides, indistinguishable from a loss.)
 *
 * 🛑 SLEEPER'S MEDIAN GAME IS REAL AND IS IN THE PLATFORM RECORD. 40 leagues reported two games after week
 * one; 524 of those 526 teams match "head-to-head result + a win for finishing in the top half of the
 * week". A board that ignored it would disagree with Sleeper on every one of those leagues.
 *
 * 🛑 A WEEK WITH POINTS ON IT IS NOT A FINISHED WEEK. The live week carries partial scores from the first
 * kickoff, and the sync refreshes it every few minutes. The platform only moves a team's record once the
 * week is final — so the official table stops at the last week the platform's own records confirm, and
 * the week in progress is shown as in progress rather than as results.
 *
 * ⚠ SLEEPER'S `LeagueTeam.currentRank` IS OURS, NOT SLEEPER'S — every writer sorts wins then points for
 * itself — and its stored `pointsAgainst` is always 0. Neither is treated as the platform speaking.
 *
 * ⚠ `settings.standings_tiebreakers` / `settings.playoff_structure` ARE NOT THE PLATFORM'S RULES. They are
 * an AllFantasy default template filled in after import. The tiebreaker is only called the platform's
 * when we know the platform's rule; otherwise the screen says it assumed one.
 */

// ── Inputs ─────────────────────────────────────────────────────────────────

export type WeekRow = {
  week: number
  rosterId: string
  matchupId: number | null
  pointsFor: number
  pointsAgainst: number
}

export type ResultCode = 'W' | 'L' | 'T'

export type Record3 = { wins: number; losses: number; ties: number }

/** What the platform itself reports for a team (`LeagueTeam`). */
export type ReportedRecord = Record3 & {
  pointsFor: number
  /** Null when the platform does not report it. */
  pointsAgainst: number | null
  /** Null unless the platform's rank is its real standings position (see `rankIsOfficial`). */
  rank: number | null
}

export type TeamMeta = {
  rosterId: string
  name: string | null
  avatarUrl: string | null
  isYou: boolean
  division: { key: string; name: string } | null
  reported: ReportedRecord | null
}

export type Tiebreaker = 'points_for' | 'head_to_head'

export type StandingsRules = {
  playoffTeams: number
  /** `league` when the league's own settings said so; `assumed` when we fell back. */
  playoffTeamsSource: 'league' | 'assumed'
  byes: number
  /** Last regular-season week, or null when the league does not say (then every scheduled week counts). */
  regularSeasonEnd: number | null
  tiebreakers: Tiebreaker[]
  tiebreakerSource: 'platform' | 'assumed'
  /** True only where the stored rank is the provider's own standings position. */
  rankIsOfficial: boolean
  /** "Sleeper", "ESPN" … — used in copy only. */
  platformLabel: string
}

// ── Weekly snapshots ───────────────────────────────────────────────────────

/**
 * One roster's cumulative state after a week.
 *
 * ⚠ SHORT KEYS BECAUSE THESE ARE STORED — one `sportsDataCache` row per league per week (see
 * `standingsSnapshots.ts`). Every field is a plain number or string so the row round-trips through JSON.
 */
export type SnapshotTeam = {
  /** rosterId */
  r: string
  /** Head-to-head wins / losses / ties, from paired rows only. */
  w: number
  l: number
  t: number
  /** Median-game wins / losses / ties: a win for finishing in the top half of the week. */
  mw: number
  ml: number
  mt: number
  pf: number
  /** Opponent points, from paired rows only. */
  pa: number
  /** All-play, cumulative. */
  apw: number
  apl: number
  apt: number
  /** Expected head-to-head wins, cumulative: the sum of each week's all-play share. */
  xw: number
  /** Weeks this roster has been scored in. */
  n: number
  /** This week's points; null when this roster was not scored this week. */
  pts: number | null
  /** This week's head-to-head result and opponent. */
  res: ResultCode | null
  opp: string | null
  /** This week's all-play share — (wins + half ties) / opponents. Null when not scored. */
  aps: number | null
}

export type WeekSnapshot = {
  v: 1
  season: number
  week: number
  /** Fingerprint of every week's rows up to and including this one — see `chainStamps`. */
  stamp: string
  teams: SnapshotTeam[]
}

export const SNAPSHOT_VERSION = 1 as const

/** A row counts as played once either side has put up a point. Same rule as `currentWeek.ts`. */
export function isScoredRow(r: { pointsFor: number; pointsAgainst: number }): boolean {
  return r.pointsFor > 0 || r.pointsAgainst > 0
}

/**
 * The per-week fingerprint, from the aggregate the loader reads with one grouped query.
 *
 * ⚠ SUMS, NOT `updatedAt`. The sync deletes and recreates a live week's rows whether or not a score
 * changed, so a timestamp stamp would invalidate every snapshot on every sync. A stat correction changes
 * a sum; a no-op rewrite does not.
 */
export function weekStamp(agg: { rows: number; scored: number; pointsFor: number; pointsAgainst: number }): string {
  return `${agg.rows}.${agg.scored}.${Math.round(agg.pointsFor * 100)}.${Math.round(agg.pointsAgainst * 100)}`
}

/** FNV-1a, 32-bit. A fingerprint, not a security boundary. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * A snapshot for week N is cumulative, so it is valid only while EVERY week up to N is unchanged. The
 * chain folds each week's stamp into the one before; `chainStamps(s)[i]` belongs to week i.
 */
export function chainStamps(weekStamps: string[]): string[] {
  const out: string[] = []
  let acc = ''
  for (const s of weekStamps) {
    acc = fnv1a(`${acc}|${s}`)
    out.push(acc)
  }
  return out
}

function emptyTeam(r: string): SnapshotTeam {
  return { r, w: 0, l: 0, t: 0, mw: 0, ml: 0, mt: 0, pf: 0, pa: 0, apw: 0, apl: 0, apt: 0, xw: 0, n: 0, pts: null, res: null, opp: null, aps: null }
}

/**
 * Fold one week into the previous snapshot.
 *
 * `rosterIds` is the league's roster set, so a team that did not play this week still appears (carried
 * forward with `pts: null`).
 */
export function advanceWeek(
  prev: WeekSnapshot | null,
  season: number,
  week: number,
  weekRows: WeekRow[],
  rosterIds: string[],
  stamp: string,
): WeekSnapshot {
  const byId = new Map<string, SnapshotTeam>()
  for (const t of prev?.teams ?? []) byId.set(t.r, { ...t, pts: null, res: null, opp: null, aps: null })
  for (const id of rosterIds) if (!byId.has(id)) byId.set(id, emptyTeam(id))

  /* One row per roster per week is the table's unique key; keep the first if a caller passes more. */
  const rowById = new Map<string, WeekRow>()
  for (const row of weekRows) {
    if (rowById.has(row.rosterId)) continue
    rowById.set(row.rosterId, row)
    if (!byId.has(row.rosterId)) byId.set(row.rosterId, emptyTeam(row.rosterId))
  }

  const scored = [...rowById.values()].filter(isScoredRow)
  for (const row of scored) {
    const t = byId.get(row.rosterId)!
    t.pts = row.pointsFor
    t.pf += row.pointsFor
    t.n += 1
  }

  // Head-to-head: pair by matchupId. A group that is not exactly two rows has no result.
  const groups = new Map<number, WeekRow[]>()
  for (const row of rowById.values()) {
    if (row.matchupId == null) continue
    const g = groups.get(row.matchupId)
    if (g) g.push(row)
    else groups.set(row.matchupId, [row])
  }
  for (const pair of groups.values()) {
    if (pair.length !== 2) continue
    const [a, b] = pair
    if (!isScoredRow(a) && !isScoredRow(b)) continue
    const ta = byId.get(a.rosterId)!
    const tb = byId.get(b.rosterId)!
    ta.pa += b.pointsFor
    tb.pa += a.pointsFor
    ta.opp = b.rosterId
    tb.opp = a.rosterId
    if (a.pointsFor === b.pointsFor) {
      ta.t += 1
      tb.t += 1
      ta.res = 'T'
      tb.res = 'T'
      continue
    }
    const [win, loss] = a.pointsFor > b.pointsFor ? [ta, tb] : [tb, ta]
    win.w += 1
    loss.l += 1
    win.res = 'W'
    loss.res = 'L'
  }

  // All-play, expected wins and the median game — all relative to this week's scored field.
  const m = scored.length
  if (m >= 2) {
    const sorted = scored.map((r) => r.pointsFor).sort((x, y) => y - x)
    const half = Math.floor(m / 2)
    /* The score that closes the top half, and the one that opens the bottom. With an odd field the
       middle team is below the line. Level scores straddling the line are a median tie. */
    const lastIn = sorted[half - 1]
    const firstOut = sorted[half]
    for (const row of scored) {
      const t = byId.get(row.rosterId)!
      let below = 0
      let above = 0
      let level = 0
      for (const other of scored) {
        if (other === row) continue
        if (other.pointsFor < row.pointsFor) below += 1
        else if (other.pointsFor > row.pointsFor) above += 1
        else level += 1
      }
      t.apw += below
      t.apl += above
      t.apt += level
      const share = (below + level / 2) / (m - 1)
      t.aps = share
      t.xw += share
      if (lastIn === firstOut && row.pointsFor === lastIn) t.mt += 1
      else if (row.pointsFor >= lastIn) t.mw += 1
      else t.ml += 1
    }
  }

  return {
    v: SNAPSHOT_VERSION,
    season,
    week,
    stamp,
    teams: [...byId.values()].sort((a, b) => a.r.localeCompare(b.r, 'en', { numeric: true })),
  }
}

/** Is this JSON a snapshot we wrote, for this season and week? Anything else reads as a miss. */
export function isWeekSnapshot(value: unknown, season: number, week: number): value is WeekSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<WeekSnapshot>
  return (
    v.v === SNAPSHOT_VERSION &&
    v.season === season &&
    v.week === week &&
    typeof v.stamp === 'string' &&
    Array.isArray(v.teams) &&
    v.teams.every((t) => !!t && typeof t.r === 'string' && typeof t.w === 'number' && typeof t.pf === 'number' && typeof t.xw === 'number')
  )
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** Used when a league's settings do not declare a playoff field. */
export const DEFAULT_PLAYOFF_TEAMS = 6

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : null
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * First-round byes in a single-elimination bracket: the gap to the next power of two.
 * 6 → 2, 7 → 1, 4 → 0, 8 → 0 — which is how Sleeper seeds its brackets.
 */
export function byesForField(playoffTeams: number): number {
  if (playoffTeams < 2) return 0
  let size = 1
  while (size < playoffTeams) size *= 2
  return size - playoffTeams
}

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  native: 'AllFantasy',
}

/** Providers whose stored `currentRank` is the provider's own standings position. */
const OFFICIAL_RANK_PLATFORMS = new Set(['yahoo', 'fantrax'])

/**
 * How many teams make the playoffs, per the league's own settings.
 *
 * ⚠ THE KEYS ARE THE ONES THE IMPORTERS ACTUALLY WRITE. `seasonOutlook.ts` read
 * `settings.playoff.playoffTeams`, which no league in production carries (checked 2026-09-17), so every
 * league was simulated with six playoff teams — including the 53 Sleeper leagues that play four, seven or
 * eight. The Season Outlook brief fixes that in its own reader (`outlookFormat.ts`); the two should
 * agree, and if they ever disagree the standings line and the outlook odds will name different fields.
 */
export function readPlayoffTeams(settings: unknown, teamCount: number): { teams: number; source: 'league' | 'assumed' } {
  const s = obj(settings) ?? {}
  const declared = [obj(s.playoffSettings)?.playoffTeams, s.playoff_teams, s.playoff_team_count, obj(s.playoff)?.playoffTeams]
    .map(num)
    .find((n): n is number => n != null && n >= 2 && n <= teamCount)
  return declared != null
    ? { teams: Math.floor(declared), source: 'league' }
    : { teams: Math.min(DEFAULT_PLAYOFF_TEAMS, Math.max(2, teamCount)), source: 'assumed' }
}

export function readStandingsRules(
  settings: unknown,
  teamCount: number,
  platform: string | null | undefined,
): StandingsRules {
  const s = obj(settings) ?? {}
  const field = readPlayoffTeams(settings, teamCount)
  /* 0 means "not set" in Sleeper's settings — a playoff that starts in week 0 is not a schedule. */
  const start = [obj(s.playoffSettings)?.playoffStartWeek, s.playoff_start_week]
    .map(num)
    .find((n): n is number => n != null && n > 1)
  const length = num(s.regular_season_length)
  const key = String(platform ?? '').toLowerCase()
  return {
    playoffTeams: field.teams,
    playoffTeamsSource: field.source,
    byes: byesForField(field.teams),
    regularSeasonEnd: start != null ? start - 1 : length != null && length > 0 ? length : null,
    /*
     * Only Sleeper's rule is known for certain: record, then total points for. Head-to-head follows as
     * our own last resort for two teams level on both. Everything else is labelled an assumption.
     */
    tiebreakers: ['points_for', 'head_to_head'],
    tiebreakerSource: key === 'sleeper' ? 'platform' : 'assumed',
    rankIsOfficial: OFFICIAL_RANK_PLATFORMS.has(key),
    platformLabel: PLATFORM_LABEL[key] ?? 'the platform',
  }
}

// ── The board ─────────────────────────────────────────────────────────────

export type RemainingGame = { week: number; a: string; b: string }

export type BoardInput = {
  season: number
  /** Every scored regular-season week, ascending — stored and freshly computed alike. */
  snapshots: WeekSnapshot[]
  /** Regular-season pairings where neither side has scored yet. */
  unplayed: RemainingGame[]
  teams: TeamMeta[]
  rules: StandingsRules
}

export type Zone = 'bye' | 'playoff' | 'bubble' | 'out' | 'eliminated'

export type ProjectedRecord = Record3 & {
  pointsFor: number
  /** Where this projected record would seed. */
  seed: number
}

export type BoardTeam = {
  rosterId: string
  name: string
  avatarUrl: string | null
  isYou: boolean
  division: { key: string; name: string } | null

  // Official
  seed: number
  /** Places gained since the week before (positive = up). Null in week one. */
  seedMove: number | null
  record: Record3
  winPct: number | null
  /** Games behind the last playoff spot (negative = ahead of it). Null without head-to-head games. */
  gamesBack: number | null
  pointsFor: number
  pointsAgainst: number | null
  divisionRank: number | null
  /** Why this team sits BELOW the team directly above it, when their records are level. */
  tiebreak: string | null
  zone: Zone
  clinched: 'bye' | 'playoff' | null
  /** Regular-season games still to play, including any week held back as in progress. */
  gamesLeft: number

  // Power
  powerRank: number
  /** 0–100. */
  powerScore: number
  powerMove: number | null
  pfRank: number
  pfMove: number | null
  allPlay: Record3
  /** Head-to-head wins, ties counted as half — the number `luck` is measured from. */
  headToHeadWins: number
  expectedWins: number
  /** Head-to-head wins minus expected wins. Positive = has won more than its scoring earned. */
  luck: number
  average: number | null
  weeksPlayed: number
  /** Last five head-to-head results, oldest first. */
  form: ResultCode[]

  // Projection — an expectation, kept apart from everything above.
  projected: ProjectedRecord | null
}

export type HistoryPoint = { week: number; seed: number; powerRank: number }

export type StandingsBoard = {
  season: number
  /** The last week the official table counts. */
  throughWeek: number
  /** Scored weeks left out because the platform has not finalised them. */
  pendingWeeks: number[]
  /** Weeks whose snapshot is safe to store: final, and not going to be rewritten. */
  settledThrough: number | null
  teams: BoardTeam[]
  /** Week-by-week position per roster, oldest first. */
  history: Record<string, HistoryPoint[]>
  weeks: number[]
  /** h2h[a][b] = a's head-to-head record against b. */
  h2h: Record<string, Record<string, Record3>>
  hasHeadToHead: boolean
  medianGames: boolean
  /** How the official records relate to what the platform reports. */
  platformCheck: 'matches' | 'platform-behind' | 'platform-used' | 'unavailable'
  /** True when the order is the platform's own reported rank rather than our rule. */
  platformOrder: boolean
  recordBasis: string
  orderBasis: string
  historyBasis: string
  divisions: Array<{ key: string; name: string }>
  rules: StandingsRules
  gamesRemaining: number
  projectionBasis: string
  /** Why projections are missing, when they are. */
  projectionWithheld: string | null
  powerBasis: string
}

/** Below this many scored weeks a team's scoring is noise rather than a profile. */
export const MIN_WEEKS_TO_PROJECT = 3
/** Floor on σ — the same floor Season Outlook uses. */
const SIGMA_FLOOR = 12

export function winPct(r: Record3): number | null {
  const g = r.wins + r.losses + r.ties
  return g > 0 ? (r.wins + r.ties / 2) / g : null
}

function gamesOf(r: Record3): number {
  return r.wins + r.losses + r.ties
}

function sameRecord(a: Record3, b: Record3): boolean {
  return a.wins === b.wins && a.losses === b.losses && a.ties === b.ties
}

export function formatRecord(r: Record3): string {
  return `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`
}

function fmtPts(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function snapTeam(snap: WeekSnapshot | undefined, id: string): SnapshotTeam {
  return snap?.teams.find((t) => t.r === id) ?? emptyTeam(id)
}

function recordAt(s: SnapshotTeam, median: boolean): Record3 {
  return median ? { wins: s.w + s.mw, losses: s.l + s.ml, ties: s.t + s.mt } : { wins: s.w, losses: s.l, ties: s.t }
}

type Confirmation = { index: number; median: boolean; matched: number; checked: number }

/**
 * Which of our weeks the platform's records describe, and whether they count a median game.
 *
 * Every (week, median?) pair is tried and the one that reproduces the most reported records wins —
 * latest week first, so a tie goes to the newer week. It has to agree on at least 80% of the teams the
 * platform reports a record for (a team that scored exactly zero is unpaired on our side and not on
 * theirs, which is the usual one-team disagreement).
 */
function confirmAgainstPlatform(snapshots: WeekSnapshot[], teams: TeamMeta[]): Confirmation | null {
  const reported = teams.filter((t) => t.reported && gamesOf(t.reported) > 0)
  if (reported.length < 2 || snapshots.length === 0) return null
  let best: Confirmation | null = null
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    for (const median of [false, true]) {
      let matched = 0
      for (const t of reported) {
        if (sameRecord(recordAt(snapTeam(snapshots[i], t.rosterId), median), t.reported!)) matched += 1
      }
      if (!best || matched > best.matched) best = { index: i, median, matched, checked: reported.length }
    }
  }
  return best && best.matched / best.checked >= 0.8 ? best : null
}

function h2hThrough(snapshots: WeekSnapshot[]): Record<string, Record<string, Record3>> {
  const out: Record<string, Record<string, Record3>> = {}
  for (const snap of snapshots) {
    for (const t of snap.teams) {
      if (!t.opp || !t.res) continue
      const cell = ((out[t.r] ??= {})[t.opp] ??= { wins: 0, losses: 0, ties: 0 })
      if (t.res === 'W') cell.wins += 1
      else if (t.res === 'L') cell.losses += 1
      else cell.ties += 1
    }
  }
  return out
}

type OrderRow = { rosterId: string; name: string; record: Record3; pointsFor: number; pointsAgainst: number | null }

type OrderCtx = {
  h2h: Record<string, Record<string, Record3>>
  hasHeadToHead: boolean
  tiebreakers: Tiebreaker[]
}

/** Negative = `a` ranks higher. Win percentage, then the tiebreaker chain, then name so the order is stable. */
function compareOfficial(a: OrderRow, b: OrderRow, ctx: OrderCtx): number {
  if (ctx.hasHeadToHead) {
    const d = (winPct(b.record) ?? 0) - (winPct(a.record) ?? 0)
    if (d !== 0) return d
  }
  for (const tb of ctx.tiebreakers) {
    if (tb === 'points_for' && a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor
    if (tb === 'head_to_head') {
      const r = ctx.h2h[a.rosterId]?.[b.rosterId]
      if (r && r.wins !== r.losses) return r.losses - r.wins
    }
  }
  return a.name.localeCompare(b.name)
}

export type ExplainCtx = OrderCtx & {
  tiebreakerSource: 'platform' | 'assumed'
  platformLabel: string
  /** True when the order is the platform's own rank rather than our rule. */
  platformOrder: boolean
}

/**
 * Why `upper` ranks above `lower`, in one sentence — the same chain `compareOfficial` walks.
 *
 * Exported because the screen also answers "why is A above B?" for any two teams a reader picks.
 */
export function explainOrder(upper: OrderRow, lower: OrderRow, ctx: ExplainCtx): string {
  if (!ctx.hasHeadToHead) {
    return upper.pointsFor !== lower.pointsFor
      ? `${upper.name} has scored more (${fmtPts(upper.pointsFor)} to ${fmtPts(lower.pointsFor)}), and this league is ordered by points.`
      : `${upper.name} and ${lower.name} have scored the same; the order between them is not settled.`
  }
  const up = winPct(upper.record) ?? 0
  const low = winPct(lower.record) ?? 0
  if (up !== low) {
    return up > low
      ? `${upper.name} has the better record (${formatRecord(upper.record)} to ${formatRecord(lower.record)}) — no tiebreaker needed.`
      : `${ctx.platformLabel} ranks ${upper.name} higher despite a worse record (${formatRecord(upper.record)} to ${formatRecord(lower.record)}).`
  }
  const level = `Level at ${formatRecord(upper.record)}`
  const whose =
    ctx.tiebreakerSource === 'platform' ? `${ctx.platformLabel}'s tiebreaker` : 'the tiebreaker we assume for this platform'
  if (upper.pointsFor > lower.pointsFor) {
    return `${level}; ${upper.name} is ahead on points for (${fmtPts(upper.pointsFor)} to ${fmtPts(lower.pointsFor)}), ${whose}.`
  }
  if (upper.pointsFor === lower.pointsFor) {
    const r = ctx.h2h[upper.rosterId]?.[lower.rosterId]
    if (r && r.wins > r.losses) {
      return `${level} and level on points; ${upper.name} leads the head-to-head ${formatRecord(r)}.`
    }
  }
  if (ctx.platformOrder) {
    return `${level}. ${ctx.platformLabel} puts ${upper.name} first by a tiebreaker it does not report to us — ${lower.name} leads on points for.`
  }
  return `${level} and level on every tiebreaker we hold; the order between them is not settled.`
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * AF Power, 0–1: season all-play share, blended 70/30 with the last three weeks' mean once four weeks
 * are scored. Before that, recent form IS the season and weighting it twice would only add noise.
 */
function powerScores(snapshots: WeekSnapshot[], ids: string[]): Map<string, number> {
  const out = new Map<string, number>()
  const latest = snapshots[snapshots.length - 1]
  for (const id of ids) {
    const s = snapTeam(latest, id)
    const season = winPct({ wins: s.apw, losses: s.apl, ties: s.apt })
    if (season == null) {
      out.set(id, 0)
      continue
    }
    const recent = snapshots
      .slice(-3)
      .map((snap) => snapTeam(snap, id).aps)
      .filter((v): v is number => v != null)
    const form = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : season
    out.set(id, snapshots.length >= 4 ? 0.7 * season + 0.3 * form : season)
  }
  return out
}

function powerOrder(snapshots: WeekSnapshot[], ids: string[]): { rank: Map<string, number>; score: Map<string, number> } {
  const score = powerScores(snapshots, ids)
  const latest = snapshots[snapshots.length - 1]
  const ordered = [...ids].sort(
    (a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || snapTeam(latest, b).pf - snapTeam(latest, a).pf || a.localeCompare(b),
  )
  return { rank: new Map(ordered.map((id, i) => [id, i + 1])), score }
}

/** Highest first; ties share the better rank. */
function pointsRanks(snap: WeekSnapshot | undefined, ids: string[]): Map<string, number> {
  const ordered = [...ids].sort((a, b) => snapTeam(snap, b).pf - snapTeam(snap, a).pf)
  const out = new Map<string, number>()
  let lastV: number | null = null
  let lastR = 0
  ordered.forEach((id, i) => {
    const v = snapTeam(snap, id).pf
    const rank = lastV != null && v === lastV ? lastR : i + 1
    out.set(id, rank)
    lastV = v
    lastR = rank
  })
  return out
}

export function buildStandingsBoard(input: BoardInput): StandingsBoard {
  const { rules, teams } = input
  const all = input.snapshots
  const meta = new Map(teams.map((t) => [t.rosterId, t]))
  const ids = [...new Set([...teams.map((t) => t.rosterId), ...(all[all.length - 1]?.teams.map((t) => t.r) ?? [])])]
  const nameOf = (id: string) => meta.get(id)?.name?.trim() || `Team ${id}`

  const hasHeadToHead = all.some((s) => s.teams.some((t) => t.res != null))
  const confirmed = hasHeadToHead ? confirmAgainstPlatform(all, teams) : null

  /*
   * Where the official table stops.
   *
   * Confirmed → the week the platform's records describe; anything scored after it is in progress.
   * Unconfirmed, but the platform counts MORE games than we can pair → the platform's records are the
   * complete ones (a scoring rule we do not model), so they are used as they are.
   * Otherwise → every scored week, which is all we can know.
   */
  const lastIdx = all.length - 1
  let cut = lastIdx
  let medianGames = false
  let platformCheck: StandingsBoard['platformCheck'] = 'unavailable'
  if (confirmed) {
    cut = confirmed.index
    medianGames = confirmed.median
    platformCheck = confirmed.index === lastIdx ? 'matches' : 'platform-behind'
  } else if (hasHeadToHead) {
    const latest = all[lastIdx]
    const every = ids.every((id) => {
      const rep = meta.get(id)?.reported
      return rep != null && gamesOf(rep) > 0
    })
    const ahead = ids.some((id) => {
      const rep = meta.get(id)?.reported
      return rep != null && gamesOf(rep) > gamesOf(recordAt(snapTeam(latest, id), false))
    })
    if (every && ahead) platformCheck = 'platform-used'
  }

  const snapshots = all.slice(0, cut + 1)
  const pending = all.slice(cut + 1)
  const latest = snapshots[snapshots.length - 1]
  const h2h = h2hThrough(snapshots)
  const usePlatform = platformCheck === 'platform-used'

  const orderRows: OrderRow[] = ids.map((id) => {
    const s = snapTeam(latest, id)
    const rep = meta.get(id)?.reported
    return {
      rosterId: id,
      name: nameOf(id),
      record: !hasHeadToHead
        ? { wins: 0, losses: 0, ties: 0 }
        : usePlatform && rep
          ? { wins: rep.wins, losses: rep.losses, ties: rep.ties }
          : recordAt(s, medianGames),
      pointsFor: usePlatform && rep ? rep.pointsFor : s.pf,
      pointsAgainst: !hasHeadToHead ? null : usePlatform ? rep?.pointsAgainst ?? null : s.pa,
    }
  })
  const rowOf = new Map(orderRows.map((r) => [r.rosterId, r]))

  const orderCtx: OrderCtx = { h2h, hasHeadToHead, tiebreakers: rules.tiebreakers }
  const reportedRanks = ids.map((id) => meta.get(id)?.reported?.rank ?? null)
  const platformOrder =
    usePlatform &&
    rules.rankIsOfficial &&
    reportedRanks.every((r): r is number => r != null) &&
    new Set(reportedRanks).size === ids.length
  const ordered = platformOrder
    ? [...orderRows].sort((a, b) => meta.get(a.rosterId)!.reported!.rank! - meta.get(b.rosterId)!.reported!.rank!)
    : [...orderRows].sort((a, b) => compareOfficial(a, b, orderCtx))

  // History: the same rule, week by week, from results — so movement compares like with like.
  const history: Record<string, HistoryPoint[]> = {}
  const seedByWeek: Array<Map<string, number>> = []
  const powerByWeek: Array<Map<string, number>> = []
  const pfByWeek: Array<Map<string, number>> = []
  snapshots.forEach((snap, i) => {
    const upTo = snapshots.slice(0, i + 1)
    const ctx: OrderCtx = { ...orderCtx, h2h: h2hThrough(upTo) }
    const rows = ids.map((id) => {
      const s = snapTeam(snap, id)
      return { rosterId: id, name: nameOf(id), record: recordAt(s, medianGames), pointsFor: s.pf, pointsAgainst: s.pa }
    })
    const seeds = new Map([...rows].sort((a, b) => compareOfficial(a, b, ctx)).map((r, k) => [r.rosterId, k + 1]))
    const powers = powerOrder(upTo, ids).rank
    seedByWeek.push(seeds)
    powerByWeek.push(powers)
    pfByWeek.push(pointsRanks(snap, ids))
    for (const id of ids) (history[id] ??= []).push({ week: snap.week, seed: seeds.get(id)!, powerRank: powers.get(id)! })
  })
  const move = (byWeek: Array<Map<string, number>>, id: string): number | null => {
    const n = byWeek.length
    if (n < 2) return null
    const before = byWeek[n - 2].get(id)
    const now = byWeek[n - 1].get(id)
    return before != null && now != null ? before - now : null
  }

  const power = powerOrder(snapshots, ids)
  const pfRank = pointsRanks(latest, ids)

  /*
   * What is left to play: every unplayed pairing, plus the games of any week we held back as in
   * progress — they are not results yet, so they are still ahead of the table.
   */
  const remaining: RemainingGame[] = [...input.unplayed]
  for (const snap of pending) {
    const seen = new Set<string>()
    for (const t of snap.teams) {
      if (!t.opp || seen.has(t.r)) continue
      seen.add(t.r)
      seen.add(t.opp)
      remaining.push({ week: snap.week, a: t.r, b: t.opp })
    }
  }
  const remainingWeeks = new Map<string, Set<number>>()
  for (const g of remaining) {
    for (const id of [g.a, g.b]) (remainingWeeks.get(id) ?? remainingWeeks.set(id, new Set()).get(id)!).add(g.week)
  }
  const medianLeft = (id: string) => (medianGames ? remainingWeeks.get(id)?.size ?? 0 : 0)

  const zones = computeZones(ordered, rules, hasHeadToHead, remaining, medianLeft)
  const projection = projectRecords({ ids, snapshots, remaining, medianGames, rowOf, hasHeadToHead, rules })

  // Divisions.
  const divisionNames = new Map<string, string>()
  for (const t of teams) if (t.division) divisionNames.set(t.division.key, t.division.name)
  const divisionRank = new Map<string, number>()
  for (const key of divisionNames.keys()) {
    ordered.filter((r) => meta.get(r.rosterId)?.division?.key === key).forEach((r, i) => divisionRank.set(r.rosterId, i + 1))
  }

  const explainCtx: ExplainCtx = {
    ...orderCtx,
    tiebreakerSource: rules.tiebreakerSource,
    platformLabel: rules.platformLabel,
    platformOrder,
  }
  const field = Math.min(rules.playoffTeams, ordered.length)
  const cutRow = ordered[field - 1] ?? null

  const boardTeams: BoardTeam[] = ordered.map((row, i) => {
    const id = row.rosterId
    const s = snapTeam(latest, id)
    const m = meta.get(id)
    const above = i > 0 ? ordered[i - 1] : null
    const tied = hasHeadToHead && above != null && winPct(above.record) === winPct(row.record)
    return {
      rosterId: id,
      name: row.name,
      avatarUrl: m?.avatarUrl ?? null,
      isYou: m?.isYou ?? false,
      division: m?.division ?? null,
      seed: i + 1,
      seedMove: platformOrder ? null : move(seedByWeek, id),
      record: row.record,
      winPct: hasHeadToHead ? winPct(row.record) : null,
      gamesBack:
        hasHeadToHead && cutRow
          ? (cutRow.record.wins - row.record.wins + (row.record.losses - cutRow.record.losses)) / 2
          : null,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      divisionRank: divisionRank.get(id) ?? null,
      tiebreak: tied && above ? explainOrder(above, row, explainCtx) : null,
      zone: zones.zone.get(id) ?? 'out',
      clinched: zones.clinched.get(id) ?? null,
      gamesLeft: remaining.filter((g) => g.a === id || g.b === id).length,
      powerRank: power.rank.get(id)!,
      powerScore: Math.round((power.score.get(id) ?? 0) * 1000) / 10,
      powerMove: move(powerByWeek, id),
      pfRank: pfRank.get(id)!,
      pfMove: move(pfByWeek, id),
      allPlay: { wins: s.apw, losses: s.apl, ties: s.apt },
      headToHeadWins: s.w + s.t / 2,
      expectedWins: Math.round(s.xw * 100) / 100,
      luck: Math.round((s.w + s.t / 2 - s.xw) * 100) / 100,
      average: s.n > 0 ? s.pf / s.n : null,
      weeksPlayed: s.n,
      form: snapshots
        .map((snap) => snapTeam(snap, id).res)
        .filter((r): r is ResultCode => r != null)
        .slice(-5),
      projected: projection.byId.get(id) ?? null,
    }
  })

  const P = rules.platformLabel
  const median = medianGames ? ', including the weekly median game' : ''
  const recordBasis = !hasHeadToHead
    ? 'This league has no head-to-head games on file, so there are no records — it is ordered by points for.'
    : platformCheck === 'platform-used'
      ? `Records are ${P}'s own. They count games our synced results cannot account for, so the week-by-week history below may not match them.`
      : platformCheck === 'matches'
        ? `Records are counted from every synced result${median}, and match ${P}'s standings.`
        : platformCheck === 'platform-behind'
          ? `Records run through week ${latest.week}${median} — the last week ${P} has made final.`
          : `Records are counted from every synced result${median}. ${P} has not reported records to check them against.`

  const orderBasis = platformOrder
    ? `Order is ${P}'s reported standings.`
    : hasHeadToHead
      ? `Order is winning percentage, then points for, then head-to-head${
          rules.tiebreakerSource === 'platform' ? ` — ${P}'s rule` : ` — assumed, because ${P} does not report its tiebreaker to us`
        }.`
      : 'Order is total points for.'

  const settledThrough =
    confirmed != null
      ? latest.week
      : input.unplayed.length === 0 && all.length > 0
        ? all[lastIdx].week
        : all.length > 1
          ? all[lastIdx - 1].week
          : null

  return {
    season: input.season,
    throughWeek: latest?.week ?? 0,
    pendingWeeks: pending.map((s) => s.week),
    settledThrough,
    teams: boardTeams,
    history,
    weeks: snapshots.map((s) => s.week),
    h2h,
    hasHeadToHead,
    medianGames,
    platformCheck,
    platformOrder,
    recordBasis,
    orderBasis,
    historyBasis: `Positions by week are rebuilt from synced results with the same rule as the table${
      platformCheck === 'platform-used' ? `, which counts fewer games than ${P} does` : ''
    }.`,
    divisions: [...divisionNames.entries()].map(([key, name]) => ({ key, name })),
    rules,
    gamesRemaining: remaining.length,
    projectionBasis: projection.basis,
    projectionWithheld: projection.withheld,
    powerBasis:
      'AF Power is our analysis, not the league table: all-play winning percentage — every team against every other team, every week — with the last three weeks weighted 30% once four weeks are scored. Ties go to points for.',
  }
}

/** Above this many remaining head-to-head games, outcomes are bounded rather than enumerated. */
const EXACT_ZONE_GAMES = 14

/**
 * Where each team sits against the playoff line, and what is already settled.
 *
 * ⚠ CLINCHED AND ELIMINATED ARE CERTAINTIES, SO THEY ARE CONSERVATIVE. A level final record is counted
 * against the team being tested, because a points tiebreaker can still move. Clinched means no set of
 * remaining results puts `field` teams level with or above it; eliminated means every set of results
 * leaves `field` teams strictly above it.
 *
 * With few games left — the only time these words matter — every outcome is enumerated, so two rivals
 * who still play each other are never both counted as winning. Earlier, a bound is used (every rival
 * wins out), which can only UNDER-claim. A median game is treated as free for everyone: the team being
 * tested loses all of its own and every rival wins theirs, and the reverse for elimination.
 */
function computeZones(
  ordered: OrderRow[],
  rules: StandingsRules,
  hasHeadToHead: boolean,
  remaining: RemainingGame[],
  medianLeft: (id: string) => number,
): { zone: Map<string, Zone>; clinched: Map<string, 'bye' | 'playoff'> } {
  const zone = new Map<string, Zone>()
  const clinched = new Map<string, 'bye' | 'playoff'>()
  const field = Math.min(rules.playoffTeams, ordered.length)
  const byes = Math.min(rules.byes, field)
  const positional = (i: number): Zone => (i < byes ? 'bye' : i < field ? 'playoff' : 'out')

  if (!hasHeadToHead) {
    ordered.forEach((row, i) => zone.set(row.rosterId, i >= field - 1 && i <= field ? 'bubble' : positional(i)))
    return { zone, clinched }
  }

  const ids = ordered.map((r) => r.rosterId)
  const units = new Map(ordered.map((r) => [r.rosterId, r.record.wins + r.record.ties / 2]))
  const games = remaining.filter((g) => units.has(g.a) && units.has(g.b))
  const med = new Map(ids.map((id) => [id, medianLeft(id)]))
  const gamesLeft = new Map(ids.map((id) => [id, games.filter((g) => g.a === id || g.b === id).length]))

  if (games.length === 0 && ids.every((id) => med.get(id) === 0)) {
    ordered.forEach((row, i) => {
      if (i < field) clinched.set(row.rosterId, i < byes ? 'bye' : 'playoff')
      zone.set(row.rosterId, i < field ? positional(i) : 'eliminated')
    })
    return { zone, clinched }
  }

  /* Half-game records make a tie in a remaining game matter; enumeration only covers win or loss. */
  const whole = ids.every((id) => Number.isInteger(units.get(id)))
  const exact = whole && games.length <= EXACT_ZONE_GAMES

  const status = new Map<string, { bye: boolean; playoff: boolean; out: boolean }>()
  for (const id of ids) {
    const mine = units.get(id)!
    if (!exact) {
      const best = (o: string) => units.get(o)! + gamesLeft.get(o)! + med.get(o)!
      const threats = ids.filter((o) => o !== id && best(o) >= mine).length
      const above = ids.filter((o) => o !== id && units.get(o)! > best(id)).length
      status.set(id, { bye: threats < byes, playoff: threats < field, out: above >= field })
      continue
    }
    let bye = byes > 0
    let playoff = true
    let out = true
    const total = 1 << games.length
    const wins = new Map<string, number>()
    for (let mask = 0; mask < total && (bye || playoff || out); mask += 1) {
      for (const o of ids) wins.set(o, units.get(o)!)
      games.forEach((g, j) => {
        const winner = mask & (1 << j) ? g.a : g.b
        wins.set(winner, wins.get(winner)! + 1)
      })
      const myWorst = wins.get(id)!
      const myBest = myWorst + med.get(id)!
      let levelOrAbove = 0
      let strictlyAbove = 0
      for (const o of ids) {
        if (o === id) continue
        if (wins.get(o)! + med.get(o)! >= myWorst) levelOrAbove += 1
        if (wins.get(o)! > myBest) strictlyAbove += 1
      }
      if (levelOrAbove >= byes) bye = false
      if (levelOrAbove >= field) playoff = false
      if (strictlyAbove < field) out = false
    }
    status.set(id, { bye, playoff, out })
  }

  const lineUnits = units.get(ordered[field - 1]?.rosterId ?? '') ?? 0
  ordered.forEach((row, i) => {
    const id = row.rosterId
    const s = status.get(id)!
    if (s.bye && byes > 0) clinched.set(id, 'bye')
    else if (s.playoff) clinched.set(id, 'playoff')
    if (s.out) return void zone.set(id, 'eliminated')
    const nearLine = Math.abs(units.get(id)! - lineUnits) <= 1
    if (clinched.has(id)) zone.set(id, positional(i))
    else if (i < byes) zone.set(id, 'bye')
    else if (i < field) zone.set(id, i >= field - 2 && nearLine ? 'bubble' : 'playoff')
    else zone.set(id, i < field + 2 && nearLine ? 'bubble' : 'out')
  })
  return { zone, clinched }
}

/**
 * Projected final regular-season records — an expectation, never a result.
 *
 * Each remaining game is priced from both teams' weekly scoring so far (mean and spread, σ floored), and
 * a team's projection is its current record plus those win chances. Deterministic — no sampling — so the
 * same data always shows the same projection. A median league adds, per remaining week, the team's
 * all-play share as its chance of finishing in the top half.
 */
function projectRecords(args: {
  ids: string[]
  snapshots: WeekSnapshot[]
  remaining: RemainingGame[]
  medianGames: boolean
  rowOf: Map<string, OrderRow>
  hasHeadToHead: boolean
  rules: StandingsRules
}): { byId: Map<string, ProjectedRecord>; basis: string; withheld: string | null } {
  const { ids, snapshots, remaining, medianGames, rowOf } = args
  const byId = new Map<string, ProjectedRecord>()
  const basis =
    'Projected records add each remaining game’s win chance — priced from both teams’ weekly scoring so far — to the current record, then round to whole games. They are a model’s expectation, not results, and they are not the playoff odds on Season Outlook.'

  if (!args.hasHeadToHead) return { byId, basis, withheld: 'Projected records need head-to-head games, and this league has none on file.' }
  if (snapshots.length < MIN_WEEKS_TO_PROJECT) {
    const n = snapshots.length
    return {
      byId,
      basis,
      withheld: `Projected records start once ${MIN_WEEKS_TO_PROJECT} weeks are final — ${n} ${n === 1 ? 'is' : 'are'} so far.`,
    }
  }
  if (remaining.length === 0) return { byId, basis, withheld: 'The regular season is over, so there is nothing left to project.' }

  const profile = new Map<string, { mu: number; sigma: number; share: number }>()
  const last = snapshots[snapshots.length - 1]
  for (const id of ids) {
    const values = snapshots.map((snap) => snapTeam(snap, id).pts).filter((v): v is number => v != null)
    if (values.length < MIN_WEEKS_TO_PROJECT) continue
    const mu = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, v) => a + (v - mu) ** 2, 0) / Math.max(1, values.length - 1)
    const s = snapTeam(last, id)
    profile.set(id, {
      mu,
      sigma: Math.max(SIGMA_FLOOR, Math.sqrt(variance)),
      share: winPct({ wins: s.apw, losses: s.apl, ties: s.apt }) ?? 0.5,
    })
  }

  const addWins = new Map<string, number>()
  const addGames = new Map<string, number>()
  const addPoints = new Map<string, number>()
  const medianWeeks = new Map<string, Set<number>>()
  for (const g of remaining) {
    const a = profile.get(g.a)
    const b = profile.get(g.b)
    if (!a || !b) continue
    const pA = normalCdf((a.mu - b.mu) / Math.sqrt(a.sigma ** 2 + b.sigma ** 2))
    addWins.set(g.a, (addWins.get(g.a) ?? 0) + pA)
    addWins.set(g.b, (addWins.get(g.b) ?? 0) + 1 - pA)
    for (const [id, p] of [
      [g.a, a],
      [g.b, b],
    ] as const) {
      addGames.set(id, (addGames.get(id) ?? 0) + 1)
      addPoints.set(id, (addPoints.get(id) ?? 0) + p.mu)
      if (medianGames) (medianWeeks.get(id) ?? medianWeeks.set(id, new Set()).get(id)!).add(g.week)
    }
  }
  if (medianGames) {
    for (const [id, weeks] of medianWeeks) {
      const p = profile.get(id)!
      addWins.set(id, (addWins.get(id) ?? 0) + p.share * weeks.size)
      addGames.set(id, (addGames.get(id) ?? 0) + weeks.size)
    }
  }

  const rows = ids
    .filter((id) => profile.has(id))
    .map((id) => {
      const row = rowOf.get(id)!
      const exact = row.record.wins + (addWins.get(id) ?? 0)
      const total = gamesOf(row.record) + (addGames.get(id) ?? 0)
      const wins = Math.round(exact)
      return {
        id,
        exact: exact + row.record.ties / 2,
        wins,
        losses: Math.max(0, total - wins - row.record.ties),
        ties: row.record.ties,
        pointsFor: row.pointsFor + (addPoints.get(id) ?? 0),
      }
    })
    .sort((a, b) => b.exact - a.exact || b.pointsFor - a.pointsFor)
  rows.forEach((r, i) => byId.set(r.id, { wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor, seed: i + 1 }))

  return {
    byId,
    basis,
    withheld: byId.size === 0 ? `No team has ${MIN_WEEKS_TO_PROJECT} scored weeks to project from.` : null,
  }
}
