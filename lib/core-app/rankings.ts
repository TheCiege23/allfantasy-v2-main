import 'server-only'

import { prisma } from '@/lib/prisma'
import { RANK_LEVELS, getLevelFromXp, type RankLevelRow } from '@/lib/rank/levels'
import {
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
} from '@/lib/rank/rank-xp-constants'
import { loadCareerLedger, type CareerLedgerRow } from '@/lib/rank/careerLedger'
import { careerXp, type CareerXp } from '@/lib/rank/careerXp'
import { getLeagueStandings } from '@/lib/core-app/leagueStandings'
import { searchPlayers, type PlayerMatch } from '@/lib/core-app/playerFinder'
import { playerRef } from '@/lib/core-app/playerRef'
import {
  BOARD_KEYS,
  BOARD_META,
  DEFAULT_FILTERS,
  FORMAT_LABEL,
  TYPE_LABEL,
  cohortKey,
  describeFilters,
  easternDateKey,
  fantasyWeekStartKey,
  filterOptions,
  filterParams,
  isDefaultFilters,
  isResultRow,
  matchesFilters,
  movementSince,
  parseBoard,
  parseRankingFilters,
  parseSort,
  platformLabel,
  rankBoard,
  scoreRows,
  seasonTrend,
  seriesFor,
  shiftDateKey,
  sortBoardRows,
  type BoardKey,
  type CommunityEntry,
  type FilterOptions,
  type ManagerScore,
  type RankSnapshot,
  type RankingFilters,
  type ScoringCohorts,
  type SeasonTrendPoint,
  type SortDir,
  type SortKey,
  type TrendPoint,
} from '@/lib/core-app/rankingsEngine'
import { firstSnapshotDate, readRankSnapshots } from '@/lib/core-app/rankingsSnapshots'
import { communityEntries, handleOf, levelOf, loadCommunity } from '@/lib/core-app/rankingsCommunity'

/**
 * Rankings — the data layer for `/core/rankings` (handoffs 14a ladder and boards,
 * 14b FAQ, 14c compare), rebuilt on the career ledger.
 *
 * ── THREE SCOPES, NEVER MIXED ────────────────────────────────────────────────
 *
 *   global     every ranked AllFantasy manager, on the normalised boards
 *   portfolio  you, across every league you have imported — your score, your
 *              XP, and each of your league-seasons
 *   league     one league's own standings, from that league's own results
 *
 * The screen used to put all three on one page — a portfolio count card above a
 * global leaderboard beside your personal XP — which let "#1" read as any of
 * them. Each now has its own tab, heading and freshness line.
 *
 * ⚠ THE LADDER IS DERIVED FROM `RANK_LEVELS`, NEVER RETYPED, and the tier is
 * always re-derived from XP: `rank_tier` held placeholders ("T21", "T8") on four
 * of the first five ranked profiles.
 *
 * ⚠ NOTHING HERE READS `career_seasons_played` / `career_leagues_played`. See
 * `lib/rank/careerLedger.ts` for how reading those two columns in the wrong
 * orientation flagged sound careers as contradictory on production.
 */

/* ────────────────────────────── the ladder ──────────────────────────────── */

export type LadderTier = {
  /** `tierGroup` from the level table, 1–7. */
  group: number
  /** "All-Pro". */
  tier: string
  /** Sub-rank names inside the tier, in level order. */
  subRanks: string[]
  minXp: number
  /** `null` on the last rung — Dynasty has no ceiling. */
  maxXp: number | null
  /** "Level 25 · the last rung" for Dynasty, "Lv 13–17" otherwise. */
  levelRange: string
  firstLevel: number
  lastLevel: number
  /** Hex from the level table, used for the tier-coloured left border. */
  color: string
  isCurrent: boolean
}

/**
 * The seven tiers, with each one's XP range closed against the next tier's
 * floor. The top tier is left open rather than given an invented ceiling.
 */
export function buildLadder(currentLevel: number | null): LadderTier[] {
  const groups = new Map<number, RankLevelRow[]>()
  for (const row of RANK_LEVELS) {
    const list = groups.get(row.tierGroup) ?? []
    list.push(row)
    groups.set(row.tierGroup, list)
  }

  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0])
  const currentGroup =
    currentLevel != null
      ? (RANK_LEVELS.find((r) => r.level === currentLevel)?.tierGroup ?? null)
      : null

  return ordered.map(([group, rows], i) => {
    const next = ordered[i + 1]?.[1][0] ?? null
    const first = rows[0]
    const last = rows[rows.length - 1]
    return {
      group,
      tier: first.tier,
      subRanks: rows.map((r) => r.name),
      minXp: first.minXp,
      maxXp: next ? next.minXp - 1 : null,
      levelRange:
        first.level === last.level
          ? `Level ${first.level} · the last rung`
          : `Lv ${first.level}–${last.level}`,
      firstLevel: first.level,
      lastLevel: last.level,
      color: first.color,
      isCurrent: currentGroup === group,
    }
  })
}

/* ─────────────────────────────── XP breakdown ───────────────────────────── */

export type XpRow = {
  key: 'wins' | 'championships' | 'playoffs' | 'seasons' | 'leagueSize'
  /** "187 wins × 10" — the rule, spelled out. */
  detail: string
  xp: number
  /** 0..1 share of the largest term, for the proportional bar. */
  share: number
  /** `false` for the league-size bonus, which has no single multiplicand. */
  hasBar: boolean
}

/**
 * How the stored XP total lines up with the published rules over today's ledger.
 *
 * ⚠ THE LEAGUE-SIZE BONUS IS COMPUTED, NOT BACK-SOLVED. The screen used to
 * attribute "stored minus the four other terms" to the bonus, because it could
 * not see the rows. It now can, so every term is computed and a difference from
 * the stored total means exactly one thing: the total was written before the
 * ledger or the rules last changed.
 */
export type XpReconciliation = {
  /** The published rules over the current ledger. */
  computed: number
  /** `xp_total` as stored, or null if the profile was never ranked. */
  stored: number | null
  /** When the stored total was written. */
  storedAt: string | null
  matches: boolean
}

export function buildXpRows(xp: CareerXp): XpRow[] {
  const rows: XpRow[] = [
    {
      key: 'wins',
      detail: `${xp.wins.toLocaleString()} wins × ${RANK_XP_PER_IMPORT_WIN}`,
      xp: xp.wins * RANK_XP_PER_IMPORT_WIN,
      share: 0,
      hasBar: true,
    },
    {
      key: 'championships',
      detail: `${xp.championships} championships × ${RANK_XP_PER_CHAMPIONSHIP}`,
      xp: xp.championships * RANK_XP_PER_CHAMPIONSHIP,
      share: 0,
      hasBar: true,
    },
    {
      key: 'playoffs',
      detail: `${xp.playoffAppearances} playoff appearances × ${RANK_XP_PER_PLAYOFF_APPEARANCE}`,
      xp: xp.playoffAppearances * RANK_XP_PER_PLAYOFF_APPEARANCE,
      share: 0,
      hasBar: true,
    },
    {
      key: 'seasons',
      detail: `${xp.distinctSeasons} ${xp.distinctSeasons === 1 ? 'season' : 'seasons'} × ${RANK_XP_PER_DISTINCT_SEASON}`,
      xp: xp.distinctSeasons * RANK_XP_PER_DISTINCT_SEASON,
      share: 0,
      hasBar: true,
    },
    {
      key: 'leagueSize',
      detail: `League-size bonus — (size − 10) × ${RANK_XP_LEAGUE_SIZE_MULTIPLIER} over ${xp.leagueSeasons.toLocaleString()} league-seasons`,
      xp: xp.leagueSizeBonus,
      share: 0,
      // A sum over leagues rather than one count times one weight, so a bar
      // would imply a precision the row does not have.
      hasBar: false,
    },
  ]
  const max = Math.max(1, ...rows.filter((r) => r.hasBar).map((r) => r.xp))
  for (const r of rows) r.share = r.hasBar ? r.xp / max : 0
  return rows
}

/* ───────────────────────────── the page payload ─────────────────────────── */

export type RankingsScopeKey = 'global' | 'portfolio' | 'league'

export type YourRank = {
  handle: string | null
  level: number
  levelName: string
  tier: string
  tierGroup: number
  totalLevels: number
  xp: number
  progressPct: number
  xpToNext: number | null
  nextLevelName: string | null
} | null

/** One board row, flattened for the client table. */
export type BoardTableRow = {
  userId: string
  rank: number
  handle: string
  avatarUrl: string | null
  level: number
  tierGroup: number
  isYou: boolean
  metric: string
  score: string
  winRate: string
  titles: string
  playoffs: string
  scoring: string
  sample: string
  confidence: ManagerScore['confidence']
  /** Places climbed in seven days; null when there is no snapshot to compare. */
  movement: number | null
  updated: string | null
  explainHref: string
  compareHref: string | null
}

export type PortfolioTableRow = {
  key: string
  season: number
  league: string
  platform: string
  type: string
  format: string
  size: string
  record: string
  ppg: string
  index: string
  finish: string
  counted: boolean
  updated: string | null
}

export type Movement = {
  /** Places climbed; null when unknown. */
  sevenDay: number | null
  week: number | null
  season: number | null
}

export type RankingsData = {
  scope: RankingsScopeKey
  signedIn: boolean
  filters: RankingFilters
  filtersLabel: string
  options: FilterOptions
  /** Query string that carries the active filters, board and sort — for links. */
  baseQuery: string
  you: YourRank
  xpRows: XpRow[]
  reconciliation: XpReconciliation | null
  ladder: LadderTier[]
  /** Managers ever ranked — stated, never implied. */
  population: number
  computedAt: string
  shareUrl: string | null
  global: GlobalView | null
  portfolio: PortfolioView | null
  league: LeagueView | null
}

export type GlobalView = {
  board: BoardKey
  label: string
  metricLabel: string
  unavailable: string | null
  tabs: Array<{ key: BoardKey; label: string; href: string }>
  rows: BoardTableRow[]
  sort: SortKey
  dir: SortDir
  belowSample: number
  unmeasured: number
  /** Movement is recorded for the unfiltered Overall board only. */
  movementTracked: boolean
  trackingSince: string | null
  you: { rank: number; of: number; display: string; movement: Movement } | null
  explain: { handle: string; rank: number; score: ManagerScore; isYou: boolean } | null
  freshness: { newestImport: string | null; stalestManager: string | null; ledgerRows: number }
}

export type PortfolioView = {
  score: ManagerScore
  globalRank: { rank: number; of: number } | null
  movement: Movement
  seasons: SeasonTrendPoint[]
  daily: TrendPoint[]
  weekly: TrendPoint[]
  trackingSince: string | null
  rows: PortfolioTableRow[]
  psort: 'season' | 'record' | 'index' | 'size'
  pdir: SortDir
  freshness: { newestImport: string | null; rankCalculatedAt: string | null; ledgerRows: number }
}

export type LeagueView = {
  leagues: Array<{ id: string; name: string; platform: string; season: number }>
  selected: {
    id: string
    name: string
    platform: string
    season: number
    lastSyncedAt: string | null
  } | null
  board: {
    available: boolean
    reason: string | null
    rows: Array<{ rosterId: string; rank: number; name: string; record: string; pointsFor: number; average: number | null; movement: number | null; isYou: boolean }>
    week: number | null
    seasonComplete: boolean
  } | null
}

type Params = Record<string, string | string[] | undefined>

function one(sp: Params, key: string): string | null {
  const v = sp[key]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

function qs(pairs: Array<[string, string | null | undefined]>): string {
  const p = new URLSearchParams()
  for (const [k, v] of pairs) if (v != null && v !== '') p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function parseScope(raw: string | null, hasLeague: boolean): RankingsScopeKey {
  if (raw === 'global' || raw === 'portfolio' || raw === 'league') return raw
  return hasLeague ? 'league' : 'global'
}

const MOVE_WINDOW_DAYS = 8
const WEEKLY_POINTS = 8

function movementDates(today: string) {
  const sevenBack = [7, 8, 9].map((d) => shiftDateKey(today, -d))
  let weekStart = fantasyWeekStartKey(today)
  if (weekStart === today) weekStart = shiftDateKey(today, -7)
  const daily = Array.from({ length: MOVE_WINDOW_DAYS }, (_, i) => shiftDateKey(today, -(MOVE_WINDOW_DAYS - 1 - i)))
  const thisWeek = fantasyWeekStartKey(today)
  const weekly = Array.from({ length: WEEKLY_POINTS }, (_, i) => shiftDateKey(thisWeek, -7 * (WEEKLY_POINTS - 1 - i)))
  return { sevenBack, weekStart, daily, weekly }
}

function firstPresent(keys: string[], snaps: Map<string, RankSnapshot>): RankSnapshot | null {
  for (const k of keys) {
    const s = snaps.get(k)
    if (s) return s
  }
  return null
}

/**
 * One point per requested date, `null` where no snapshot was written that day —
 * a gap stays a gap rather than being joined across. Empty when no date in the
 * window has a snapshot at all, so the screen can say tracking has not begun.
 */
function pointsFor(userId: string, dateKeys: string[], snaps: Map<string, RankSnapshot>): TrendPoint[] {
  if (!dateKeys.some((d) => snaps.has(d))) return []
  const byDate = new Map(dateKeys.map((d) => [d, snaps.get(d)] as const))
  return dateKeys.map((d) => {
    const snap = byDate.get(d)
    if (!snap) return { label: d, rank: null, score: null }
    return seriesFor(userId, [snap])[0]
  })
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${(Math.round(n * 1000) / 10).toFixed(1)}%`
}

function finishLabel(r: CareerLedgerRow): string {
  if (r.specialty === 'draft_only') return 'Draft only'
  if (!isResultRow(r)) return 'Not started'
  if (!r.completed) return 'In progress'
  if (r.wonChampionship) return 'Champion'
  if (r.madePlayoffs) return 'Playoffs'
  return r.playoffTeams == null ? 'Completed' : 'Missed playoffs'
}

function formatLabel(r: CareerLedgerRow): string {
  const parts: string[] = []
  if (r.scoring === 'ppr') parts.push('PPR')
  else if (r.scoring === 'half') parts.push('Half PPR')
  else if (r.scoring === 'standard') parts.push('Std')
  if (r.superflex) parts.push('SF')
  if (r.tePremium) parts.push('TEP')
  return parts.join(' · ') || '—'
}

function typeLabel(r: CareerLedgerRow): string {
  const base = r.leagueType === 'unknown' ? '' : r.leagueType.charAt(0).toUpperCase() + r.leagueType.slice(1)
  const special = r.specialty === 'bestball' ? 'Best ball' : r.specialty === 'guillotine' ? 'Guillotine' : r.specialty === 'draft_only' ? 'Draft only' : ''
  return [base, special].filter(Boolean).join(' · ') || '—'
}

function portfolioRow(r: CareerLedgerRow, cohorts: ScoringCohorts): PortfolioTableRow {
  const cohort = cohorts.get(cohortKey(r))
  const ppg = r.pointsFor != null && r.gamesPlayed > 0 ? r.pointsFor / r.gamesPlayed : null
  return {
    key: r.key,
    season: r.season,
    league: r.leagueName?.trim() || 'Unnamed league',
    platform: platformLabel(r.platform),
    type: typeLabel(r),
    format: formatLabel(r),
    size: r.leagueSizeKnown ? `${r.leagueSize}${r.playoffTeams ? ` · top ${r.playoffTeams}` : ''}` : '—',
    record: r.gamesPlayed > 0 ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}` : '—',
    ppg: ppg == null ? '—' : ppg.toFixed(1),
    index: ppg != null && cohort ? ((ppg / cohort.mean) * 100).toFixed(1) : '—',
    finish: finishLabel(r),
    counted: isResultRow(r),
    updated: r.updatedAt,
  }
}

function sortPortfolio(rows: CareerLedgerRow[], cohorts: ScoringCohorts, psort: PortfolioView['psort'], pdir: SortDir) {
  const sign = pdir === 'asc' ? 1 : -1
  const idx = (r: CareerLedgerRow) => {
    const c = cohorts.get(cohortKey(r))
    return r.pointsFor != null && r.gamesPlayed > 0 && c ? r.pointsFor / r.gamesPlayed / c.mean : null
  }
  const win = (r: CareerLedgerRow) => (r.gamesPlayed > 0 ? (r.wins + r.ties / 2) / r.gamesPlayed : null)
  const val = (r: CareerLedgerRow): number | null =>
    psort === 'season' ? r.season : psort === 'record' ? win(r) : psort === 'index' ? idx(r) : r.leagueSizeKnown ? r.leagueSize : null
  return [...rows].sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    if (va == null && vb == null) return (a.leagueName ?? '').localeCompare(b.leagueName ?? '')
    if (va == null) return 1
    if (vb == null) return -1
    return (va - vb) * sign || (a.leagueName ?? '').localeCompare(b.leagueName ?? '')
  })
}

function toBoardRow(
  row: ReturnType<typeof rankBoard>['rows'][number],
  youId: string | null,
  movement: number | null,
  linkBase: Array<[string, string]>,
): BoardTableRow {
  const s = row.score
  return {
    userId: row.userId,
    rank: row.rank,
    handle: row.handle,
    avatarUrl: row.avatarUrl,
    level: row.level,
    tierGroup: row.tierGroup,
    isYou: youId != null && row.userId === youId,
    metric: row.display,
    score: s.score == null ? '—' : s.score.toFixed(1),
    winRate: fmtPct(s.totals.adjWinRate),
    titles: s.sample.completedSeasons > 0 ? `${s.totals.titles} / ${s.totals.expectedTitles.toFixed(1)}` : '—',
    playoffs: s.totals.playoffRatio == null ? '—' : `${s.totals.playoffRatio.toFixed(2)}×`,
    scoring: s.totals.scoringIndex == null ? '—' : s.totals.scoringIndex.toFixed(1),
    sample: `${s.sample.resultSeasons} · ${s.sample.games.toLocaleString()} g`,
    confidence: s.confidence,
    movement,
    updated: s.newestUpdate,
    explainHref: `/core/rankings${qs([...linkBase, ['explain', row.userId]])}#rk-explain`,
    compareHref:
      youId != null && row.userId !== youId
        ? `/core/rankings${qs([['view', 'compare'], ['kind', 'managers'], ['user', row.handle], ...linkBase.filter(([k]) => k !== 'scope' && k !== 'board' && k !== 'sort' && k !== 'dir')])}`
        : null,
  }
}

export async function getRankingsData(
  userId: string | null,
  leagueId: string | null = null,
  sp: Params = {},
  now: Date = new Date(),
): Promise<RankingsData> {
  const filters = parseRankingFilters(sp)
  const scope = parseScope(one(sp, 'scope'), leagueId != null)
  const board = parseBoard(one(sp, 'board'))
  const { sort, dir } = parseSort(one(sp, 'sort'), one(sp, 'dir'))

  const [base, mineRows, visibleLeagues] = await Promise.all([
    loadCommunity(),
    userId ? loadCareerLedger([userId]).catch(() => [] as CareerLedgerRow[]) : Promise.resolve([] as CareerLedgerRow[]),
    userId && scope === 'league'
      ? prisma.league
          .findMany({
            where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
            select: { id: true, name: true, platform: true, season: true, lastSyncedAt: true },
            orderBy: [{ season: 'desc' }, { name: 'asc' }],
          })
          .catch(() => [])
      : Promise.resolve([] as Array<{ id: string; name: string | null; platform: string; season: number; lastSyncedAt: Date | null }>),
  ])

  const profile = userId ? base.profiles.find((p) => p.userId === userId) ?? null : null

  /*
   * Your own XP is computed from YOUR ledger read directly, not the community
   * memo — you should see an import you finished a moment ago, and you may not
   * be in the ranked population yet.
   */
  let you: YourRank = null
  let xpRows: XpRow[] = []
  let reconciliation: XpReconciliation | null = null
  if (userId && mineRows.length > 0) {
    const xp = careerXp(mineRows)
    xpRows = buildXpRows(xp)
    const stored = profile?.xpTotal ?? null
    reconciliation = {
      computed: xp.total,
      stored,
      storedAt: profile?.rankCalculatedAt ?? null,
      matches: stored == null || stored === xp.total,
    }
    const lvl = getLevelFromXp(xp.total)
    you = {
      handle: profile ? handleOf(profile) : null,
      level: lvl.level,
      levelName: lvl.name,
      tier: lvl.tier,
      tierGroup: lvl.tierGroup,
      totalLevels: RANK_LEVELS.length,
      xp: xp.total,
      progressPct: lvl.progressPct,
      xpToNext: lvl.nextLevel ? lvl.nextLevel.minXp - xp.total : null,
      nextLevelName: lvl.nextLevel?.name ?? null,
    }
  }

  const baseParams: Array<[string, string]> = [
    ...(scope !== 'global' ? ([['scope', scope]] as Array<[string, string]>) : []),
    ...(leagueId ? ([['league', leagueId]] as Array<[string, string]>) : []),
    ...filterParams(filters),
  ]
  const boardParams: Array<[string, string]> = [
    ...baseParams,
    ...(board !== 'overall' ? ([['board', board]] as Array<[string, string]>) : []),
  ]

  const today = easternDateKey(now)
  const dates = movementDates(today)
  const needSnapshots = scope === 'global' || scope === 'portfolio'
  const [snaps, trackingSince] = needSnapshots
    ? await Promise.all([
        readRankSnapshots([...dates.sevenBack, dates.weekStart, ...dates.daily, ...dates.weekly]),
        firstSnapshotDate(),
      ])
    : [new Map<string, RankSnapshot>(), null]
  const sevenSnap = firstPresent(dates.sevenBack, snaps)
  const weekSnap = snaps.get(dates.weekStart) ?? null

  // The unfiltered Overall board — what snapshots record, and the "where you sit" answer.
  const overallEntries = communityEntries(base, DEFAULT_FILTERS)
  const overall = rankBoard(overallEntries, 'overall', DEFAULT_FILTERS.minSample)
  const maxSeason = base.rows.reduce((m, r) => Math.max(m, r.season), 0)
  const lastSeasonBoard =
    maxSeason > 0 ? rankBoard(communityEntries(base, DEFAULT_FILTERS, maxSeason - 1), 'overall', DEFAULT_FILTERS.minSample) : null
  const overallYou = userId ? overall.rows.find((r) => r.userId === userId) ?? null : null
  const lastSeasonYou = userId && lastSeasonBoard ? lastSeasonBoard.rows.find((r) => r.userId === userId) ?? null : null
  const yourMovement: Movement = {
    sevenDay: userId ? movementSince(userId, overallYou?.rank ?? null, sevenSnap) : null,
    week: userId ? movementSince(userId, overallYou?.rank ?? null, weekSnap) : null,
    season: overallYou && lastSeasonYou ? lastSeasonYou.rank - overallYou.rank : null,
  }

  let global: GlobalView | null = null
  if (scope === 'global') {
    const entries = isDefaultFilters(filters) ? overallEntries : communityEntries(base, filters)
    const ranked = rankBoard(entries, board, filters.minSample)
    const tracked = board === 'overall' && isDefaultFilters(filters)
    const rows = sortBoardRows(
      ranked.rows.map((r) => ({ ...r, movement: tracked ? movementSince(r.userId, r.rank, sevenSnap) : null })),
      sort,
      dir,
    )
    const sortParams: Array<[string, string]> = [
      ...boardParams,
      ...(sort !== 'rank' ? ([['sort', sort]] as Array<[string, string]>) : []),
      ...(dir !== parseSort(sort, null).dir ? ([['dir', dir]] as Array<[string, string]>) : []),
    ]
    const tableRows = rows.map((r) => toBoardRow(r, userId, r.movement, sortParams))
    const yourRow = userId ? ranked.rows.find((r) => r.userId === userId) ?? null : null
    const explainId = one(sp, 'explain')
    const explainRow = explainId ? ranked.rows.find((r) => r.userId === explainId) ?? null : null
    const filteredRows = base.rows.filter((r) => matchesFilters(r, filters))
    const newestPerManager = base.profiles
      .map((p) => entries.find((e) => e.userId === p.userId)?.score.newestUpdate ?? null)
      .filter((s): s is string => !!s)
      .sort()

    global = {
      board,
      label: BOARD_META[board].label,
      metricLabel: BOARD_META[board].metricLabel,
      unavailable: BOARD_META[board].unavailable,
      tabs: BOARD_KEYS.map((key) => ({
        key,
        label: BOARD_META[key].label,
        href: `/core/rankings${qs([...baseParams, ...(key !== 'overall' ? ([['board', key]] as Array<[string, string]>) : [])])}`,
      })),
      rows: tableRows,
      sort,
      dir,
      belowSample: ranked.belowSample,
      unmeasured: ranked.unmeasured,
      movementTracked: tracked,
      trackingSince,
      you: yourRow
        ? {
            rank: yourRow.rank,
            of: ranked.rows.length,
            display: yourRow.display,
            movement: tracked ? yourMovement : { sevenDay: null, week: null, season: null },
          }
        : null,
      explain: explainRow
        ? { handle: explainRow.handle, rank: explainRow.rank, score: explainRow.score, isYou: explainRow.userId === userId }
        : null,
      freshness: {
        newestImport: newestPerManager.length ? newestPerManager[newestPerManager.length - 1] : null,
        stalestManager: newestPerManager.length ? newestPerManager[0] : null,
        ledgerRows: filteredRows.length,
      },
    }
  }

  let portfolio: PortfolioView | null = null
  if (scope === 'portfolio' && userId) {
    const mine = mineRows.filter((r) => matchesFilters(r, filters))
    const psortRaw = one(sp, 'psort')
    const psort: PortfolioView['psort'] =
      psortRaw === 'record' || psortRaw === 'index' || psortRaw === 'size' ? psortRaw : 'season'
    const pdirRaw = one(sp, 'pdir')
    const pdir: SortDir = pdirRaw === 'asc' || pdirRaw === 'desc' ? pdirRaw : 'desc'
    const stamps = mine.map((r) => r.updatedAt).filter((s): s is string => !!s).sort()
    portfolio = {
      score: scoreRows(mine, base.cohorts),
      globalRank: overallYou ? { rank: overallYou.rank, of: overall.rows.length } : null,
      movement: yourMovement,
      seasons: seasonTrend(mine, base.cohorts),
      daily: pointsFor(userId, dates.daily, snaps),
      weekly: pointsFor(userId, dates.weekly, snaps),
      trackingSince,
      rows: sortPortfolio(mine, base.cohorts, psort, pdir).map((r) => portfolioRow(r, base.cohorts)),
      psort,
      pdir,
      freshness: {
        newestImport: stamps.length ? stamps[stamps.length - 1] : null,
        rankCalculatedAt: profile?.rankCalculatedAt ?? null,
        ledgerRows: mine.length,
      },
    }
  }

  let league: LeagueView | null = null
  if (scope === 'league') {
    const selected = leagueId ? visibleLeagues.find((l) => l.id === leagueId) ?? null : null
    let leagueBoard: LeagueView['board'] = null
    if (userId && selected) {
      const standings = await getLeagueStandings(selected.id, userId).catch(() => null)
      leagueBoard = standings?.available
        ? {
            available: true,
            reason: null,
            week: standings.week,
            seasonComplete: standings.seasonComplete,
            rows: standings.teams.map((team) => ({
              rosterId: team.rosterId,
              rank: team.rank,
              name: team.name ?? `Roster ${team.rosterId}`,
              record: `${team.wins}-${team.losses}`,
              pointsFor: team.pointsFor,
              average: team.average,
              movement: team.movement,
              isYou: team.isYou,
            })),
          }
        : {
            available: false,
            reason: standings && !standings.available ? standings.reason : 'League standings could not be read just now.',
            rows: [],
            week: null,
            seasonComplete: false,
          }
    }
    league = {
      leagues: visibleLeagues.map((l) => ({
        id: l.id,
        name: l.name?.trim() || 'Unnamed league',
        platform: platformLabel(String(l.platform ?? 'allfantasy').toLowerCase()),
        season: l.season,
      })),
      selected: selected
        ? {
            id: selected.id,
            name: selected.name?.trim() || 'Selected league',
            platform: platformLabel(String(selected.platform ?? 'allfantasy').toLowerCase()),
            season: selected.season,
            lastSyncedAt: selected.lastSyncedAt ? selected.lastSyncedAt.toISOString() : null,
          }
        : null,
      board: leagueBoard,
    }
  }

  const optionRows = scope === 'portfolio' ? mineRows : base.rows
  const shareable =
    userId != null && scope === 'global' && global?.you != null
      ? `/api/share/career-card${qs([['design', 'rank'], ...boardParams.filter(([k]) => k !== 'scope' && k !== 'league')])}`
      : userId != null && scope === 'portfolio' && portfolio?.score.score != null
        ? `/api/share/career-card${qs([['design', 'rank'], ['scope', 'portfolio'], ...filterParams(filters)])}`
        : null

  return {
    scope,
    signedIn: userId != null,
    filters,
    filtersLabel: describeFilters(filters),
    options: filterOptions(optionRows),
    baseQuery: qs(boardParams),
    you,
    xpRows,
    reconciliation,
    ladder: buildLadder(you?.level ?? null),
    population: base.profiles.length,
    computedAt: base.computedAt,
    shareUrl: shareable,
    global,
    portfolio,
    league,
  }
}

/* ────────────────────────────── share card ──────────────────────────────── */

export type RankCardData = {
  handle: string
  avatarUrl: string | null
  scopeLabel: string
  /** "#2 of 5" or null on the portfolio card. */
  rank: { rank: number; of: number } | null
  boardLabel: string
  metricLabel: string
  metric: string
  score: number | null
  components: Array<{ label: string; points: number; value: string; credit: number | null; available: boolean }>
  filtersLabel: string
  sample: string
  confidence: ManagerScore['confidence']
  level: number
  levelName: string
  tier: string
  computedAt: string
  newestImport: string | null
}

/**
 * The share card's numbers, from the same engine call the page makes.
 *
 * ⚠ NEVER FROM THE CLIENT. The card route takes only the board and filters from
 * the query; every figure is recomputed server-side for the signed-in viewer.
 */
export async function getRankCardData(userId: string, sp: Params): Promise<RankCardData | null> {
  const scope = one(sp, 'scope') === 'portfolio' ? 'portfolio' : 'global'
  const data = await getRankingsData(userId, null, { ...sp, scope })
  if (!data.you) return null
  const handle = data.you.handle ?? 'Manager'

  if (scope === 'portfolio') {
    const p = data.portfolio
    if (!p || p.score.score == null) return null
    return {
      handle,
      avatarUrl: null,
      scopeLabel: 'Across my imported leagues',
      // The community rank is for the unfiltered board, so it only rides along on an unfiltered card.
      rank: isDefaultFilters(data.filters) ? p.globalRank : null,
      boardLabel: 'AF manager score',
      metricLabel: BOARD_META.overall.metricLabel,
      metric: p.score.score.toFixed(1),
      score: p.score.score,
      components: p.score.components.map((c) => ({ label: c.label, points: c.points, value: c.short, credit: c.credit, available: c.available })),
      filtersLabel: data.filtersLabel,
      sample: `${p.score.sample.resultSeasons} league-seasons · ${p.score.sample.games.toLocaleString()} games`,
      confidence: p.score.confidence,
      level: data.you.level,
      levelName: data.you.levelName,
      tier: data.you.tier,
      computedAt: data.computedAt,
      newestImport: p.freshness.newestImport,
    }
  }

  const g = data.global
  const row = g?.rows.find((r) => r.isYou)
  if (!g || !g.you || !row) return null
  const base = await loadCommunity()
  const entry = communityEntries(base, data.filters).find((e) => e.userId === userId)
  if (!entry) return null
  return {
    handle,
    avatarUrl: row.avatarUrl,
    scopeLabel: 'AllFantasy community',
    rank: { rank: g.you.rank, of: g.you.of },
    boardLabel: g.label,
    metricLabel: g.metricLabel,
    metric: g.you.display,
    score: entry.score.score,
    components: entry.score.components.map((c) => ({ label: c.label, points: c.points, value: c.short, credit: c.credit, available: c.available })),
    filtersLabel: data.filtersLabel,
    sample: `${entry.score.sample.resultSeasons} league-seasons · ${entry.score.sample.games.toLocaleString()} games`,
    confidence: entry.score.confidence,
    level: data.you.level,
    levelName: data.you.levelName,
    tier: data.you.tier,
    computedAt: data.computedAt,
    newestImport: entry.score.newestUpdate,
  }
}

/* ──────────────────────────────── compare ───────────────────────────────── */

/**
 * The A+–D scale, shared verbatim with 14b and any future draft-grade surface.
 * 14c build rule 1: one deterministic scale, never a bespoke one per comparison.
 */
export const GRADE_SCALE = [
  { grade: 'A+', min: 93 },
  { grade: 'A', min: 85 },
  { grade: 'A−', min: 78 },
  { grade: 'B+', min: 70 },
  { grade: 'B', min: 62 },
  { grade: 'C', min: 50 },
  { grade: 'D', min: 0 },
] as const

export function gradeFor(score: number): string {
  return GRADE_SCALE.find((g) => score >= g.min)?.grade ?? 'D'
}

export type CompareKind = 'managers' | 'leagues' | 'teams' | 'players'

export function parseCompareKind(raw: string | null | undefined): CompareKind {
  return raw === 'leagues' || raw === 'teams' || raw === 'players' ? raw : 'managers'
}

export type CompareMetric = {
  label: string
  you: string
  them: string
  /** Which side leads, for the `--good` highlight. `null` when tied or unknown. */
  leader: 'you' | 'them' | null
  /** Championships and the overall score get the accent-soft row background. */
  signature: boolean
  /** Set when the row cannot be filled; the row still renders. */
  unavailable?: string
  /** How the row was measured, shown under its label. */
  note?: string
}

export type CompareManager = {
  handle: string
  avatarUrl: string | null
  level: number
  levelName: string
  tier: string
  tierGroup: number
  leagueSeasons: number
  /** Comparison letter grade from the AF manager score, on the shared scale. */
  grade: string
  gradeScore: number | null
  confidence: ManagerScore['confidence']
}

export type CompareData = {
  you: CompareManager
  them: CompareManager
  filtersLabel: string
  metrics: CompareMetric[]
  /** Seasons both managers have results in, newest first. */
  sharedSeasons: Array<{ season: number; you: string; them: string; youScore: number | null; themScore: number | null }>
  /** League-seasons both managers were in. */
  sharedLeagues: Array<{ season: number; league: string; you: string; them: string }>
  headToHeadNote: string
  titleRate: { you: number | null; them: number | null }
  verdict: { headline: string; body: string } | null
}

export type CompareResult =
  | { ok: true; data: CompareData }
  | { ok: false; reason: 'not-found' | 'not-ranked' | 'self' | 'signed-out'; message: string }

function lead(a: number | null, b: number | null): 'you' | 'them' | null {
  if (a == null || b == null || Math.abs(a - b) < 1e-9) return null
  return a > b ? 'you' : 'them'
}

function toCompareManager(e: CommunityEntry, allRows: CareerLedgerRow[]): CompareManager {
  const lvl = levelOf(allRows)
  return {
    handle: e.handle,
    avatarUrl: e.avatarUrl,
    level: lvl.level,
    levelName: lvl.name,
    tier: lvl.tier,
    tierGroup: lvl.tierGroup,
    leagueSeasons: e.score.sample.resultSeasons,
    grade: e.score.score == null ? '—' : gradeFor(e.score.score),
    gradeScore: e.score.score,
    confidence: e.score.confidence,
  }
}

function recordOf(s: ManagerScore): string {
  const t = s.totals
  return `${t.wins.toLocaleString()}–${t.losses.toLocaleString()}${t.ties ? `–${t.ties}` : ''}`
}

/**
 * Compare the signed-in manager against another by handle, on the ledger.
 *
 * ⚠ HEAD-TO-HEAD IS STILL UNANSWERED, AND SHARED LEAGUES ARE NOT A SUBSTITUTE
 * FOR IT. The ledger now finds league-seasons you both played — both managers'
 * own rows carry the same provider league key — so each of your finishes there
 * is real. What no stored row carries is who played whom in which week.
 */
export async function getCompareData(userId: string | null, handle: string, sp: Params = {}): Promise<CompareResult> {
  if (!userId) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to compare your career with another manager.' }
  }
  const filters = parseRankingFilters(sp)
  const base = await loadCommunity()
  const entries = communityEntries(base, filters)
  const me = entries.find((e) => e.userId === userId) ?? null
  if (!me) {
    return {
      ok: false,
      reason: 'not-ranked',
      message: 'Your career has not been ranked yet. Import a league to get a rank, then come back.',
    }
  }

  const needle = handle.trim().replace(/^@/, '').toLowerCase()
  const themProfile =
    base.profiles.find(
      (p) => p.username?.toLowerCase() === needle || p.displayName?.trim().toLowerCase() === needle,
    ) ?? null
  if (!themProfile) {
    return {
      ok: false,
      reason: 'not-found',
      message: `No ranked manager matches @${needle}. Only managers who have been ranked can be compared.`,
    }
  }
  if (themProfile.userId === userId) {
    return { ok: false, reason: 'self', message: 'That is you. Pick another manager to compare against.' }
  }
  const them = entries.find((e) => e.userId === themProfile.userId) as CommunityEntry

  const myRows = (base.rowsByUser.get(userId) ?? []).filter((r) => matchesFilters(r, filters))
  const theirRows = (base.rowsByUser.get(them.userId) ?? []).filter((r) => matchesFilters(r, filters))
  const ms = me.score
  const ts = them.score

  const metrics: CompareMetric[] = [
    {
      label: 'AF manager score',
      you: ms.score == null ? '—' : ms.score.toFixed(1),
      them: ts.score == null ? '—' : ts.score.toFixed(1),
      leader: lead(ms.score, ts.score),
      signature: true,
      note: 'Normalised for league size, playoff cut, scoring format and schedule length',
    },
    {
      label: 'Record',
      you: recordOf(ms),
      them: recordOf(ts),
      leader: lead(ms.totals.winRate, ts.totals.winRate),
      signature: false,
    },
    {
      label: 'Win rate (adjusted)',
      you: fmtPct(ms.totals.adjWinRate),
      them: fmtPct(ts.totals.adjWinRate),
      leader: lead(ms.totals.adjWinRate, ts.totals.adjWinRate),
      signature: false,
      note: 'Per game, blended toward .500 by sample size',
    },
    {
      label: 'Championships',
      you: `${ms.totals.titles} of ${ms.totals.expectedTitles.toFixed(1)} expected`,
      them: `${ts.totals.titles} of ${ts.totals.expectedTitles.toFixed(1)} expected`,
      leader: lead(ms.totals.titleRatio, ts.totals.titleRatio),
      signature: true,
      note: 'Leader is decided by titles against each field’s 1-in-N chance',
    },
    {
      label: 'Playoff berths',
      you: ms.totals.playoffRatio == null ? '—' : `${ms.totals.playoffs} · ${ms.totals.playoffRatio.toFixed(2)}×`,
      them: ts.totals.playoffRatio == null ? '—' : `${ts.totals.playoffs} · ${ts.totals.playoffRatio.toFixed(2)}×`,
      leader: lead(ms.totals.playoffRatio, ts.totals.playoffRatio),
      signature: false,
      note: 'Against each league’s own playoff cut',
    },
    {
      label: 'Scoring index',
      you: ms.totals.scoringIndex == null ? '—' : ms.totals.scoringIndex.toFixed(1),
      them: ts.totals.scoringIndex == null ? '—' : ts.totals.scoringIndex.toFixed(1),
      leader: lead(ms.totals.scoringIndex, ts.totals.scoringIndex),
      signature: false,
      note: '100 = the average team in the same format and season',
      unavailable:
        ms.totals.scoringIndex == null && ts.totals.scoringIndex == null
          ? 'Neither career has a league-season with points in a comparable format group.'
          : undefined,
    },
    {
      label: 'Average field',
      you: ms.field.avgSize == null ? '—' : `${ms.field.avgSize} teams`,
      them: ts.field.avgSize == null ? '—' : `${ts.field.avgSize} teams`,
      leader: null,
      signature: false,
      note: 'Context, not a score — bigger fields are already priced into titles and berths',
    },
    {
      label: 'GM prestige',
      you: ms.prestige.toFixed(1),
      them: ts.prestige.toFixed(1),
      leader: lead(ms.prestige, ts.prestige),
      signature: false,
      note: 'The career page’s capped blend — not normalised',
    },
    {
      label: 'League-seasons with results',
      you: ms.sample.resultSeasons.toLocaleString(),
      them: ts.sample.resultSeasons.toLocaleString(),
      leader: null,
      signature: false,
    },
  ]

  const seasonsYou = new Map<number, CareerLedgerRow[]>()
  const seasonsThem = new Map<number, CareerLedgerRow[]>()
  for (const r of myRows.filter(isResultRow)) seasonsYou.set(r.season, [...(seasonsYou.get(r.season) ?? []), r])
  for (const r of theirRows.filter(isResultRow)) seasonsThem.set(r.season, [...(seasonsThem.get(r.season) ?? []), r])
  const sharedSeasons = [...seasonsYou.keys()]
    .filter((s) => seasonsThem.has(s))
    .sort((a, b) => b - a)
    .map((season) => {
      const a = scoreRows(seasonsYou.get(season) ?? [], base.cohorts)
      const b = scoreRows(seasonsThem.get(season) ?? [], base.cohorts)
      return {
        season,
        you: `${recordOf(a)} · ${a.sample.resultSeasons} lg`,
        them: `${recordOf(b)} · ${b.sample.resultSeasons} lg`,
        youScore: a.score,
        themScore: b.score,
      }
    })

  const theirByKey = new Map(theirRows.map((r) => [r.key, r]))
  const sharedLeagues = myRows
    .filter((r) => theirByKey.has(r.key))
    .sort((a, b) => b.season - a.season)
    .map((r) => {
      const t = theirByKey.get(r.key) as CareerLedgerRow
      const line = (x: CareerLedgerRow) =>
        x.gamesPlayed > 0 ? `${x.wins}-${x.losses}${x.ties ? `-${x.ties}` : ''} · ${finishLabel(x)}` : finishLabel(x)
      return { season: r.season, league: r.leagueName?.trim() || 'Unnamed league', you: line(r), them: line(t) }
    })

  const titleRate = {
    you: ms.totals.playoffs > 0 ? ms.totals.titles / ms.totals.playoffs : null,
    them: ts.totals.playoffs > 0 ? ts.totals.titles / ts.totals.playoffs : null,
  }

  return {
    ok: true,
    data: {
      you: toCompareManager(me, base.rowsByUser.get(userId) ?? []),
      them: toCompareManager(them, base.rowsByUser.get(them.userId) ?? []),
      filtersLabel: describeFilters(filters),
      metrics,
      sharedSeasons,
      sharedLeagues,
      headToHeadNote:
        sharedLeagues.length > 0
          ? `You shared ${sharedLeagues.length} league-${sharedLeagues.length === 1 ? 'season' : 'seasons'}, listed above with each of your finishes. A game-by-game head-to-head needs weekly matchup results, which imported history does not store — so it is unknown, not zero.`
          : 'A head-to-head record needs matchup results from a league you both played in. No league-season in either career is shared, and imported history does not store weekly opponents, so this is unknown rather than zero.',
      titleRate,
      verdict: buildVerdict(me, them),
    },
  }
}

/**
 * The comparison verdict.
 *
 * ⚠ EVERY CLAUSE NAMES THE NUMBER BEHIND IT, and anything the trailing manager
 * leads on is kept as a "despite" clause rather than dropped (14c build rule 3).
 * Assembled from the computed components, so it cannot contradict the table.
 */
function buildVerdict(you: CommunityEntry, them: CommunityEntry): CompareData['verdict'] {
  const a = you.score
  const b = them.score
  if (a.score == null || b.score == null) return null
  const gap = a.score - b.score
  if (Math.abs(gap) < 0.05) {
    return {
      headline: 'Dead even on the AF manager score.',
      body: `Both managers score ${a.score.toFixed(1)}. ${you.handle} holds ${a.totals.titles} ${a.totals.titles === 1 ? 'title' : 'titles'} to ${them.handle}'s ${b.totals.titles}.`,
    }
  }
  const [leader, trailer] = gap > 0 ? [you, them] : [them, you]
  const margin = Math.abs(gap) >= 15 ? 'clearly ahead' : Math.abs(gap) >= 5 ? 'ahead' : 'narrowly ahead'
  const supports: string[] = []
  const counters: string[] = []
  for (const c of leader.score.components) {
    const other = trailer.score.components.find((x) => x.key === c.key)
    if (!other || !c.available || !other.available || c.credit == null || other.credit == null) continue
    if (Math.abs(c.credit - other.credit) < 0.005) continue
    const text = `${c.label.toLowerCase()}: ${c.short} against ${other.short}`
    if (c.credit > other.credit) supports.push(text)
    else counters.push(`${other.label.toLowerCase()}: ${other.short} against ${c.short}`)
  }
  const opening = `AF manager score ${(leader.score.score as number).toFixed(1)} against ${(trailer.score.score as number).toFixed(1)}`
  return {
    headline: `${leader.handle} is ${margin}.`,
    body:
      `${opening}.${supports.length ? ` Ahead on ${joinList(supports, '; ')}.` : ''}` +
      (counters.length ? ` ${trailer.handle} leads on ${joinList(counters, '; ')}.` : '') +
      ' Every figure is judged against the leagues each manager actually played — neither is credited or penalised for seasons the other did not.',
  }
}

function joinList(parts: string[], sep = ', '): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(sep)}${sep === ', ' ? ' and ' : `${sep}and `}${parts[parts.length - 1]}`
}

/* ─────────────────────────── compare: leagues ───────────────────────────── */

export type LeagueCompareSide = {
  key: string
  title: string
  facts: Array<{ label: string; value: string }>
  score: ManagerScore
}

export type LeagueCompareData = {
  options: Array<{ key: string; label: string; season: number }>
  a: LeagueCompareSide | null
  b: LeagueCompareSide | null
  signedIn: boolean
}

/**
 * Two of your league-seasons side by side — the setting each one was, and how
 * you did in it on the same normalised components the boards use.
 */
export async function getLeagueCompareData(userId: string | null, sp: Params): Promise<LeagueCompareData> {
  if (!userId) return { options: [], a: null, b: null, signedIn: false }
  const [rows, base] = await Promise.all([loadCareerLedger([userId]).catch(() => []), loadCommunity()])
  const sorted = [...rows].sort((x, y) => y.season - x.season || (x.leagueName ?? '').localeCompare(y.leagueName ?? ''))
  const side = (key: string | null): LeagueCompareSide | null => {
    const r = key ? sorted.find((x) => x.key === key) : null
    if (!r) return null
    const s = scoreRows([r], base.cohorts)
    const p = portfolioRow(r, base.cohorts)
    return {
      key: r.key,
      title: `${p.league} · ${r.season}`,
      facts: [
        { label: 'Platform', value: p.platform },
        { label: 'Sport', value: r.sport },
        { label: 'League type', value: p.type },
        { label: 'Scoring', value: p.format },
        { label: 'Teams · playoff cut', value: p.size },
        { label: 'Title odds at the start', value: r.leagueSizeKnown ? `1 in ${r.leagueSize}` : '—' },
        { label: 'Your record', value: p.record },
        { label: 'Points per game', value: p.ppg },
        { label: 'Scoring index', value: p.index },
        { label: 'Finish', value: p.finish },
      ],
      score: s,
    }
  }
  return {
    options: sorted.map((r) => ({
      key: r.key,
      label: `${r.season} · ${r.leagueName?.trim() || 'Unnamed league'} (${platformLabel(r.platform)})`,
      season: r.season,
    })),
    a: side(one(sp, 'a')),
    b: side(one(sp, 'b')),
    signedIn: true,
  }
}

/* ──────────────────────────── compare: teams ────────────────────────────── */

export type TeamCompareData = {
  leagues: Array<{ id: string; name: string; season: number }>
  leagueId: string | null
  leagueName: string | null
  teams: Array<{ rosterId: string; name: string }>
  reason: string | null
  a: TeamCompareSide | null
  b: TeamCompareSide | null
}

export type TeamCompareSide = {
  rosterId: string
  name: string
  isYou: boolean
  facts: Array<{ label: string; value: string; raw: number | null; higherIsBetter: boolean }>
}

/** Two teams from one league's own standings. */
export async function getTeamCompareData(userId: string | null, leagueId: string | null, sp: Params): Promise<TeamCompareData> {
  const empty: TeamCompareData = { leagues: [], leagueId, leagueName: null, teams: [], reason: null, a: null, b: null }
  if (!userId) return { ...empty, reason: 'Sign in to compare teams in your leagues.' }
  const leagues = await prisma.league
    .findMany({
      where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
      select: { id: true, name: true, season: true },
      orderBy: [{ season: 'desc' }, { name: 'asc' }],
    })
    .catch(() => [])
  const list = leagues.map((l) => ({ id: l.id, name: l.name?.trim() || 'Unnamed league', season: l.season }))
  if (!leagueId) return { ...empty, leagues: list }
  const standings = await getLeagueStandings(leagueId, userId).catch(() => null)
  if (!standings || !standings.available) {
    return {
      ...empty,
      leagues: list,
      leagueName: list.find((l) => l.id === leagueId)?.name ?? null,
      reason: standings && !standings.available ? standings.reason : 'League standings could not be read just now.',
    }
  }
  const pick = (id: string | null): TeamCompareSide | null => {
    const t = id ? standings.teams.find((x) => x.rosterId === id) : null
    if (!t) return null
    const games = t.wins + t.losses
    return {
      rosterId: t.rosterId,
      name: t.name ?? `Roster ${t.rosterId}`,
      isYou: t.isYou,
      facts: [
        { label: 'Record', value: `${t.wins}-${t.losses}`, raw: games > 0 ? t.wins / games : null, higherIsBetter: true },
        { label: 'Points for', value: Math.round(t.pointsFor).toLocaleString(), raw: t.pointsFor, higherIsBetter: true },
        { label: 'Points per week', value: t.average == null ? '—' : t.average.toFixed(1), raw: t.average, higherIsBetter: true },
        { label: 'Points rank', value: `#${t.rank} of ${standings.teams.length}`, raw: -t.rank, higherIsBetter: true },
        { label: 'Weeks scored', value: String(t.weeksPlayed), raw: null, higherIsBetter: true },
        {
          label: 'Last week’s move',
          value: t.movement == null ? '—' : t.movement === 0 ? 'No change' : `${t.movement > 0 ? '▲' : '▼'} ${Math.abs(t.movement)}`,
          raw: t.movement,
          higherIsBetter: true,
        },
      ],
    }
  }
  return {
    leagues: list,
    leagueId,
    leagueName: standings.league.name,
    teams: standings.teams.map((t) => ({ rosterId: t.rosterId, name: t.name ?? `Roster ${t.rosterId}` })),
    reason: null,
    a: pick(one(sp, 'a')),
    b: pick(one(sp, 'b')),
  }
}

/* ─────────────────────────── compare: players ───────────────────────────── */

export const PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'] as const

export type PlayerPickData = {
  position: string | null
  qa: string
  qb: string
  a: string | null
  b: string | null
  matchesA: Array<PlayerMatch & { ref: string }>
  matchesB: Array<PlayerMatch & { ref: string }>
  /** The Player Finder's own side-by-side, once both are picked. */
  compareHref: string | null
}

function positionMatches(p: PlayerMatch, pos: string | null): boolean {
  if (!pos) return true
  const have = String(p.position ?? '').toUpperCase()
  if (pos === 'DEF') return have === 'DEF' || have === 'DST' || have === 'D/ST'
  if (pos === 'DL') return ['DL', 'DE', 'DT', 'EDGE'].includes(have)
  if (pos === 'DB') return ['DB', 'CB', 'S', 'SS', 'FS'].includes(have)
  return have === pos
}

/**
 * Player pickers for the compare hub. The comparison itself is the Player
 * Finder's (`/core/players?player=&vs=`), which prices both players in your own
 * leagues — this only narrows the search by position and hands over the refs.
 */
export async function getPlayerPickData(sp: Params): Promise<PlayerPickData> {
  const posRaw = one(sp, 'pos')?.toUpperCase() ?? null
  const position = posRaw && (PLAYER_POSITIONS as readonly string[]).includes(posRaw) ? posRaw : null
  const qa = one(sp, 'qa') ?? ''
  const qb = one(sp, 'qb') ?? ''
  const a = one(sp, 'a')
  const b = one(sp, 'b')
  const search = async (q: string) =>
    q.length >= 2
      ? (await searchPlayers(q, 24).catch(() => []))
          .filter((p) => positionMatches(p, position))
          .slice(0, 12)
          .map((p) => ({ ...p, ref: playerRef(p.sport, p.externalId) }))
      : []
  const [matchesA, matchesB] = await Promise.all([search(qa), search(qb)])
  return {
    position,
    qa,
    qb,
    a,
    b,
    matchesA,
    matchesB,
    compareHref:
      a && b
        ? `/core/players${qs([['q', qa || null], ['player', a], ['vs', b]])}`
        : null,
  }
}

/** Labels re-exported for the screens, so they import one module. */
export { TYPE_LABEL, FORMAT_LABEL }
