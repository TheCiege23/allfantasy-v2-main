/**
 * The command center admits Survivor format signals ONLY for the manager's own leagues (the
 * `scope.has(s.leagueId)` step in resolveManagerCommandCenterSnapshot). The route contract test mocks
 * the resolver, so this step had no coverage. Real resolver here; only the per-league user OS read is
 * mocked (as unavailable, so the queue holds nothing but the format signals under test).
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import { deriveSurvivorFinaleSignals } from '@/lib/decision-os/survivorFinaleSignals'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

vi.mock('@/lib/decision-os/userOs', () => ({
  resolveUserOsSnapshot: vi.fn(async (leagueId: string) => ({ leagueId, managerId: 'user-1', generatedAt: '2026-12-20T12:00:00.000Z', available: false, reason: 'user_os_unavailable' })),
}))

const NOW = new Date('2026-12-20T12:00:00Z')
const votesDue = (leagueId: string): DecisionOsAttentionSignal[] => deriveSurvivorFinaleSignals({
  leagueId, now: NOW,
  questionsToAsk: 0, questionsDeadline: null, questionWindowOpen: false,
  questionsToAnswer: 0, answersDeadline: null, answerWindowOpen: false,
  speechMissing: false, speechesDeadline: null, speechWindowOpen: false,
  ballotOwed: true, ballotsDueAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
})

describe('manager command center: Survivor signals stay in the manager’s own leagues', () => {
  it('admits a signal for a league in scope and drops one for a league the manager is not in', async () => {
    const mine = votesDue('MINE')
    const foreign = votesDue('SOMEONE_ELSES')
    expect(mine).toHaveLength(1)
    const snap = await resolveManagerCommandCenterSnapshot('user-1', ['MINE', 'ALSO_MINE'], NOW, null, Promise.resolve([...foreign, ...mine]))
    expect(snap.attentionQueue.map((s) => s.leagueId)).toEqual(['MINE'])
    expect(snap.attentionQueue.map((s) => s.id)).toEqual([mine[0]!.id])
  })

  it('drops everything when no signal belongs to the manager, and survives a rejected source', async () => {
    const none = await resolveManagerCommandCenterSnapshot('user-1', ['MINE'], NOW, null, [...votesDue('A'), ...votesDue('B')])
    expect(none.attentionQueue).toEqual([])
    const rejected = await resolveManagerCommandCenterSnapshot('user-1', ['MINE'], NOW, null, Promise.reject(new Error('boom')))
    expect(rejected.attentionQueue).toEqual([])
  })
})
