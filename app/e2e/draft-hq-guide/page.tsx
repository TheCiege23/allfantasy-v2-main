import AfCoreShell from '@/components/core-app/AfCoreShell'
import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import { DraftArchive } from '@/components/core-app/screens/DraftArchive'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import type { LiveDraftPicks } from '@/lib/core-app/warRoomBoard'
import { messagesFor } from '@/lib/i18n/messages'
import { draftHqGuideMessages } from '@/lib/core-app/messages/draftHqGuide'

/**
 * DB-free render of the cross-league Draft HQ (/core/draft-hq with no league) with the 2026-11-13 guide.
 * Every league, manager and player here is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/draft-hq-guide                    your pick + drafting (one paused) + not started + finished
 *   /e2e/draft-hq-guide?scenario=running   drafts running, none on you
 *   /e2e/draft-hq-guide?scenario=upcoming  nothing running yet
 *   /e2e/draft-hq-guide?lang=es            Spanish
 */
const row = (over: Partial<DraftHqAllRow> & Pick<DraftHqAllRow, 'leagueId' | 'leagueName' | 'phase'>): DraftHqAllRow => ({
  platform: 'sleeper',
  imageUrl: null,
  rawStatus: over.phase === 'live' ? 'in_progress' : over.phase === 'upcoming' ? 'pre_draft' : 'complete',
  draftType: 'snake',
  rounds: 15,
  teamCount: 12,
  yourSlot: 4,
  picksMade: null,
  pickExpiresAt: null,
  onClockName: null,
  yoursOnClock: false,
  currentRound: null,
  nextOverallPick: null,
  queuedCount: 0,
  modeLabel: null,
  startedAt: null,
  ...over,
})

const inAMinute = () => new Date(Date.now() + 75_000).toISOString()

function rows(scenario: string): DraftHqAllRow[] {
  const yours = row({ leagueId: 'L-yours', leagueName: 'Sample Sunday League', phase: 'live', platform: 'allfantasy', yoursOnClock: true, currentRound: 3, nextOverallPick: 28, picksMade: 27, pickExpiresAt: inAMinute(), queuedCount: 6 })
  const running = row({ leagueId: 'L-run', leagueName: 'Sample Dynasty Club', phase: 'live', yourSlot: null, rounds: 11, currentRound: 4, nextOverallPick: 44, picksMade: 43, onClockName: 'Sample Rival' })
  const paused = row({ leagueId: 'L-pause', leagueName: 'Sample Hoops Redraft', phase: 'live', platform: 'allfantasy', rawStatus: 'paused', teamCount: 16, yourSlot: 1, rounds: 9, currentRound: 1, nextOverallPick: 4, picksMade: 3 })
  const upcoming = [
    row({ leagueId: 'L-up1', leagueName: 'Sample Office League', phase: 'upcoming', platform: 'allfantasy', yourSlot: 1 }),
    row({ leagueId: 'L-up2', leagueName: 'Sample Best Ball 12', phase: 'upcoming', yourSlot: null, rounds: 18 }),
    row({ leagueId: 'L-up3', leagueName: 'Sample Keeper League', phase: 'upcoming', yourSlot: 9, rounds: 13, queuedCount: 4 }),
  ]
  const done = [row({ leagueId: 'L-done', leagueName: 'Sample Summer Mock', phase: 'done', yourSlot: 7 })]
  if (scenario === 'upcoming') return [...upcoming, ...done]
  if (scenario === 'running') return [running, paused, ...upcoming, ...done]
  return [yours, running, paused, ...upcoming, ...done]
}

function data(scenario: string): DraftHqAllData {
  const r = rows(scenario)
  return {
    rows: r,
    counts: {
      live: r.filter((x) => x.phase === 'live').length,
      upcoming: r.filter((x) => x.phase === 'upcoming').length,
      done: r.filter((x) => x.phase === 'done').length,
      unknown: 0,
    },
    withoutDraft: 47,
  }
}

const pick = (overall: number, playerName: string, position: string, team: string, managerName: string, isYours = false) => ({
  sport: 'NFL',
  overall,
  round: Math.floor((overall - 1) / 12) + 1,
  pickInRound: ((overall - 1) % 12) + 1,
  rosterId: String(overall),
  managerName,
  isYours,
  playerName,
  position,
  imageUrl: null,
  team,
  sleeperId: null,
})

const PICKS: LiveDraftPicks = {
  byLeague: {
    'L-yours': [pick(24, 'Sample Receiver A', 'WR', 'KC', 'Sample Manager 1'), pick(25, 'Sample Back B', 'RB', 'DET', 'Sample Manager 2'), pick(26, 'Sample End C', 'TE', 'SF', 'Sample Manager 3'), pick(27, 'Sample Back D', 'RB', 'PHI', 'Sample Manager 4')],
    'L-run': [pick(40, 'Sample Receiver E', 'WR', 'HOU', 'Sample Manager 5'), pick(41, 'Sample Back F', 'RB', 'DAL', 'Sample Manager 6', true), pick(42, 'Sample End G', 'TE', 'SF', 'Sample Manager 7'), pick(43, 'Sample Back H', 'RB', 'NYG', 'Sample Manager 8')],
    'L-pause': [pick(1, 'Sample Guard I', 'PG', 'BOS', 'Sample Manager 9', true), pick(2, 'Sample Forward J', 'SF', 'DEN', 'Sample Manager 10'), pick(3, 'Sample Center K', 'C', 'MIN', 'Sample Manager 11')],
  },
  queueByLeague: {
    'L-yours': [
      { playerName: 'Sample Receiver L', position: 'WR' },
      { playerName: 'Sample Quarterback M', position: 'QB' },
      { playerName: 'Sample Back N', position: 'RB' },
    ],
  },
}

const ARCHIVE = [
  { key: 'a1', leagueId: 'L-done', leagueName: 'Sample Summer Mock', source: 'native' as const, sourceId: 'x1', season: 2026, sport: 'NFL', format: 'snake', status: 'complete' },
  { key: 'a2', leagueId: 'L-run', leagueName: 'Sample Dynasty Club', source: 'imported' as const, sourceId: 'x2', season: 2025, sport: 'NFL', format: 'linear', status: 'complete' },
]

export default async function DraftHqGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const scenario = typeof sp.scenario === 'string' ? sp.scenario : 'default'
  const language = sp.lang === 'es' ? 'es' : 'en'
  return (
    <AfCoreShell
      active="draft-hq"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="draft-hq-guide-harness">
        <DraftHqBoard data={data(scenario)} allHref="#" totalLeagues={82} picks={scenario === 'upcoming' ? undefined : PICKS} language={language} />
        <details className="af-dh-past" data-testid="draft-hq-past-drafts">
          <summary>{messagesFor(draftHqGuideMessages, language).pastDrafts}</summary>
          <DraftArchive choices={ARCHIVE} detail={null} page={1} more={false} total={ARCHIVE.length} />
        </details>
      </div>
    </AfCoreShell>
  )
}
