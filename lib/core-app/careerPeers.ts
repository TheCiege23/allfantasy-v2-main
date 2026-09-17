import 'server-only'

import { loadCareerLedger, type CareerLedgerRow } from '@/lib/rank/careerLedger'
import { communityEntries, handleOf, levelOf, loadCommunity, type CommunityBase } from '@/lib/core-app/rankingsCommunity'
import {
  DEFAULT_FILTERS,
  DEFAULT_MIN_SAMPLE,
  FORMAT_LABEL,
  TYPE_LABEL,
  matchesFilters,
  rankBoard,
  scoreRows,
  type FormatFilter,
  type LeagueTypeFilter,
  type CommunityEntry,
  type ManagerScore,
  type RankingFilters,
} from '@/lib/core-app/rankingsEngine'
import { loadCareerGames, type LeagueScoring } from '@/lib/core-app/careerRecords'
import type { CareerFilter } from '@/lib/core-app/careerModel'

/**
 * Peer comparisons (brief item 7) and the rank line on the progression chart
 * (item 6).
 *
 * ── Two different "peers", and they are not interchangeable ────────────────
 *
 *   Your leagues   What the leagues you actually played in make likely: .500,
 *                  one title in N, the league's own playoff cut, and the points
 *                  everyone else in those same league-seasons scored.
 *   Your format    Other AllFantasy managers with enough seasons in the same
 *                  kind of league (dynasty, PPR…), scored by the rankings engine
 *                  so this page and `/core/rankings` can never disagree.
 *
 * ⚠ THE COMMUNITY IS SMALL AND THE SCREEN SAYS SO. Seven managers were ranked on
 * 2026-09-16. A "top 30%" out of seven is one place; every cohort line carries
 * its population, and a cohort of fewer than two other managers is not shown as
 * a comparison at all.
 *
 * ⚠ THE LEDGER, NOT THE PROFILE ROWS, IS SCORED HERE. Peers are scored from the
 * career ledger (`lib/rank/careerLedger.ts`), because that is what every other
 * manager is scored from — comparing your profile rows against their ledger rows
 * would be two definitions of a season on one line.
 */

/** Fewer other managers than this and a cohort is not a comparison. */
export const MIN_PEERS = 2

export type PeerMetric = {
  key: 'overall' | 'winRate' | 'titles' | 'playoffs' | 'scoring'
  label: string
  you: number | null
  median: number | null
  youLabel: string
  medianLabel: string
  /** Higher is better for every metric here. Null when either side is unmeasured. */
  ahead: boolean | null
}

export type PeerCohort = {
  key: string
  label: string
  /** Your league-seasons with results in this cohort. */
  yourSample: number
  /** Other managers with at least `DEFAULT_MIN_SAMPLE` result seasons in it. */
  peers: number
  /** Your place on the Overall board inside the cohort, or null if you do not qualify. */
  rank: number | null
  of: number
  metrics: PeerMetric[]
}

export type RankPoint = { season: number; rank: number | null; of: number; score: number | null }

export type CareerPeers = {
  /** Whether this account is on the community board at all. */
  ranked: boolean
  population: number
  computedAt: string
  you: ManagerScore
  vsLeagues: {
    winRate: number | null
    titles: { won: number; expected: number; completed: number }
    playoffs: { made: number; expected: number; judged: number }
    scoringIndex: number | null
    pricedGames: number
    points: LeagueScoring
  }
  cohorts: PeerCohort[]
  /** Your Overall rank as of the end of each season — the progression chart's rank line. */
  rankBySeason: RankPoint[]
}

const pct = (n: number | null) => (n == null ? '—' : `${(Math.round(n * 1000) / 10).toFixed(1)}%`)
const ratio = (n: number | null) => (n == null ? '—' : `${(Math.round(n * 100) / 100).toFixed(2)}×`)
const idx = (n: number | null) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1))

function median(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function metricsFor(you: ManagerScore, peers: ManagerScore[]): PeerMetric[] {
  const defs: Array<{ key: PeerMetric['key']; label: string; get: (s: ManagerScore) => number | null; fmt: (n: number | null) => string }> = [
    { key: 'overall', label: 'AF score', get: (s) => s.score, fmt: idx },
    { key: 'winRate', label: 'Win rate (adjusted)', get: (s) => s.totals.adjWinRate, fmt: pct },
    { key: 'titles', label: 'Titles vs expected', get: (s) => s.totals.titleRatio, fmt: ratio },
    { key: 'playoffs', label: 'Playoffs vs cut', get: (s) => s.totals.playoffRatio, fmt: ratio },
    { key: 'scoring', label: 'Scoring index', get: (s) => s.totals.scoringIndex, fmt: idx },
  ]
  return defs.map((d) => {
    const mine = d.get(you)
    const med = median(peers.map(d.get))
    return {
      key: d.key,
      label: d.label,
      you: mine,
      median: med,
      youLabel: d.fmt(mine),
      medianLabel: d.fmt(med),
      ahead: mine == null || med == null ? null : mine >= med,
    }
  })
}

/** The cohorts worth comparing in: your most common league type and scoring, and both together. */
export function pickCohorts(rows: CareerLedgerRow[]): Array<{ key: string; label: string; filters: RankingFilters }> {
  const results = rows.filter((r) => r.gamesPlayed > 0)
  const count = <K extends string>(get: (r: CareerLedgerRow) => K | null) => {
    const m = new Map<K, number>()
    for (const r of results) {
      const k = get(r)
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  }
  const type = count<LeagueTypeFilter>((r) =>
    r.specialty === 'bestball' || r.specialty === 'guillotine'
      ? r.specialty
      : r.leagueType === 'unknown'
        ? null
        : (r.leagueType as LeagueTypeFilter),
  )
  const format = count<FormatFilter>((r) => (r.scoring === 'ppr' || r.scoring === 'half' || r.scoring === 'standard' ? r.scoring : null))

  const out: Array<{ key: string; label: string; filters: RankingFilters }> = []
  if (type && type[1] >= DEFAULT_MIN_SAMPLE) {
    out.push({ key: `type:${type[0]}`, label: `${TYPE_LABEL[type[0]]} leagues`, filters: { ...DEFAULT_FILTERS, type: type[0] } })
  }
  if (format && format[1] >= DEFAULT_MIN_SAMPLE) {
    out.push({ key: `format:${format[0]}`, label: `${FORMAT_LABEL[format[0]]} leagues`, filters: { ...DEFAULT_FILTERS, format: format[0] } })
  }
  if (type && format) {
    const both = results.filter(
      (r) => (r.leagueType === type[0] || r.specialty === type[0]) && r.scoring === format[0],
    ).length
    if (both >= DEFAULT_MIN_SAMPLE) {
      out.push({
        key: `both:${type[0]}:${format[0]}`,
        label: `${TYPE_LABEL[type[0]]} ${FORMAT_LABEL[format[0]]} leagues`,
        filters: { ...DEFAULT_FILTERS, type: type[0], format: format[0] },
      })
    }
  }
  return out
}

/**
 * Narrow the ledger to what the page's filter shows. Only the fields both
 * shapes share: platform, sport, season, and the league by name.
 */
function narrow(rows: CareerLedgerRow[], f: CareerFilter): CareerLedgerRow[] {
  return rows.filter((r) => {
    if (f.platform && r.platform !== f.platform) return false
    if (f.sport && r.sport !== f.sport) return false
    if (f.league && (r.leagueName ?? '').trim().toLowerCase() !== f.league) return false
    if (f.fromSeason != null && r.season < f.fromSeason) return false
    if (f.toSeason != null && r.season > f.toSeason) return false
    return true
  })
}

/**
 * Every ranked manager scored inside one cohort, under the page's platform,
 * sport and era — but never its league filter, which names one of YOUR leagues
 * and would leave nobody to compare against.
 *
 * ⚠ THE SAME NARROWING ON BOTH SIDES. Scoring your 2022–2024 against their whole
 * careers would compare two different spans on one line.
 */
function cohortEntries(base: CommunityBase, cohort: RankingFilters, filter: CareerFilter): CommunityEntry[] {
  const span: CareerFilter = { ...filter, league: null }
  return base.profiles.map((p) => {
    const all = base.rowsByUser.get(p.userId) ?? []
    const rows = narrow(all, span).filter((r) => matchesFilters(r, cohort))
    const lvl = levelOf(all)
    return {
      userId: p.userId,
      handle: handleOf(p),
      avatarUrl: p.avatarUrl,
      level: lvl.level,
      tierGroup: lvl.tierGroup,
      score: scoreRows(rows, base.cohorts),
    }
  })
}

export async function getCareerPeers(userId: string, filter: CareerFilter): Promise<CareerPeers> {
  const [base, games] = await Promise.all([loadCommunity(), loadCareerGames(userId, filter)])
  const ranked = base.rowsByUser.has(userId)
  const allMine = ranked ? (base.rowsByUser.get(userId) ?? []) : await loadCareerLedger([userId])
  const mine = narrow(allMine, filter)
  const you = scoreRows(mine, base.cohorts)

  const cohorts: PeerCohort[] = []
  for (const c of pickCohorts(mine)) {
    const peerEntries = cohortEntries(base, c.filters, filter).filter((e) => e.userId !== userId)
    const peers = peerEntries.filter((e) => e.score.sample.resultSeasons >= DEFAULT_MIN_SAMPLE)
    if (peers.length < MIN_PEERS) continue
    const youInCohort = scoreRows(mine.filter((r) => matchesFilters(r, c.filters)), base.cohorts)
    const board = rankBoard(
      [...peerEntries, { userId, handle: 'you', avatarUrl: null, level: 0, tierGroup: 0, score: youInCohort }],
      'overall',
      DEFAULT_MIN_SAMPLE,
    )
    const row = board.rows.find((r) => r.userId === userId)
    cohorts.push({
      key: c.key,
      label: c.label,
      yourSample: youInCohort.sample.resultSeasons,
      peers: peers.length,
      rank: row?.rank ?? null,
      of: board.rows.length,
      metrics: metricsFor(youInCohort, peers.map((p) => p.score)),
    })
  }

  /*
   * ⚠ RANK AS OF EACH SEASON IS RECOMPUTED FROM TODAY'S LEDGER, and says so on
   * the chart. It is "where these results would have placed you", not a stored
   * rank from that year — the daily snapshots only began on 2026-09-16.
   */
  const seasons = [...new Set(mine.filter((r) => r.gamesPlayed > 0).map((r) => r.season))].sort((a, b) => a - b)
  const rankBySeason: RankPoint[] = []
  if (ranked) {
    for (const s of seasons) {
      const board = rankBoard(communityEntries(base, DEFAULT_FILTERS, s), 'overall', DEFAULT_MIN_SAMPLE)
      const row = board.rows.find((r) => r.userId === userId)
      rankBySeason.push({ season: s, rank: row?.rank ?? null, of: board.rows.length, score: row?.metric ?? null })
    }
  }

  const completed = mine.filter((r) => r.gamesPlayed > 0 && r.completed)
  const cut = completed.filter((r) => r.playoffTeams != null && r.playoffTeams > 0 && r.leagueSizeKnown)

  return {
    ranked,
    population: base.profiles.length,
    computedAt: base.computedAt,
    you,
    vsLeagues: {
      winRate: you.totals.winRate,
      titles: {
        won: completed.filter((r) => r.wonChampionship).length,
        expected: completed.reduce((s, r) => s + 1 / Math.max(2, r.leagueSize), 0),
        completed: completed.length,
      },
      playoffs: {
        made: cut.filter((r) => r.madePlayoffs).length,
        expected: cut.reduce((s, r) => s + Math.min(1, (r.playoffTeams as number) / Math.max(2, r.leagueSize)), 0),
        judged: cut.length,
      },
      scoringIndex: you.totals.scoringIndex,
      pricedGames: you.totals.pricedGames,
      points: games.scoring,
    },
    cohorts,
    rankBySeason,
  }
}
