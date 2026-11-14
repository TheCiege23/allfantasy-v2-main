import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Rankings } from '@/components/core-app/screens/Rankings'
import { MoreToolsLinks } from '@/components/core-app/MoreToolsLinks'
import { BOARD_META, DEFAULT_FILTERS, type BoardKey } from '@/lib/core-app/rankingsEngine'
import type { BoardTableRow, RankingsData } from '@/lib/core-app/rankings'

/**
 * DB-free render of /core/rankings' Community tab (2026-11-14) inside the real AfCoreShell: the headline
 * that says where you stand, the movement row, the folded filters, the board and the line under it with
 * "How this board is scored". Every figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/rankings-guide               ranked #8 of 9, behind SampleManagerSeven
 *   /e2e/rankings-guide?you=top       ranked #1
 *   /e2e/rankings-guide?you=none      signed in, not on the board
 *   /e2e/rankings-guide?sport=NFL     a filter set: the filter fold opens
 */
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

function data(you: 'mid' | 'top' | 'none', sport: string | null): RankingsData {
  const youAt = you === 'none' ? null : you === 'top' ? 0 : 7
  const board = rows(youAt)
  const meta = BOARD_META.overall
  const tabs = (Object.keys(BOARD_META) as BoardKey[]).map((key) => ({ key, label: BOARD_META[key].label, href: `?board=${key}` }))
  return {
    scope: 'global',
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
    xpRows: [],
    reconciliation: null,
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
    portfolio: null,
    league: null,
    classView: null,
  } as unknown as RankingsData
}

export default async function RankingsGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const you = sp.you === 'top' ? 'top' : sp.you === 'none' ? 'none' : 'mid'
  const sport = typeof sp.sport === 'string' ? sp.sport : null
  return (
    <AfCoreShell
      active="rankings"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="rankings-guide-harness">
        <Rankings data={data(you, sport)} />
        <MoreToolsLinks screen="rankings" language="en" />
      </div>
    </AfCoreShell>
  )
}
