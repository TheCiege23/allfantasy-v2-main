/**
 * @vitest-environment node
 *
 * The league settings "AI trade" panel prints /api/ai/trade-analysis's response as-is, so the response
 * IS the screen. It used to carry a Win / Loss / Fair verdict and a fairness score from `runTradeAnalysis`;
 * since 2026-09-29 the only grade in it is the one trade engine's letter, and the model writes prose
 * about that letter — never its own verdict.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  evaluateTrade: vi.fn(),
  callClaudeJson: vi.fn(),
  assertLeagueAccess: vi.fn(),
  runTradeAnalysis: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection/costGate', () => ({ aiCostGate: vi.fn(async () => null) }))
vi.mock('@/lib/ai/league-settings-ai/access', () => ({ assertLeagueAccess: h.assertLeagueAccess }))
vi.mock('@/lib/ai/league-settings-ai/claude', () => ({ callClaudeJson: h.callClaudeJson }))
vi.mock('@/lib/league/buildLeagueContext', () => ({ buildLeagueContext: vi.fn(async () => '') }))
vi.mock('@/lib/decision-os/trade/evaluateTrade', () => ({ evaluateTrade: h.evaluateTrade }))
// Only so a regression that brings the old engine back is caught by the assertions, not by a DB call.
vi.mock('@/lib/engine/trade', () => ({ runTradeAnalysis: h.runTradeAnalysis }))

import { POST } from '@/app/api/ai/trade-analysis/route'

const GRADED = {
  graded: true,
  letter: 'D',
  partnerLetter: 'B',
  label: 'Slightly favors opponent',
  percentDiff: -9,
  giveValue: 6100,
  getValue: 5550,
  recommendation: 'Ask for a little more.',
}

async function post(body: Record<string, unknown>) {
  const res = await POST(new Request('http://localhost/api/ai/trade-analysis', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  h.assertLeagueAccess.mockReset().mockResolvedValue({ id: 'L1', name: 'Home', sport: 'NFL', platform: 'sleeper' })
  h.evaluateTrade.mockReset().mockResolvedValue({ receiptId: 'rc1', assets: [], grade: GRADED })
  h.callClaudeJson.mockReset().mockResolvedValue({ shortTerm: 's', longTerm: 'l', advice: 'a', verdict: 'Win', fairnessScore: 91 })
  h.runTradeAnalysis.mockReset()
})

describe('/api/ai/trade-analysis', () => {
  it('grades through the one engine, in the checked league, from the "you give" side with no need pricing', async () => {
    await post({ leagueId: 'L1', give: [{ name: 'Josh Allen' }], get: [{ name: 'Travis Kelce' }, { name: '2026 1st' }] })
    expect(h.evaluateTrade).toHaveBeenCalledTimes(1)
    expect(h.evaluateTrade.mock.calls[0]![0]).toEqual({
      surface: 'league-settings-ai-trade',
      leagueId: 'L1',
      userId: 'u1',
      give: { assets: [{ kind: 'player', name: 'Josh Allen' }], unpriceable: [] },
      get: { assets: [{ kind: 'player', name: 'Travis Kelce' }, { kind: 'pick', year: 2026, round: 1, label: '2026 1st' }], unpriceable: [] },
      viewerSide: false,
    })
    expect(h.runTradeAnalysis).not.toHaveBeenCalled()
  })

  it('🛑 the response carries the one letter and no verdict or fairness of its own — not even one the model adds', async () => {
    const { status, json } = await post({ leagueId: 'L1', give: [{ name: 'Josh Allen' }], get: [{ name: 'Travis Kelce' }] })
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true, shortTerm: 's', longTerm: 'l', advice: 'a', narrativeSource: 'ai' })
    expect(json.tradeGrade).toMatchObject({ grade: 'D', partnerGrade: 'B', gradeLabel: 'Slightly favors opponent', evaluationReceiptId: 'rc1' })
    for (const key of ['verdict', 'verdictSource', 'fairnessScore', 'fairnessConfidence']) expect(json).not.toHaveProperty(key)
    // The model is told the letter it must explain.
    expect(String(h.callClaudeJson.mock.calls[0]![0].system)).toContain("The trading manager's letter: D (the other side: B)")
  })

  it('a withheld grade says why and asks the model for nothing', async () => {
    h.evaluateTrade.mockResolvedValueOnce({ receiptId: null, assets: [], grade: { graded: false, reason: 'No values.', basis: null } })
    const { status, json } = await post({ leagueId: 'L1', give: [{ name: 'Nobody' }], get: [{ name: 'Travis Kelce' }] })
    expect(status).toBe(200)
    expect(json.tradeGrade).toMatchObject({ grade: null, gradeWithheld: 'No values.' })
    expect(json).toMatchObject({ shortTerm: null, longTerm: null, advice: null, narrativeSource: 'not_graded' })
    expect(h.callClaudeJson).not.toHaveBeenCalled()
  })

  it('a league the caller cannot read is not graded in', async () => {
    h.assertLeagueAccess.mockResolvedValueOnce(null)
    await post({ leagueId: 'someone-elses', give: [{ name: 'Josh Allen' }], get: [{ name: 'Travis Kelce' }] })
    expect(h.evaluateTrade.mock.calls[0]![0]).toMatchObject({ leagueId: null })
  })

  it('prose failing still returns the grade', async () => {
    h.callClaudeJson.mockRejectedValueOnce(new Error('down'))
    const { json } = await post({ leagueId: 'L1', give: [{ name: 'Josh Allen' }], get: [{ name: 'Travis Kelce' }] })
    expect(json).toMatchObject({ ok: true, narrativeSource: 'unavailable', tradeGrade: { grade: 'D' } })
  })
})
