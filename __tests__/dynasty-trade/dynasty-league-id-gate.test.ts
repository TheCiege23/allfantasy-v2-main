// @vitest-environment node
/**
 * The dynasty trade analyzer's `leagueId` is GATED (2026-09-27).
 *
 * 🛑 It used to reach the trade context assembler exactly as the client sent it. The assembler reads
 * manager tendencies, competitor snapshots, trade history and league values `where: { platformLeagueId }`
 * and writes them into the AI prompt — so a signed-in caller who named another league's id got that
 * league's derived manager data narrated back. Now only a league the caller owns or has a team in
 * reaches it, as its platform id; anything else is analyzed league-blind.
 *
 * Prisma is mocked (never the real DB — vitest.setup.db-guard.ts pins the URL shut regardless), and so
 * is every stage after the assembler: the spy records the league it was handed, then the route's own
 * catch turns the stop into a 500 that nothing here cares about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  assemble: vi.fn(),
  envelope: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'viewer-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection/costGate', () => ({ aiCostGate: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.findMany, findUnique: h.findUnique } } }))
vi.mock('@/lib/trade-engine/trade-context-assembler', () => ({
  assembleTradeDecisionContext: h.assemble,
  contextToPromptV1: vi.fn(() => ''),
}))
vi.mock('@/lib/ai-context-envelope', () => ({
  tradeContextToEnvelope: h.envelope,
  getMandatorySystemPromptSuffix: vi.fn(() => ''),
  normalizeToContract: vi.fn(() => ({})),
}))
vi.mock('@/lib/trade-engine/dual-brain-trade-analyzer', () => ({ runPeerReviewAnalysis: vi.fn() }))
vi.mock('@/lib/trade-engine/quality-gate', () => ({ runQualityGate: vi.fn() }))
vi.mock('@/lib/trade-engine/trade-response-formatter', () => ({ formatTradeResponse: vi.fn(), computeDeterministicVerdict: vi.fn() }))
vi.mock('@/lib/trade-engine/trade-analyzer-intel', () => ({ buildTradeAnalyzerIntelPrompt: vi.fn(async () => '') }))
vi.mock('@/lib/ai-reliability', () => ({ buildStableFallbackResponse: vi.fn(), buildReliabilityMetadata: vi.fn() }))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: vi.fn() }))
// The grade runs beside the analysis and has its own gate (`gradeLeagueId`); keep it out of this test.
vi.mock('@/lib/decision-os/trade/evaluateTrade', () => ({ evaluateTrade: vi.fn(async () => ({ receiptId: null, assets: [], grade: { graded: false, reason: 'n/a', basis: null } })) }))

import { POST } from '@/app/api/dynasty-trade-analyzer/route'

const STOP = new Error('stop after the assembler')

async function post(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/dynasty-trade-analyzer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sideA: 'Josh Allen (QB)', sideB: 'Bijan Robinson (RB)', leagueContext: '12 team', sport: 'NFL', ...body }),
  })
  await POST(req)
  expect(h.assemble).toHaveBeenCalledTimes(1)
  return h.assemble.mock.calls[0]![2] as { leagueId?: string }
}

describe('POST /api/dynasty-trade-analyzer — leagueId', () => {
  beforeEach(() => {
    h.findMany.mockReset().mockResolvedValue([])
    h.findUnique.mockReset().mockResolvedValue(null)
    h.assemble.mockReset().mockRejectedValue(STOP)
    h.envelope.mockReset().mockReturnValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('🛑 a league the caller is not in never reaches the assembler — the analysis runs league-blind', async () => {
    const league = await post({ leagueId: 'someone-elses-sleeper-league' })
    expect(league.leagueId).toBeUndefined()
    // The membership query was asked, as this viewer, and nothing further was read.
    expect(JSON.stringify(h.findMany.mock.calls[0]![0])).toContain('viewer-1')
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('a league the caller is in reaches it as that league’s PLATFORM id (the key the assembler reads)', async () => {
    h.findMany.mockResolvedValue([{ id: 'af-league-1', userId: 'viewer-1' }])
    h.findUnique.mockResolvedValue({ platformLeagueId: '1180000000000000001' })
    const league = await post({ leagueId: 'af-league-1' })
    expect(h.findUnique).toHaveBeenCalledWith({ where: { id: 'af-league-1' }, select: { platformLeagueId: true } })
    expect(league.leagueId).toBe('1180000000000000001')
  })

  it('no leagueId: no league, and no league query at all', async () => {
    const league = await post({})
    expect(league.leagueId).toBeUndefined()
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('a failed membership read is league-blind, not a 500 and not the raw id', async () => {
    h.findMany.mockRejectedValue(new Error('db down'))
    const league = await post({ leagueId: 'any-league' })
    expect(league.leagueId).toBeUndefined()
  })
})
