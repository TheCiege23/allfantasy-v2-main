// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two things that wait on people now reach the Survivor commissioner's to-do list: a hand-scored challenge
 * locked and waiting for its result (the commissioner's job), and a reward waiting for its winner's choice
 * (a heads-up). Before, neither appeared anywhere on the list.
 */

const m = vi.hoisted(() => ({ rows: [] as Array<{ configJson: unknown }>, where: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { survivorChallenge: { findMany: vi.fn(async (args: { where: unknown }) => { m.where = args.where; return m.rows }) } },
}))

import { buildSurvivorCommissionerTodo, type SurvivorCommissionerTodoFacts } from '@/lib/survivor/survivorCommissionerTodo'
import { validateChallengeDraft, type ChallengeDraftContext } from '@/lib/survivor/survivorChallengeBuilderModel'
import { countManualChallengesAwaitingResult } from '@/lib/survivor/buildSurvivorCommissionerDashboard'

const quietWeek: SurvivorCommissionerTodoFacts = {
  leagueId: 'lg', week: 6, phase: 'pre_merge', draftStatus: 'completed', leagueSize: 16, claimedManagers: 16,
  setupIssues: [], lastError: null, paused: false, autoReveal: true,
  council: { week: 6, status: 'voting_open', isRevealed: false, tiePhase: null },
  scoresPending: true, sentAlertKeys: [], tribeRedrawPending: false,
}
const todo = (facts: Partial<SurvivorCommissionerTodoFacts>) => buildSurvivorCommissionerTodo({ ...quietWeek, ...facts })

describe('to-do items for things waiting on people', () => {
  it("a hand-scored challenge waiting for its result is the commissioner's job", () => {
    const t = todo({ manualChallengesAwaitingResult: 1 })
    expect(t.items).toEqual([expect.objectContaining({ id: 'settle_challenges', tone: 'action', title: 'Settle a hand-scored challenge', href: '/survivor/lg/commissioner?tab=minigames' })])
    expect(t.actionCount).toBe(1)
    expect(t.headline).toBe('One thing needs you.')
    expect(todo({ manualChallengesAwaitingResult: 3 }).items[0].title).toBe('Settle 3 hand-scored challenges')
  })

  it('a reward waiting on its winner is a heads-up, not a chore, and is gone once the season is over', () => {
    const t = todo({ rewardsAwaitingChoice: 2 })
    expect(t.items).toEqual([expect.objectContaining({ id: 'rewards_awaiting_choice', tone: 'heads_up', title: '2 rewards are waiting on their winners', href: '/survivor/lg/commissioner?tab=rewards' })])
    expect(t.actionCount).toBe(0)
    expect(todo({ rewardsAwaitingChoice: 2, phase: 'complete' }).items).toEqual([])
  })

  it('none waiting (or an older caller that sends neither count): nothing new on the list', () => {
    expect(todo({ manualChallengesAwaitingResult: 0, rewardsAwaitingChoice: 0 }).items).toEqual([])
    expect(todo({}).items).toEqual([])
  })
})

describe('countManualChallengesAwaitingResult', () => {
  const ctx: ChallengeDraftContext = { now: new Date('2026-11-01T15:00:00Z'), currentWeek: 9, merged: false, lang: 'en', faabWeeklyCap: 40, otherFaabThisWeek: 0 }
  const game = { sport: 'NFL', homeAbbr: 'KC', awayAbbr: 'BUF', homeLabel: 'Chiefs', awayLabel: 'Bills', kickoff: '2026-11-02T01:20:00Z' }
  const draft = (over: Record<string, unknown>) => {
    const r = validateChallengeDraft({
      title: 'T', question: 'Q?', scope: 'tribe', week: 9, opensAt: '2026-11-01T10:00', locksAt: '2026-11-01T20:00', game,
      prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 20 }] }], ...over,
    }, ctx)
    if (!r.ok) throw new Error(r.error.message)
    return r.draft.config
  }

  beforeEach(() => {
    m.rows = []
    m.where = null
  })

  it('counts only locked builder challenges whose result the commissioner enters', async () => {
    m.rows = [
      { configJson: draft({ kind: 'custom_choice', options: ['A', 'B'] }) }, // manual
      { configJson: draft({ kind: 'game_total_closest' }) },                 // settles from stored data
      { configJson: { not: 'a config' } },                                   // unreadable: not counted
    ]
    expect(await countManualChallengesAwaitingResult('lg')).toBe(1)
    expect(m.where).toEqual({ leagueId: 'lg', challengeType: 'commissioner_challenge', status: 'locked' })
  })
})
