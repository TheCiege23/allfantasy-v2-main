// @vitest-environment node
/**
 * /trade-finder shows THE grade, and stops inventing one (2026-09-27).
 *
 * 🛑 The page read the route's `opportunities` — insight notes with NO give or get side — as trades,
 * and filled the gaps itself: fairness 80, verdict "FAIR", empty sides. Every card read "FAIR · 80".
 * Pinned: trades come from the graded `candidates`, notes stay notes, nothing is invented, and each
 * shown candidate is graded from the viewer's side with Sleeper ids qualified as Sleeper's.
 */
import { describe, expect, it, vi } from 'vitest'
import { toFinderInsights, toFinderTrades } from '@/lib/trade-finder/pageModel'
import { gradeFinderCandidates, type GradedFinderCandidate } from '@/lib/trade-finder/candidateGrades'

const asset = (over: Record<string, unknown> = {}) => ({
  assetId: '4034', name: 'Christian McCaffrey', value: 6000, position: 'RB', tier: 'T1', isStarter: true, ...over,
})
const candidate = (over: Record<string, unknown> = {}): GradedFinderCandidate => ({
  tradeId: 'consol_1_2_4034',
  teamA: { teamId: '1', gives: [asset({ assetId: '9509', name: 'Bijan Robinson', value: 5000 }), asset({ assetId: 'pk', name: '2027 2nd', value: 900, isPick: true, pickYear: 2027, pickRound: 2, position: 'PICK' })], receives: [asset()] },
  teamB: { teamId: '2', gives: [asset()], receives: [] },
  finderScore: 71, archetype: 'CONSOLIDATION', whyThisExists: ['You have RB depth.', 'They need a starter.'], valueDeltaPct: 4,
  scoreBreakdown: { starterUpgrade: 0, objectiveAlignment: 0, valueFairness: 0, rosterFit: 0, scarcityBonus: 0 },
  ...over,
}) as never

describe('toFinderTrades — trades are the candidates, never the notes', () => {
  it('builds a card from a candidate, with the AI summary matched by tradeId and THE grade carried', () => {
    const graded = { ...candidate(), partnerName: 'Nicolodeon', leagueGrade: { graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 5900, getValue: 6000 } }
    const [t] = toFinderTrades({ candidates: [graded], recommendations: [{ tradeId: 'consol_1_2_4034', summary: 'Consolidate into a true RB1.' }] })
    expect(t).toEqual({
      id: 'consol_1_2_4034',
      give: [{ name: 'Bijan Robinson', position: 'RB', team: '', value: 5000 }, { name: '2027 2nd', position: 'PICK', team: '', value: 900 }],
      get: [{ name: 'Christian McCaffrey', position: 'RB', team: '', value: 6000 }],
      partnerName: 'Nicolodeon',
      partnerObjective: 'consolidation',
      aiSummary: 'Consolidate into a true RB1.',
      grade: graded.leagueGrade,
    })
  })

  it('🛑 invents nothing: no grade stays null, a missing summary falls back to the finder’s own reasons', () => {
    const [t] = toFinderTrades({ candidates: [candidate()] })
    expect(t!.grade).toBeNull()
    expect(t!.aiSummary).toBe('You have RB depth. They need a starter.')
    expect(t!.partnerName).toBe('Another manager')
    expect(JSON.stringify(t)).not.toMatch(/fairness|verdict|FAIR|\b80\b/)
  })

  it('🛑 an opportunity note is NEVER a trade — only candidates with both sides become cards', () => {
    const note = { type: 'NEED_FIT', title: 'WR need', description: 'Look for a WR2.', relevantPlayers: [], confidence: 0.6, actionable: true }
    expect(toFinderTrades({ opportunities: [note] } as never)).toEqual([])
    expect(toFinderTrades({ candidates: [candidate({ teamA: { teamId: '1', gives: [], receives: [asset()] } })] })).toEqual([])
    expect(toFinderInsights({ opportunities: [note, { title: '', description: '' }] })).toEqual([{ title: 'WR need', description: 'Look for a WR2.' }])
  })
})

describe('gradeFinderCandidates — THE grade from the viewer’s side', () => {
  it('prices team A’s sides, Sleeper ids qualified, picks by year and round', async () => {
    const c = candidate()
    const grade = vi.fn().mockResolvedValue({ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 5900, getValue: 6000 })
    await gradeFinderCandidates({ candidates: [c], grade, limit: 8 })
    expect(grade).toHaveBeenCalledWith(
      { assets: [{ kind: 'player', name: 'Bijan Robinson', providerIdentity: { provider: 'sleeper', id: '9509' } }, { kind: 'pick', year: 2027, round: 2, label: '2027 2nd' }], unpriceable: [] },
      { assets: [{ kind: 'player', name: 'Christian McCaffrey', providerIdentity: { provider: 'sleeper', id: '4034' } }], unpriceable: [] },
    )
    expect(c.leagueGrade).toEqual({ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 5900, getValue: 6000 })
  })

  it('bounded; a pick without a year withholds; a withheld grade keeps its reason; a failure carries nothing', async () => {
    const noYear = candidate({ teamA: { teamId: '1', gives: [asset({ isPick: true, name: 'Some pick', pickYear: undefined, pickRound: 2 })], receives: [asset()] } })
    const failing = candidate({ tradeId: 't2' })
    const past = candidate({ tradeId: 't3' })
    const grade = vi.fn()
      .mockResolvedValueOnce({ graded: false, reason: '1 asset has no value on this league’s chart', basis: null })
      .mockRejectedValueOnce(new Error('chart down'))
    await gradeFinderCandidates({ candidates: [noYear, failing, past], grade, limit: 2 })
    expect(grade.mock.calls[0]![0]).toEqual({ assets: [], unpriceable: ['Some pick'] })
    expect(noYear.leagueGrade).toEqual({ graded: false, reason: '1 asset has no value on this league’s chart' })
    expect(failing.leagueGrade).toBeNull()
    expect(past.leagueGrade).toBeUndefined()
    expect(grade).toHaveBeenCalledTimes(2)
  })
})
