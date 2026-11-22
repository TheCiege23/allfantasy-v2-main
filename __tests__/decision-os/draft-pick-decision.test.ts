import { describe, expect, it, vi } from 'vitest'
import type { RecommendationInput, RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { runDraftPickDecision, type DraftWorldInput } from '@/lib/decision-os/draft'

/**
 * `manager.draft.pick`: the draft recommender's top choice, gated by the live pick rules, answered
 * in the four-answer contract. Pure — the engine and the roster-fit check are injected.
 */

function result(overrides: Partial<RecommendationResult> = {}): RecommendationResult {
  return {
    recommendation: {
      player: { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
      reason: 'Best value and strong roster fit.',
      confidence: 87,
      needScore: 80,
      adpEdge: 3,
      adpIsReal: true,
    },
    alternatives: [
      { player: { name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 14 }, reason: 'High ceiling.', confidence: 79 },
      { player: { name: 'Cole Keeper', position: 'QB', team: 'KC', adp: 20 }, reason: 'Elite floor.', confidence: 70 },
    ],
    reachWarning: null,
    valueWarning: null,
    scarcityInsight: null,
    stackInsight: null,
    correlationInsight: null,
    formatInsight: null,
    byeNote: null,
    explanation: '',
    evidence: [],
    caveats: [],
    uncertainty: null,
    ...overrides,
  } as RecommendationResult
}

function engineInput(projectedShare = 1): RecommendationInput {
  const available = Array.from({ length: 40 }, (_, i) => ({
    name: `Player ${i}`,
    position: 'RB',
    adp: i + 1,
    projectedPoints: i < 40 * projectedShare ? 100 - i : null,
  }))
  return { available, teamRoster: [], round: 1, pick: 3, totalTeams: 12, sport: 'NFL' }
}

function snapshot(overrides: Partial<DraftWorldInput['snapshot']> = {}): DraftWorldInput['snapshot'] {
  return {
    id: 'sess-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 15,
    teamCount: 12,
    picks: [],
    currentPick: { overall: 3, round: 1, slot: 3, rosterId: 'me', displayName: 'Me', pickLabel: '1.03' },
    ...overrides,
  } as DraftWorldInput['snapshot']
}

const coverage = { availablePoolSize: 40, adpSampleTotal: 120, rosterPickCount: 0, unresolvedPlayerIdCount: 0 }

async function decide(opts: {
  snapshot?: DraftWorldInput['snapshot']
  picksUntilTurn?: number | null
  result?: RecommendationResult
  fit?: () => Promise<{ valid: boolean; error?: string }>
  coverage?: typeof coverage
  engineInput?: RecommendationInput
}) {
  const validateRosterFit = vi.fn(opts.fit ?? (async () => ({ valid: true })))
  const out = await runDraftPickDecision(
    {
      worldInput: { snapshot: opts.snapshot ?? snapshot(), rosterId: 'me', picksUntilTurn: opts.picksUntilTurn },
      userId: 'u1',
      leagueId: 'lg1',
      sport: 'NFL',
      engineInput: opts.engineInput ?? engineInput(),
      coverage: opts.coverage ?? coverage,
    },
    { recommend: () => opts.result ?? result(), ruleDeps: { validateRosterFit }, newId: () => 'dec_test' },
  )
  return { ...out, validateRosterFit }
}

describe('manager.draft.pick', () => {
  it('on the clock with a legal top choice says to draft that player, with all four answers', async () => {
    const { decision } = await decide({})
    expect(decision.decision_type).toBe('manager.draft.pick')
    expect(decision.four_answers.what_to_do).toBe('Draft Atlas Runner.')
    expect(decision.four_answers.what_happened).toContain('pick 3')
    expect(decision.four_answers.why_it_matters).toBe('Best value and strong roster fit.')
    expect(decision.rule_verdicts).toEqual([expect.objectContaining({ rule: 'draft.legality.pick', verdict: 'legal' })])
    expect(decision.recommended_actions.map((a) => a.playerName)).toEqual(['Atlas Runner', 'Blaze Catcher', 'Cole Keeper'])
    expect(decision.automation_capable).toBe(false)
    expect(decision.confidence).toBe(87)
    expect(decision.data_completeness).toBe(100)
  })

  it('off the clock it is temporarily illegal and the advice is to queue, naming the wait', async () => {
    const { decision } = await decide({
      snapshot: snapshot({ currentPick: { overall: 3, round: 1, slot: 3, rosterId: 'other', displayName: 'X', pickLabel: '1.03' } }),
      picksUntilTurn: 5,
    })
    expect(decision.rule_verdicts[0]).toMatchObject({ rule: 'draft.legality.not_on_clock', verdict: 'temporarily_illegal' })
    expect(decision.rule_verdicts[0].message).toContain('5 picks until your turn')
    expect(decision.four_answers.what_to_do).toBe('Queue Atlas Runner so the pick is ready when you are on the clock.')
  })

  it('a player already on the board is illegal and the advice moves to the next alternative', async () => {
    const { decision } = await decide({
      snapshot: snapshot({ picks: [{ rosterId: 'other', playerName: 'Atlas Runner', position: 'RB' }] as never }),
    })
    expect(decision.rule_verdicts.map((v) => v.rule)).toEqual(['draft.legality.player_taken'])
    expect(decision.four_answers.why_it_matters).toBe('Atlas Runner has already been drafted.')
    expect(decision.four_answers.what_to_do).toBe('Skip Atlas Runner; consider Blaze Catcher (WR, DAL) instead.')
  })

  it('reports a taken player even while waiting for the turn', async () => {
    const { decision } = await decide({
      snapshot: snapshot({
        picks: [{ rosterId: 'other', playerName: 'Atlas Runner', position: 'RB' }] as never,
        currentPick: { overall: 3, round: 1, slot: 3, rosterId: 'other', displayName: 'X', pickLabel: '1.03' },
      }),
    })
    expect(decision.rule_verdicts.map((v) => v.rule)).toEqual(['draft.legality.not_on_clock', 'draft.legality.player_taken'])
    expect(decision.four_answers.what_to_do).toContain('Skip Atlas Runner')
  })

  it('a paused draft says so, and a finished draft is illegal', async () => {
    const paused = await decide({ snapshot: snapshot({ status: 'paused' }) })
    expect(paused.decision.rule_verdicts[0]).toMatchObject({ rule: 'draft.legality.paused', verdict: 'temporarily_illegal' })
    expect(paused.decision.four_answers.what_to_do).toContain('Queue Atlas Runner for then.')

    const done = await decide({ snapshot: snapshot({ status: 'completed', currentPick: null }) })
    expect(done.decision.rule_verdicts[0]).toMatchObject({ rule: 'draft.legality.complete', verdict: 'illegal' })
    expect(done.decision.four_answers.what_to_do).toBe('Review your roster in the draft results.')
  })

  it('a roster-fit refusal is illegal; an unreadable template is not a refusal', async () => {
    const refused = await decide({ fit: async () => ({ valid: false, error: 'Roster would exceed maximum size (15 slots).' }) })
    expect(refused.decision.rule_verdicts).toEqual([
      expect.objectContaining({ rule: 'draft.legality.roster_fit', verdict: 'illegal', message: 'Roster would exceed maximum size (15 slots).' }),
    ])
    expect(refused.validateRosterFit).toHaveBeenCalledWith({ playerName: 'Atlas Runner', position: 'RB' })

    const unreadable = await decide({ fit: async () => { throw new Error('template unavailable') } })
    expect(unreadable.decision.rule_verdicts.map((v) => v.verdict)).toEqual(['legal'])
  })

  it('an empty pool is an honest no-recommendation, not a judgement on the players', async () => {
    const { decision, validateRosterFit } = await decide({
      result: result({ recommendation: null, alternatives: [] }),
      coverage: { ...coverage, availablePoolSize: 0 },
      engineInput: { ...engineInput(), available: [] },
    })
    expect(decision.recommended_actions).toEqual([])
    expect(decision.rule_verdicts).toEqual([])
    expect(validateRosterFit).not.toHaveBeenCalled()
    expect(decision.four_answers.what_happened).toContain('available pool for this draft is empty')
    expect(decision.confidence).toBe(0)
    expect(decision.data_completeness).toBe(40)
  })

  it('caps confidence by data completeness and names what is missing', async () => {
    const { decision } = await decide({
      coverage: { ...coverage, adpSampleTotal: 0 },
      engineInput: engineInput(0.1),
    })
    expect(decision.data_completeness).toBe(65)
    expect(decision.confidence).toBe(65)
    expect(decision.uncertainty_sources).toEqual([
      'This league has no AllFantasy ADP sample yet, so ranks lean on market ADP.',
      'Few available players carry projections, so value leans on ADP gaps.',
    ])
    expect(decision.four_answers.how_confident).toMatch(/^Medium confidence \(data partial — this league has no allfantasy adp sample/)
  })

  it('flags a top choice without market ADP', async () => {
    const base = result()
    const { decision } = await decide({ result: { ...base, recommendation: { ...base.recommendation!, adpIsReal: false } } })
    expect(decision.uncertainty_sources).toContain('The top choice has no market ADP, so reach and value against ADP are unknown.')
    expect(decision.recommended_actions[0].adpIsReal).toBe(false)
    expect(decision.recommended_actions[1].adpIsReal).toBeNull()
  })
})
