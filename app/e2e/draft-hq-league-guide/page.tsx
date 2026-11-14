import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DraftHq } from '@/components/core-app/screens/DraftHq'
import { DraftBoard } from '@/components/core-app/screens/DraftBoard'
import { DraftArchive } from '@/components/core-app/screens/DraftArchive'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import type { DraftBoardData } from '@/lib/core-app/draftBoard'
import type { ArchiveDetail } from '@/lib/draft-archive/detail'
import { messagesFor } from '@/lib/i18n/messages'
import { draftHqGuideMessages } from '@/lib/core-app/messages/draftHqGuide'

/**
 * DB-free render of ONE league's Draft HQ with the 2026-11-13 guide. Every league, manager and player
 * here is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/draft-hq-league-guide?phase=before    not started (default)
 *   /e2e/draft-hq-league-guide?phase=live      running, not your pick
 *   /e2e/draft-hq-league-guide?phase=yours     running, your pick
 *   /e2e/draft-hq-league-guide?phase=paused    paused
 *   /e2e/draft-hq-league-guide?phase=done      finished
 *   /e2e/draft-hq-league-guide?phase=imported  a draft on Sleeper (the archive is the page)
 *   The screen's language follows the af_lang cookie, like /core; `&lang=es` only sets the fold below.
 */
const TEAMS = 10
const ROUNDS = 12
const SLOT = 4
const NAMES = ['Sample Back', 'Sample Receiver', 'Sample End', 'Sample Quarterback', 'Sample Kicker']
const POS = ['RB', 'WR', 'TE', 'QB', 'K']

const status = (phase: string) =>
  phase === 'live' || phase === 'yours' ? 'in_progress' : phase === 'paused' ? 'paused' : phase === 'done' ? 'completed' : 'pre_draft'

/** Snake order: which slot owns overall pick `o`. */
const slotOf = (o: number) => {
  const round = Math.ceil(o / TEAMS)
  const i = (o - 1) % TEAMS
  return round % 2 === 1 ? i + 1 : TEAMS - i
}
const labelOf = (o: number) => `${Math.ceil(o / TEAMS)}.${String(((o - 1) % TEAMS) + 1).padStart(2, '0')}`
const mine = Array.from({ length: TEAMS * ROUNDS }, (_, i) => i + 1).filter((o) => slotOf(o) === SLOT)

function madeCount(phase: string): number {
  if (phase === 'done') return TEAMS * ROUNDS
  if (phase === 'live') return 24
  // Pick 24 is slot 4's third-round pick in a 10-team snake, so 23 made puts you on the clock.
  if (phase === 'yours' || phase === 'paused') return 23
  return 0
}

function boardData(phase: string): DraftBoardData {
  const made = madeCount(phase)
  const current = phase === 'done' || made === 0 ? (made === 0 ? 1 : null) : made + 1
  const cells = Array.from({ length: TEAMS * ROUNDS }, (_, i) => {
    const overall = i + 1
    const slot = slotOf(overall)
    const picked = overall <= made
    return {
      originalSlot: slot,
      ownerName: `Sample Manager ${slot}`,
      round: Math.ceil(overall / TEAMS),
      pickInRound: ((overall - 1) % TEAMS) + 1,
      overall,
      label: labelOf(overall),
      rosterId: `r${slot}`,
      playerName: picked ? `${NAMES[overall % NAMES.length]} ${overall}` : null,
      position: picked ? POS[overall % POS.length]! : null,
      isYours: slot === SLOT,
      isOnTheClock: phase !== 'done' && phase !== 'before' && overall === current,
    }
  })
  return {
    league: { id: 'L-sample', name: 'Sample Sunday League', platform: 'allfantasy' },
    session: {
      available: true,
      data: {
        status: status(phase),
        draftType: 'snake',
        rounds: ROUNDS,
        teamCount: TEAMS,
        picksMade: made,
        totalPicks: TEAMS * ROUNDS,
        currentRound: current != null ? Math.ceil(current / TEAMS) : null,
        currentPickOverall: phase === 'before' || phase === 'done' ? null : current,
      },
    },
    clock: {
      available: true,
      data: {
        endsAt: phase === 'live' || phase === 'yours' ? new Date(Date.now() + 80_000) : null,
        pausedSecondsRemaining: phase === 'paused' ? 64 : null,
        yoursOnClock: phase === 'yours' || phase === 'paused',
      },
    },
    board: {
      available: true,
      data: {
        columns: Array.from({ length: TEAMS }, (_, i) => ({ slot: i + 1, rosterId: `r${i + 1}`, displayName: i + 1 === SLOT ? 'Sample You' : `Sample Manager ${i + 1}`, isYours: i + 1 === SLOT })),
        cells,
        rounds: ROUNDS,
        draftType: 'snake',
        thirdRoundReversal: false,
      },
    },
    bestAvailable: { available: false, reason: 'sample' },
    queue: { available: false, reason: 'sample' },
    advice: { available: false, reason: 'sample' },
  } as DraftBoardData
}

const missing = (reason: string) => ({ available: false as const, reason })

function hqData(phase: string): DraftHqData {
  const done = phase === 'done'
  const made = madeCount(phase)
  const myMade = mine.filter((o) => o <= made)
  return {
    league: { id: 'L-sample', name: 'Sample Sunday League', platform: 'allfantasy', format: 'redraft' },
    session: { available: true, data: { status: status(phase), draftType: 'snake', rounds: ROUNDS, teamCount: TEAMS, yourSlot: SLOT } },
    pickSlots: {
      available: true,
      data: {
        held: mine.map((o) => ({ round: Math.ceil(o / TEAMS), pickInRound: ((o - 1) % TEAMS) + 1, overall: o, label: labelOf(o), acquiredFrom: null })),
        tradedAway: [],
        note: null,
      },
    },
    madePicks:
      myMade.length > 0
        ? {
            available: true,
            data: myMade.map((o) => ({ overall: o, round: Math.ceil(o / TEAMS), label: labelOf(o), playerName: `${NAMES[o % NAMES.length]} ${o}`, position: POS[o % POS.length]!, team: 'DET', imageUrl: null })),
          }
        : missing('this draft has not run yet'),
    board: missing('choose a completed draft in the archive to review its selections'),
    grades: done
      ? {
          available: true,
          data: {
            season: '2026',
            partial: true,
            gradedPicks: TEAMS * ROUNDS,
            totalPicks: TEAMS * ROUNDS,
            scale: 'A is a draft well above the round median; C is about the median; F well below.',
            scoringNote: null,
            teams: Array.from({ length: 4 }, (_, i) => ({
              ownerId: `o${i}`,
              name: i === 0 ? 'Sample You' : `Sample Manager ${i + 1}`,
              teamName: null,
              picks: ROUNDS,
              initialGrade: (['A', 'B', 'C', 'B'] as const)[i]!,
              currentGrade: (['A', 'B', 'C', 'B'] as const)[i]!,
              trend: 'steady' as const,
            })),
          },
        }
      : missing('analysis requires data bound to this individual draft'),
    lottery: missing('a weighted draft lottery only applies to dynasty leagues, and this one is not'),
    queue: done
      ? missing('you have not queued any players for this draft yet')
      : {
          available: true,
          data: {
            players: [
              { rank: 1, playerName: 'Sample Receiver Q', position: 'WR', team: 'KC' },
              { rank: 2, playerName: 'Sample Back R', position: 'RB', team: 'ATL' },
              { rank: 3, playerName: 'Sample End S', position: 'TE', team: 'SF' },
            ],
            total: 8,
          },
        },
    keepers: missing('this draft has no keepers set up'),
  } as DraftHqData
}

const ARCHIVE_DETAIL = {
  choice: { key: 'imported:1', leagueId: 'L-imp', season: 2026, sport: 'NFL', format: 'snake', status: 'drafting', sourceId: '1000000000000000001' },
  canReconcile: false,
  canRefreshResults: false,
  resultsObservedAt: null,
  startedAt: '2026-08-30T01:00:03.000Z',
  endedAt: null,
  endMeaning: 'Provider last selection time',
  elapsedMs: null,
  activeMs: null,
  coverage: [],
  picks: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, overall: i + 1, round: 1, playerName: `${NAMES[i % NAMES.length]} ${i + 1}`, rosterId: `r${i + 1}`, teamName: `Sample Club ${i + 1}` })),
  references: null,
  analysisReport: null,
  resultsReport: null,
  analysis: null,
  snapshot: null,
  events: [],
  corrections: [],
  trades: [],
  playerTrades: [],
  phase4: {
    components: [],
    scores: [],
    calibration: null,
    dynasty: [],
    replay: { state: 'unavailable', players: [], picks: [] },
    lineage: { state: 'partial', lineages: [], pending: [] },
    contributions: [],
  },
} as unknown as ArchiveDetail

export default async function DraftHqLeagueGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const phase = typeof sp.phase === 'string' ? sp.phase : 'before'
  const language = sp.lang === 'es' ? 'es' : 'en'
  const board = boardData(phase)
  return (
    <AfCoreShell
      active="draft-hq"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="draft-hq-league-guide-harness">
        {phase === 'imported' ? (
          <DraftArchive choices={[]} detail={ARCHIVE_DETAIL} leagueId="L-imp" page={1} more={false} total={3} asDraftHq platformName="Sleeper" />
        ) : (
          <>
            <DraftHq
              data={hqData(phase)}
              live={{
                picksMade: board.session.available ? board.session.data.picksMade : 0,
                totalPicks: TEAMS * ROUNDS,
                currentPickOverall: board.session.available ? board.session.data.currentPickOverall : null,
                yoursOnClock: board.clock.available ? board.clock.data.yoursOnClock : false,
              }}
              board={<DraftBoard data={board} />}
            />
            <details className="af-dh-past" data-testid="draft-hq-past-drafts">
              <summary>{messagesFor(draftHqGuideMessages, language).pastDrafts}</summary>
              <p style={{ padding: 16 }}>Sample archive.</p>
            </details>
          </>
        )}
      </div>
    </AfCoreShell>
  )
}
