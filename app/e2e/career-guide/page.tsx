import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Career } from '@/components/core-app/screens/Career'
import { buildCareerData, type CareerRow } from '@/lib/core-app/careerModel'
import type { CareerScreenData } from '@/lib/core-app/careerScreen'

/**
 * DB-free render of /core/career's overview (2026-11-14) inside the real AfCoreShell: the headline that
 * says what the career adds up to, the accomplishments, "This season", the detail and the folded survival
 * scores. Every figure is SAMPLE data, built through the real buildCareerData. Production is refused by
 * app/e2e/layout.tsx.
 *
 *   /e2e/career-guide            six seasons, three titles, guillotine survival results
 *   /e2e/career-guide?none=1     an account with nothing finished yet
 */
let n = 0
function row(over: Partial<CareerRow>): CareerRow {
  n += 1
  const name = over.leagueName ?? 'Sample Dynasty League'
  const season = over.season ?? 2023
  return {
    source: 'legacy',
    key: `sleeper|${season}|${name.toLowerCase()}|${n}`,
    leagueKey: name.toLowerCase(),
    leagueName: name,
    platform: 'sleeper',
    sport: 'NFL',
    season,
    status: 'complete',
    wins: 8,
    losses: 6,
    ties: 0,
    pointsFor: 1500,
    pointsAgainst: 1400,
    madePlayoffs: false,
    playoffKnown: true,
    isChampion: false,
    teamCount: 12,
    playoffTeams: 6,
    leagueType: 'dynasty',
    scoringType: 'ppr',
    settingsLabel: 'DYNASTY · PPR · 12 TEAM',
    refId: `ref-${n}`,
    providerLeagueId: `p-${n}`,
    counted: true,
    inRollup: true,
    ...over,
  } as CareerRow
}

const ROWS: CareerRow[] = [
  row({ season: 2020, wins: 5, losses: 9 }),
  row({ season: 2021, wins: 10, losses: 4, madePlayoffs: true, isChampion: true, leagueName: 'Sample Keeper League' }),
  row({ season: 2022, wins: 12, losses: 2, madePlayoffs: true, isChampion: true }),
  row({ season: 2023, wins: 9, losses: 5, madePlayoffs: true, leagueName: 'Sample Redraft League' }),
  row({ season: 2024, wins: 7, losses: 7, leagueName: 'Sample Redraft League' }),
  row({ season: 2025, wins: 11, losses: 3, madePlayoffs: true, isChampion: true, leagueName: 'Sample Best Ball League' }),
]

function screenData(none: boolean): CareerScreenData {
  const data = buildCareerData({
    identity: { handle: 'SampleManager', avatarUrl: null, xpTotal: 46_956 },
    rows: none ? [] : ROWS,
    platforms: ['sleeper'],
    rosterless: 0,
  })
  if (!none) {
    data.survivalResults = Array.from({ length: 12 }, (_, i) => ({
      key: `s${i}`,
      season: 2025 - Math.floor(i / 3),
      leagueName: `Sample Guillotine League ${i + 1}`,
      format: 'guillotine' as const,
      survival: null,
      score: i === 2 ? 100 : Math.round(((i * 37) % 90) * 10) / 10,
    }))
  }
  return {
    view: 'overview',
    data,
    awards: [],
    trades: [],
    profile: { builtAt: '2026-11-14T06:17:00.000Z', origin: 'built' },
    timeline: null,
    records: null,
    peers: null,
    coverage: null,
  } as unknown as CareerScreenData
}

export default async function CareerGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return (
    <AfCoreShell
      active="career"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="career-guide-harness">
        <Career screen={screenData(sp.none === '1')} nowIso="2026-11-14T06:17:00.000Z" />
      </div>
    </AfCoreShell>
  )
}
