import { BOARD_META, DEFAULT_FILTERS, type BoardKey } from '@/lib/core-app/rankingsEngine'
import type { BoardTableRow, RankingsData } from '@/lib/core-app/rankings'

/**
 * SAMPLE data for /e2e/rankings-guide (and the tests that render the same screen). Every figure is
 * invented. Kept out of page.tsx because a Next page may not export anything but the page.
 */

/** SAMPLE portfolio — invented leagues and numbers, shaped like PortfolioView. */
export function portfolio() {
  const comp = (key: string, label: string, weight: number, credit: number, value: string) => ({
    key, label, weight, appliedWeight: weight, credit, points: Math.round(credit * weight * 1000) / 10, value, short: value, basis: 'all leagues', explain: 'Sample.', available: true,
  })
  const leagues = ['Sample Dynasty League', 'Sample Redraft League', 'Sample Best Ball', 'Sample Keeper League', 'Sample Guillotine', 'Sample IDP League']
  const rows = Array.from({ length: 12 }, (_, i) => ({
    key: `r${i}`,
    season: 2026 - Math.floor(i / 4),
    league: leagues[i % leagues.length]!,
    platform: i % 3 === 0 ? 'ESPN' : 'Sleeper',
    type: i % 2 ? 'Redraft' : 'Dynasty',
    format: 'PPR',
    size: '12 · 6',
    record: `${8 - (i % 5)}-${5 + (i % 5)}`,
    ppg: (112 + i).toFixed(1),
    index: (96 + i).toFixed(1),
    finish: i === 2 ? 'Champion' : i % 3 === 0 ? 'Playoffs' : 'Missed',
    score: 40 + i * 1.5,
    counted: i !== 11,
    updated: '2026-11-14T05:00:00.000Z',
  }))
  return {
    score: {
      score: 25.94,
      components: [comp('winRate', 'Win rate', 0.4, 0.52, '51.2%'), comp('titles', 'Titles', 0.2, 0.3, '1 / 1.6'), comp('playoffs', 'Playoffs', 0.2, 0.4, '0.9×'), comp('scoring', 'Scoring', 0.2, 0.55, '103.0')],
      sample: { leagueSeasons: 14, resultSeasons: 12, completedSeasons: 8, games: 160, seasons: 3 },
      totals: { wins: 82, losses: 78, ties: 0, titles: 1, expectedTitles: 1.6, playoffs: 4, expectedPlayoffs: 4.4, winRate: 0.512, adjWinRate: 0.51, scoringIndex: 103, pricedGames: 160, titleRatio: 0.6, playoffRatio: 0.9 },
      field: { avgSize: 12, avgPlayoffShare: 0.5 },
      confidence: 'medium',
      prestige: 12,
      newestUpdate: '2026-11-14T05:00:00.000Z',
      oldestUpdate: '2024-01-10T00:00:00.000Z',
    },
    globalRank: { rank: 18, of: 19 },
    movement: { sevenDay: 1, week: 1, season: -2 },
    seasons: [
      { season: 2024, record: '20-19', seasonScore: 22.1, careerScore: 22.1 },
      { season: 2025, record: '31-29', seasonScore: 27.4, careerScore: 24.9 },
      { season: 2026, record: '31-30', seasonScore: 26.0, careerScore: 25.9 },
    ],
    daily: [{ label: 'Nov 12', rank: 19, score: 25.1 }, { label: 'Nov 13', rank: 18, score: 25.9 }],
    weekly: [{ label: 'Nov 9', rank: 19, score: 25.1 }],
    trackingSince: '2026-09-16',
    rows,
    psort: 'season',
    pdir: 'desc',
    freshness: { newestImport: '2026-11-14T05:00:00.000Z', rankCalculatedAt: '2026-11-14T05:40:00.000Z', ledgerRows: 14 },
  }
}
/** SAMPLE one-league view — twelve invented teams. */
export function leagueView() {
  const teams = ['Sample Leaders', 'Sample Longshots', 'Sample Chasers', 'Sample You', 'Sample Bubble', 'Sample Rivals', 'Sample Comeback', 'Sample Hawks', 'Sample Birds', 'Sample Donkeys', 'Sample Zebras', 'Sample Checks']
  return {
    leagues: [{ id: 'l1', name: 'Sample Keeper League', platform: 'sleeper', season: 2026 }],
    selected: { id: 'l1', name: 'Sample Keeper League', platform: 'sleeper', season: 2026, lastSyncedAt: '2026-11-14T05:00:00.000Z' },
    board: {
      available: true,
      reason: null,
      week: 11,
      seasonComplete: false,
      rows: teams.map((name, i) => ({
        rosterId: String(i + 1),
        rank: i + 1,
        name,
        record: `${10 - Math.floor(i * 0.8)}-${Math.floor(i * 0.8)}`,
        pointsFor: 1420 - i * 31.4,
        average: (1420 - i * 31.4) / 11,
        movement: i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0,
        isYou: name === 'Sample You',
      })),
    },
    power: null,
  }
}

/** SAMPLE Class view — invented managers, ratings and weeks, shaped like ClassView. */
export function classView() {
  const handles = ['SampleManagerOne', 'SampleManagerTwo', 'SampleManagerThree', 'SampleYou', 'SampleManagerFive', 'SampleManagerSix', 'SampleManagerSeven', 'SampleManagerEight']
  const board = handles.map((handle, i) => ({
    userId: `c${i}`,
    rank: i + 1,
    handle,
    level: 4 + i,
    rating: 1720 - i * 28,
    rd: 60 + i * 3,
    conservative: 1600 - i * 30,
    classLevel: 9 - Math.floor(i / 2),
    division: 1 + Math.floor(i / 3),
    record: `${40 - i}-${20 + i}`,
    games: 60,
    percentile: 0.95 - i * 0.08,
    isYou: handle === 'SampleYou',
  }))
  const log = Array.from({ length: 6 }, (_, i) => ({
    leagueId: `l${i % 2}`,
    leagueName: i % 2 ? 'Sample Redraft League' : 'Sample Keeper League',
    season: 2026,
    week: 11 - Math.floor(i / 2),
    pointsFor: 118 + i * 4.3,
    allPlayWins: 7 + (i % 4),
    allPlayGames: 11,
    opponentLabel: `Sample Opponent ${i + 1}`,
    opponentClassNow: 1580 + i * 12,
    result: (i % 3 === 0 ? 'L' : 'W') as 'W' | 'L',
    pointsAgainst: 112 + i * 2.1,
    weekChange: i % 3 === 0 ? -6.2 : 8.4,
    leagueShare: 0.5,
    ratingAfter: 1636 - i * 3,
  }))
  return {
    sport: 'NFL',
    computedAt: '2026-11-14T05:40:00.000Z',
    rated: 412,
    established: 288,
    board,
    you: { status: 'established', rating: 1636.4, rd: 64, conservative: 1508, games: 60, record: '37-23', percentile: 0.71, classLevel: 8, division: 2, band: [1560, 1680], boardRank: 4, rdToEstablish: 0 },
    log,
    divisionFilter: { active: false, band: [1560, 1680], href: '?scope=class&division=mine', offHref: '?scope=class' },
    empty: null,
  }
}

const NAMES = ['SampleManagerOne', 'SampleManagerTwo', 'SampleManagerThree', 'SampleManagerFour', 'SampleManagerFive', 'SampleManagerSix', 'SampleManagerSeven', 'You', 'SampleManagerNine']
const SCORES = [77.6, 76.2, 72.0, 71.4, 65.4, 61.4, 30.3, 25.9, 19.1]

function rows(youAt: number | null): BoardTableRow[] {
  return NAMES.map((n, i) => {
    const isYou = youAt === i
    const handle = isYou ? 'SampleYou' : n === 'You' ? 'SampleManagerEight' : n
    return {
      userId: `u${i}`,
      rank: i + 1,
      handle,
      avatarUrl: null,
      level: 3 + i,
      tierGroup: 2,
      isYou,
      metric: SCORES[i]!.toFixed(1),
      score: SCORES[i]!.toFixed(1),
      winRate: `${(58 - i * 2).toFixed(1)}%`,
      titles: i % 3 === 0 ? `${i} / 1.2` : '—',
      playoffs: i % 4 === 0 ? '1.10×' : '—',
      scoring: (100 + i * 3).toFixed(1),
      sample: `${10 + i} · ${100 + i * 20} g`,
      confidence: 'medium',
      movement: i % 2 === 0 ? 1 : -1,
      updated: '2026-11-14T05:40:00.000Z',
      explainHref: `?explain=u${i}`,
      compareHref: isYou ? null : '#',
    } as BoardTableRow
  })
}

export function data(you: 'mid' | 'top' | 'none', sport: string | null, scope: 'global' | 'portfolio' | 'league' | 'class' = 'global'): RankingsData {
  const youAt = you === 'none' ? null : you === 'top' ? 0 : 7
  const board = rows(youAt)
  const meta = BOARD_META.overall
  const tabs = (Object.keys(BOARD_META) as BoardKey[]).map((key) => ({ key, label: BOARD_META[key].label, href: `?board=${key}` }))
  return {
    scope,
    panel: null,
    signedIn: true,
    filters: { ...DEFAULT_FILTERS, sport },
    filtersLabel: sport ?? 'All leagues',
    options: {
      sports: [{ value: 'NFL', label: 'NFL', count: 1178 }, { value: 'NBA', label: 'NBA', count: 7 }],
      platforms: [{ value: 'sleeper', label: 'Sleeper', count: 1149 }],
      types: [],
      formats: [],
      seasons: [{ value: 2026, label: '2026', count: 400 }],
    },
    baseQuery: '',
    you: { handle: 'SampleYou', level: 14, levelName: 'All-Pro', tier: 'All-Pro', tierGroup: 5, totalLevels: 25, xp: 46956, progressPct: 62, xpToNext: 8044, nextLevelName: 'First-Team All-Pro' },
    xpRows:
      scope === 'portfolio'
        ? [
            { key: 'wins', detail: '82 wins × 10', xp: 820, share: 1, hasBar: true },
            { key: 'playoffs', detail: '4 playoff berths × 30', xp: 120, share: 0.15, hasBar: true },
            { key: 'seasons', detail: '3 seasons × 10', xp: 30, share: 0.04, hasBar: true },
          ]
        : [],
    reconciliation: scope === 'portfolio' ? { computed: 970, stored: 970, storedAt: '2026-11-14T05:40:00.000Z', matches: true } : null,
    ladder: [],
    population: 35,
    computedAt: '2026-11-14T05:40:00.000Z',
    shareUrl: null,
    global: {
      board: 'overall',
      label: meta.label,
      metricLabel: meta.metricLabel,
      unavailable: null,
      tabs,
      rows: board,
      sort: 'rank',
      dir: 'asc',
      belowSample: 16,
      unmeasured: 0,
      movementTracked: true,
      trackingSince: '2026-09-16',
      you: youAt == null ? null : { rank: youAt + 1, of: board.length, display: SCORES[youAt]!.toFixed(1), movement: { sevenDay: null, week: 1, season: -13 } },
      explain: null,
      freshness: { newestImport: '2026-11-14T05:00:00.000Z', stalestManager: '2026-05-23T00:00:00.000Z', ledgerRows: 1196 },
      divisionFilter: null,
      rivals:
        youAt === 7
          ? [{ userId: 'u6', handle: 'SampleManagerSeven', rank: 7, level: 9, display: '30.3', yourDisplay: '25.9', headToHead: { wins: 1, losses: 2, ties: 0, lastSeason: 2025 }, compareHref: '#' }]
          : [],
    },
    portfolio: scope === 'portfolio' ? portfolio() : null,
    league: scope === 'league' ? leagueView() : null,
    classView: scope === 'class' ? classView() : null,
  } as unknown as RankingsData
}

