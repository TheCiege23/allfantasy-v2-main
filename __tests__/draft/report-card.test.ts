import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftPickSnapshot, SlotOrderEntry } from '@/lib/live-draft-engine/types'

const aiAdp = vi.hoisted(() => ({ entries: [] as Array<{ playerName: string; position: string; team: string | null; adp: number }> }))
vi.mock('@/lib/ai-adp-engine', () => ({
  getAiAdpForLeague: vi.fn(async () => ({ entries: aiAdp.entries })),
}))

import { computeDraftResults } from '@/lib/post-draft-manager-ranking/scoringService'
import { buildDraftReportCard } from '@/lib/post-draft-manager-ranking/reportCard'

const slotOrder: SlotOrderEntry[] = [
  { slot: 1, rosterId: 'r1', displayName: 'Alpha' },
  { slot: 2, rosterId: 'r2', displayName: 'Bravo' },
]

function pick(overall: number, rosterId: string, playerName: string, position: string, adpAtPick?: number): DraftPickSnapshot {
  return {
    id: `p${overall}`,
    overall,
    round: Math.ceil(overall / 2),
    slot: rosterId === 'r1' ? 1 : 2,
    rosterId,
    displayName: rosterId === 'r1' ? 'Alpha' : 'Bravo',
    playerName,
    position,
    team: 'TM',
    byeWeek: null,
    playerId: null,
    tradedPickMeta: null,
    source: 'user',
    pickLabel: `x.${overall}`,
    ...(adpAtPick != null ? { adpAtPick } : {}),
    createdAt: new Date(0).toISOString(),
  } as DraftPickSnapshot
}

function input(picks: DraftPickSnapshot[]) {
  return {
    leagueId: 'L1', leagueName: 'Test League', sport: 'NFL', draftType: 'snake', season: '2026',
    status: 'completed', rounds: 2, teamCount: 2, slotOrder, picks, isDynasty: false,
  }
}

beforeEach(() => {
  aiAdp.entries = []
})

describe('draft grading uses ADP at pick time', () => {
  it('prefers pickMetadata.adpAtPick over today’s AI ADP', async () => {
    aiAdp.entries = [{ playerName: 'Star', position: 'RB', team: 'TM', adp: 30 }]
    const res = await computeDraftResults(input([pick(1, 'r1', 'Star', 'RB', 1.5)]))
    expect(res.pickLog[0].adp).toBe(1.5)
    expect(res.managerRankings.find((m) => m.rosterId === 'r1')!.picks[0].adpSource).toBe('at_pick')
  })

  it('falls back to AI ADP, then to neutral, and tags the source', async () => {
    aiAdp.entries = [{ playerName: 'Known', position: 'WR', team: 'TM', adp: 9 }]
    const res = await computeDraftResults(input([pick(1, 'r1', 'Known', 'WR'), pick(2, 'r2', 'Unknown', 'TE')]))
    const [a, b] = res.pickLog
    expect(a.adp).toBe(9)
    expect(b.adp).toBe(2)
    const sources = res.managerRankings.flatMap((m) => m.picks.map((p) => p.adpSource))
    expect(sources.sort()).toEqual(['current', 'none'])
  })
})

describe('buildDraftReportCard', () => {
  it('reports steal, reach, positions and value counts for one roster', async () => {
    const res = await computeDraftResults(
      input([
        pick(1, 'r1', 'Steal Guy', 'QB', 12), // +11 (steal)
        pick(2, 'r2', 'Other', 'RB', 2),
        pick(3, 'r2', 'Other2', 'RB', 3),
        pick(4, 'r1', 'Reach Guy', 'RB', 1), // -3 (reach)
      ]),
    )
    const card = buildDraftReportCard(res, 'r1')!
    expect(card.displayName).toBe('Alpha')
    expect(card.teamCount).toBe(2)
    expect(card.pickCount).toBe(2)
    expect(card.bestSteal).toMatchObject({ playerName: 'Steal Guy', delta: 11 })
    expect(card.biggestReach).toMatchObject({ playerName: 'Reach Guy', delta: -3, round: 2 })
    expect(card.valuePicks).toBe(1)
    expect(card.reachPicks).toBe(1)
    expect(card.totalValue).toBe(8)
    expect(card.adpBasis).toBe('at_pick')
    expect(card.positions.map((p) => p.position).sort()).toEqual(['QB', 'RB'])
  })

  it('picks the largest positive value as the steal and excludes unmatched picks', async () => {
    const res = await computeDraftResults(
      input([
        pick(1, 'r1', 'On Adp', 'WR', 1.4),
        pick(2, 'r2', 'x', 'RB', 2),
        pick(3, 'r2', 'y', 'RB', 3),
        pick(4, 'r1', 'Big Steal', 'RB', 10), // +6 (steal)
      ].concat([pick(5, 'r1', 'No Adp', 'K')])),
    )
    const card = buildDraftReportCard(res, 'r1')!
    expect(card.bestSteal).toMatchObject({ playerName: 'Big Steal', delta: 6, adp: 10, overall: 4 })
    expect(card.biggestReach).toBeNull()
    expect(card.valuePicks).toBe(1)
    expect(card.evenPicks).toBe(1)
    expect(card.reachPicks).toBe(0)
    expect(card.totalValue).toBe(6.4)
    expect(card.positions.find((p) => p.position === 'K')).toEqual({ position: 'K', count: 1, value: 0 })
  })

  it('labels the ADP basis when picks predate adpAtPick', async () => {
    aiAdp.entries = [{ playerName: 'Old', position: 'WR', team: 'TM', adp: 5 }]
    const res = await computeDraftResults(input([pick(1, 'r1', 'Old', 'WR'), pick(3, 'r1', 'New', 'RB', 4)]))
    expect(buildDraftReportCard(res, 'r1')!.adpBasis).toBe('mixed')
    const none = await computeDraftResults(input([pick(1, 'r1', 'Nobody', 'WR')]))
    expect(buildDraftReportCard(none, 'r1')!.adpBasis).toBe('none')
  })

  it('returns null for a roster not in the draft', async () => {
    const res = await computeDraftResults(input([pick(1, 'r1', 'A', 'WR', 1)]))
    expect(buildDraftReportCard(res, 'nope')).toBeNull()
  })
})
