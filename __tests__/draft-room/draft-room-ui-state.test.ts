/**
 * DraftRoom UI QA — pure helpers, merge semantics, AF Pro queue planner, mock-path guard.
 *
 * Production data flow (authoritative routes):
 * - Initial: GET `/api/leagues/[leagueId]/draft/session`
 * - Live: GET `/api/leagues/[leagueId]/draft/live-sync` (+ full session on visibility)
 * - SSE: `/api/draft/intel/stream?leagueId=` (intel UI); `/api/draft/[draftId]/stream` for worker-backed draft_state
 * - Pick: POST `/api/leagues/[leagueId]/draft/pick`
 * - Queue: GET/PUT `/draft/queue`, POST `/draft/queue/ai-reorder`
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { computeDraftCountdownSeconds } from '@/lib/draft/computeDraftCountdownSeconds'
import { getDraftCountdownDisplay } from '@/lib/draft/getDraftCountdownDisplay'
import { filterByPosition, applyDraftFilters } from '@/lib/draft-room/DraftPlayerSearchResolver'
import {
  filterByAgeAtMost,
  filterByByeWeek,
  filterByIdpStatAtLeast,
  filterByProjectedPointsAtLeast,
  type DraftPoolNumericRow,
} from '@/lib/draft-room/draftPoolNumericFilters'
import { resolvePlayerPoolAdpColumns } from '@/lib/draft-room/playerPoolAdpColumns'
import { planDraftQueueAiReorder } from '@/lib/live-draft-engine/draftQueueAiReorder'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { isSnakeMakePickButtonEnabled } from '@/lib/draft-room/draftRoomUiPickEligibility'
import { mergeDraftSessionSnapshot } from '@/lib/draft-room/mergeDraftSessionSnapshot'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

const root = resolve(__dirname, '..', '..')

describe('computeDraftCountdownSeconds / getDraftCountdownDisplay', () => {
  const t0 = Date.parse('2026-06-01T12:00:00.000Z')

  it('running + timerEndAt: counts down from anchor', () => {
    const end = '2026-06-01T12:01:30.000Z'
    const sec = computeDraftCountdownSeconds('running', end, 90, t0 + 30_000, null)
    expect(sec).toBe(60)
  })

  it('expired: returns 0', () => {
    expect(computeDraftCountdownSeconds('expired', null, null, t0, null)).toBe(0)
  })

  it('paused: uses server remaining seconds', () => {
    expect(computeDraftCountdownSeconds('paused', null, 42, t0, null)).toBe(42)
  })

  it('running soft deadline without ISO: uses softDeadlineMs', () => {
    const soft = t0 + 45_000
    expect(computeDraftCountdownSeconds('running', null, 45, t0 + 10_000, soft)).toBe(35)
  })

  it('getDraftCountdownDisplay: completed phase', () => {
    const d = getDraftCountdownDisplay({
      draftStatus: 'completed',
      timerStatus: 'none',
      nowMs: t0,
    })
    expect(d.phase).toBe('complete')
    expect(d.remainingSeconds).toBeNull()
    expect(d.missingTimerAnchor).toBe(false)
  })

  it('getDraftCountdownDisplay: missing anchor warning when in_progress + open board + timer none', () => {
    const d = getDraftCountdownDisplay({
      draftStatus: 'in_progress',
      timerStatus: 'none',
      timerEndAtIso: null,
      serverRemainingSeconds: null,
      nowMs: t0,
      boardHasOpenPicks: true,
    })
    expect(d.missingTimerAnchor).toBe(true)
  })
})

describe('resolvePlayerPoolAdpColumns', () => {
  it('keeps system ADP and AI ADP separate', () => {
    const r = resolvePlayerPoolAdpColumns({ adp: 12.4, aiAdp: 18.2, aiAdpSampleSize: 140 })
    expect(r.systemAdp).toBe(12.4)
    expect(r.aiAdp).toBe(18.2)
    expect(r.aiAdpSampleSize).toBe(140)
    expect(r.labels.ai).toBe('AI ADP')
    expect(r.labels.system).toBe('ADP')
  })
})

describe('DraftPlayerSearchResolver + draftPoolNumericFilters', () => {
  const rows: DraftPoolNumericRow[] = [
    { name: 'Josh Allen', position: 'QB', projectedPoints: 300, age: 29, byeWeek: 7, tackles: null, sacks: null },
    { name: 'Fred Warner', position: 'LB', projectedPoints: 180, age: 28, byeWeek: 9, tackles: 120, sacks: 4 },
  ]

  it('filters by name / position / team via resolver', () => {
    const draftPlayers = rows.map((r) => ({ name: r.name, position: r.position, team: 'BUF' }))
    let list = applyDraftFilters(draftPlayers, {
      searchQuery: 'josh',
      positionFilter: 'All',
      draftedNames: new Set(),
    })
    expect(list.map((p) => p.name)).toContain('Josh Allen')
    list = filterByPosition(rows, 'LB')
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Fred Warner')
  })

  it('numeric filters: projected points, age, bye, IDP stat', () => {
    expect(filterByProjectedPointsAtLeast(rows, 200)).toHaveLength(1)
    expect(filterByAgeAtMost(rows, 28)).toHaveLength(1)
    expect(filterByByeWeek(rows, 9)).toHaveLength(1)
    expect(filterByIdpStatAtLeast(rows, 'tackles', 100)).toHaveLength(1)
  })
})

describe('planDraftQueueAiReorder', () => {
  const q: QueueEntry[] = [
    { playerName: 'A', position: 'RB', lockedByUser: true },
    { playerName: 'B', position: 'WR' },
  ]

  it('persist mode keeps locked row and writes AI metadata on unlocked rows', () => {
    const plan = planDraftQueueAiReorder({
      queue: q,
      rosterPositions: ['RB', 'WR', 'TE'],
      sport: 'NFL',
      hasProDraftAiAccess: true,
      aiManageDraftQueueEnabled: true,
    })
    expect(plan.mode).toBe('persist')
    expect(plan.persistOrder?.length).toBeGreaterThan(0)
    const locked = plan.displayOrder.find((e) => e.playerName === 'A')
    expect(locked?.lockedByUser).toBe(true)
  })

  it('non–AF Pro: suggestion only, manual order displayed', () => {
    const plan = planDraftQueueAiReorder({
      queue: q,
      rosterPositions: ['RB', 'WR'],
      sport: 'NFL',
      hasProDraftAiAccess: false,
      aiManageDraftQueueEnabled: true,
    })
    expect(plan.mode).toBe('suggestion_af_pro_required')
    expect(plan.displayOrder).toEqual(q)
  })
})

describe('isSnakeMakePickButtonEnabled', () => {
  it('enabled only when on clock and not submitting', () => {
    expect(isSnakeMakePickButtonEnabled({ canDraft: true, isCurrentUserOnClock: true, pickSubmitting: false })).toBe(
      true,
    )
    expect(isSnakeMakePickButtonEnabled({ canDraft: true, isCurrentUserOnClock: false, pickSubmitting: false })).toBe(
      false,
    )
    expect(isSnakeMakePickButtonEnabled({ canDraft: true, isCurrentUserOnClock: true, pickSubmitting: true })).toBe(
      false,
    )
  })
})

describe('mergeDraftSessionSnapshot — live-sync pick append', () => {
  const slotOrder = [{ slot: 1, rosterId: 'r1', displayName: 'T1' }]
  const base: DraftSessionSnapshot = {
    id: 's1',
    leagueId: 'l1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 1,
    teamCount: 1,
    thirdRoundReversal: false,
    timerSeconds: 60,
    timerEndAt: '2026-01-01T12:01:00.000Z',
    pausedRemainingSeconds: null,
    slotOrder,
    tradedPicks: [],
    version: 3,
    picks: [],
    currentPick: { overall: 1, round: 1, slot: 1, rosterId: 'r1', displayName: 'T1', pickLabel: '1.01' },
    timer: { status: 'running', remainingSeconds: 60, timerEndAt: '2026-01-01T12:01:00.000Z' },
    updatedAt: '2026-01-01T11:00:00.000Z',
  }

  it('incoming snapshot with new pick replaces session picks', () => {
    const incoming: DraftSessionSnapshot = {
      ...base,
      version: 4,
      picks: [
        {
          id: 'pk1',
          overall: 1,
          round: 1,
          slot: 1,
          rosterId: 'r1',
          displayName: 'T1',
          playerName: 'Player One',
          position: 'RB',
          team: 'SEA',
          byeWeek: null,
          playerId: 'p1',
          tradedPickMeta: null,
          source: 'user',
          pickLabel: '1.01',
          createdAt: '2026-01-01T11:00:05.000Z',
        },
      ],
      currentPick: null,
      status: 'completed',
    }
    const merged = mergeDraftSessionSnapshot(base, incoming)
    expect(merged?.picks).toHaveLength(1)
    expect(merged?.status).toBe('completed')
  })
})

describe('production DraftRoomPageClient — mock / legacy imports guard', () => {
  it('does not import mock-draft DraftRoom or mock draft API routes', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
    expect(src).not.toMatch(/from\s+['"][^'"]*af-legacy\/components\/mock-draft\/DraftRoom['"]/)
    expect(src).not.toMatch(/from\s+['"][^'"]*mock-draft\/DraftRoom['"]/)
    expect(src).not.toMatch(/from\s+['"][^'"]*\/api\/draft\/mock[^'"]*['"]/)
    expect(src).not.toMatch(/from\s+['"][^'"]*lib\/mock-draft\/draft-engine['"]/)
  })
})
