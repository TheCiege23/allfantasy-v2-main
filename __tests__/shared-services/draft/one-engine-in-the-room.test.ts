/**
 * One engine in the draft room (re-score build item 8, 2026-11-19).
 *
 * The decision card, the copilot (`/api/draft/recommend`) and the War Room (`/api/ai/draft/recommend`) could name
 * three different players: the card ranked the server's pool with this draft's context and the live pick rules,
 * the other two ran the same engine on the pool the browser posted. Both now take the card's pick when they can
 * build it — and explain THAT pick.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/openai-client', () => ({ openaiChatJson: vi.fn(async () => ({ ok: false })), parseJsonContentFromChatCompletion: vi.fn(), openaiChatText: vi.fn() }))
vi.mock('@/lib/deepseek-client', () => ({ deepseekChat: vi.fn(async () => ({ content: null, error: 'unavailable' })) }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: vi.fn() }))
vi.mock('@/lib/shared-services/draft/DraftContextAssembler', () => ({ buildDraftDecisionContext: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateRosterFitForDraftPick: vi.fn() }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: vi.fn() }))

import type { RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { engineResultForDecision, sharedDraftPickForUser } from '@/lib/shared-services/draft/pickDecision'

const player = (name: string, position = 'RB') => ({ name, position, team: null, adp: 10 })
const result = (top: string, alts: string[] = []): RecommendationResult => ({
  recommendation: { player: player(top), reason: `${top} is best`, confidence: 80, needScore: 5, adpEdge: 2, adpIsReal: true },
  alternatives: alts.map((n) => ({ player: player(n), reason: `${n} next`, confidence: 70 })),
  reachWarning: 'reach note',
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
})
const outcome = (engineResult: RecommendationResult | null, verdicts: Array<{ rule: string; verdict: string }>) =>
  ({ ok: true, engineResult, decision: { rule_verdicts: verdicts }, context: { plannedFor: null }, forOverall: 10 }) as never

describe('engineResultForDecision', () => {
  it('is the engine’s own result when the decision keeps its top choice — legal, or waiting for the clock', () => {
    const r = result('Top', ['Next'])
    expect(engineResultForDecision(outcome(r, [{ rule: 'draft.legality.pick', verdict: 'legal' }]))).toBe(r)
    expect(engineResultForDecision(outcome(r, [{ rule: 'draft.legality.not_on_clock', verdict: 'temporarily_illegal' }]))).toBe(r)
    // "The draft is over" is not a skip: there is no next pick to give instead.
    expect(engineResultForDecision(outcome(r, [{ rule: 'draft.legality.complete', verdict: 'illegal' }]))).toBe(r)
  })

  it('when the card says "Skip X; consider Y", Y leads — without X’s figures', () => {
    const out = engineResultForDecision(outcome(result('Top', ['Next', 'Third']), [{ rule: 'draft.legality.roster_fit', verdict: 'illegal' }]))!
    expect(out.recommendation?.player.name).toBe('Next')
    expect(out.recommendation).toMatchObject({ reason: 'Next next', confidence: 70, adpIsReal: false, adpEdge: 0 })
    expect(out.alternatives.map((a) => a.player.name)).toEqual(['Third'])
    expect(out.reachWarning).toBeNull()
  })

  it('skipped with nobody behind it: no pick, rather than the refused one', () => {
    const out = engineResultForDecision(outcome(result('Top'), [{ rule: 'draft.legality.player_taken', verdict: 'illegal' }]))!
    expect(out.recommendation).toBeNull()
  })
})

describe('sharedDraftPickForUser', () => {
  const snapshot = { id: 's1', status: 'in_progress', draftType: 'snake', rounds: 15, teamCount: 12, picks: [], currentPick: { overall: 10, round: 1, slot: 10, rosterId: 'me' } }
  const context = {
    sport: 'NFL',
    engineInput: { available: [player('Top'), player('Next')], teamRoster: [], round: 1, pick: 10, totalTeams: 12, sport: 'NFL' },
    dataCompleteness: { availablePoolSize: 2, adpSampleTotal: 40, rosterPickCount: 0, unresolvedPlayerIdCount: 0 },
    plannedFor: null,
  }
  const deps = (over: Record<string, unknown> = {}) => ({
    rosterIdFor: vi.fn(async () => 'me'),
    snapshot: vi.fn(async () => snapshot as never),
    context: vi.fn(async () => context as never),
    recommend: vi.fn(() => result('Top', ['Next'])),
    validateRosterFit: vi.fn(async () => ({ valid: true })),
    ...over,
  })

  beforeEach(() => vi.clearAllMocks())

  it('is the decision’s pick for this user’s roster', async () => {
    const d = deps()
    const out = await sharedDraftPickForUser({ leagueId: 'lg1', userId: 'u1' }, d)
    expect(out?.result.recommendation?.player.name).toBe('Top')
    expect(out?.plannedFor).toBeNull()
    expect(d.rosterIdFor).toHaveBeenCalledWith('lg1', 'u1')
    expect(d.context).toHaveBeenCalledWith({ leagueId: 'lg1', rosterId: 'me' })
  })

  it('is null — the caller keeps its own answer — with no roster, no draft, an auction, or a failure', async () => {
    expect(await sharedDraftPickForUser({ leagueId: 'lg1', userId: 'u1' }, deps({ rosterIdFor: vi.fn(async () => null) }))).toBeNull()
    expect(await sharedDraftPickForUser({ leagueId: 'lg1', userId: 'u1' }, deps({ snapshot: vi.fn(async () => null) }))).toBeNull()
    expect(
      await sharedDraftPickForUser({ leagueId: 'lg1', userId: 'u1' }, deps({ snapshot: vi.fn(async () => ({ ...snapshot, draftType: 'auction' }) as never) })),
    ).toBeNull()
    expect(await sharedDraftPickForUser({ leagueId: 'lg1', userId: 'u1' }, deps({ context: vi.fn(async () => { throw new Error('gone') }) }))).toBeNull()
    expect(await sharedDraftPickForUser({ leagueId: 'lg1', userId: 'u1' }, deps({ rosterIdFor: vi.fn(async () => { throw new Error('db') }) }))).toBeNull()
  })
})

describe('the copilot and the War Room explain the shared pick, not their own', () => {
  const posted = [player('Posted Pick', 'WR'), player('Other', 'TE')]

  it('runDraftAIAssist uses the precomputed result instead of ranking the posted pool', async () => {
    const { runDraftAIAssist } = await import('@/lib/draft-ai-engine')
    const out = await runDraftAIAssist(
      {
        precomputed: result('Shared Pick', ['Shared Next']),
        available: posted,
        teamRoster: [],
        rosterSlots: ['RB', 'WR', 'TE'],
        round: 1,
        pick: 10,
        totalTeams: 12,
        sport: 'NFL',
        isDynasty: false,
        isSF: false,
        mode: 'needs',
      },
      { explanation: false, sport: 'NFL' },
    )
    expect(out.recommendation.recommendation?.player.name).toBe('Shared Pick')
  })

  it('runDraftWarRoomRecommendation does the same', async () => {
    const { runDraftWarRoomRecommendation } = await import('@/lib/ai/aiDraftHelper')
    const out = await runDraftWarRoomRecommendation({
      precomputed: result('Shared Pick', ['Shared Next']),
      draftType: 'snake',
      userRoster: [],
      availablePlayers: posted,
      recentPicks: [],
      round: 1,
      pickInRound: 10,
      totalTeams: 12,
      sport: 'NFL',
      mode: 'needs',
    })
    expect(out.bestPick.name).toBe('Shared Pick')
  })
})
