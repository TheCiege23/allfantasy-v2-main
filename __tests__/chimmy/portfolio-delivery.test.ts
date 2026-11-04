import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/ai-memory/chat-history-store', () => ({ appendChatHistory: vi.fn().mockResolvedValue(null) }))
import { portfolioEnvelope, persistPortfolioAnswer } from '@/lib/chimmy/portfolio/delivery'
import { judgeChimmyDelivery } from '@/lib/chimmy/chargeOnDelivery'
import { questionOutcome } from '@/lib/chimmy-context/telemetry/chatQuestion'
import { appendChatHistory } from '@/lib/ai-memory/chat-history-store'
import { readPortfolioEvidence, type PortfolioEvidence } from '@/lib/chimmy/portfolio/types'

const evidence: PortfolioEvidence = { version: 1, status: 'blocked', intent: 'compare', horizon: 'season', scopeLabel: 'Own teams',
  compared: 0, total: 0, remaining: 0, generatedAt: '2026-11-04T12:00:00Z', teams: [],
  state: { version: 1, horizon: 'season', orderedLeagueIds: [], focusLeagueId: null }, methodology: [], caveats: ['Roster read unavailable.'], followUps: [] }

describe('comparison billing and persisted evidence', () => {
  it('never describes a blocked comparison as delivered or charged', () => {
    const response = portfolioEnvelope(evidence, 'deep_analysis', { tokenSpend: { tokenCost: 10 } })
    expect(response.meta.tokenSpend).toBeNull()
    expect(response.meta.free).toBe(true)
    expect(response.meta.delivery.delivered).toBe(false)
    expect(judgeChimmyDelivery({ answer: 'A model wrote a refusal', modelOutputs: [{ raw: 'refusal' }], contextBlocked: true })).toEqual({ delivered: false, reason: 'insufficient_context' })
  })
  it('keeps successfully delivered comparisons on the existing billing path', () => {
    const response = portfolioEnvelope({ ...evidence, status: 'ready' }, 'fast_take', { tokenSpend: { tokenCost: 10 } })
    expect(response.meta.tokenSpend).toEqual({ tokenCost: 10 })
    expect(response.meta.delivery.delivered).toBe(true)
  })
  it('records blocked and partial answers distinctly instead of counting every 200 as answered', () => {
    expect(questionOutcome(200, { meta: { portfolio: { status: 'blocked' } } })).toBe('needs_context')
    expect(questionOutcome(200, { meta: { portfolio: { status: 'partial' } } })).toBe('partial_answer')
    expect(questionOutcome(200, { meta: { portfolio: { status: 'ready' } } })).toBe('answered')
  })
  it('persists comparison scope and coverage with the answer for reloads', async () => {
    await persistPortfolioAnswer({ userId: 'u1', conversationId: 'private-thread', question: 'Compare my teams', evidence, mode: 'deep_analysis', cost: 0 })
    expect(appendChatHistory).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', role: 'assistant',
      meta: { display: expect.objectContaining({ portfolio: evidence, portfolioState: evidence.state, cost: 0 }) } }))
  })
  it('uses identical numeric evidence in Summary, Deep, and Fun modes', () => {
    const ready = { ...evidence, status: 'ready' as const }
    const responses = ['fast_take', 'deep_analysis', 'social_story'].map(mode => portfolioEnvelope(ready, mode))
    expect(responses.map(r => r.meta.portfolio)).toEqual([ready, ready, ready])
  })
  it('rejects untrusted action links from hydrated/network evidence', () => {
    const team = { leagueId: 'a', leagueName: 'A', teamName: 'Own', sport: 'NFL', season: 2026, status: 'ready', stale: false,
      lastSyncedAt: null, rank: 1, outOf: 12, percentile: 100, metrics: [], weakestPosition: null, gaps: [], actions: [{ label: 'Open', href: '//evil.example' }] }
    expect(readPortfolioEvidence({ ...evidence, teams: [team] })).toBeNull()
    expect(readPortfolioEvidence({ ...evidence, teams: [{ ...team, actions: [{ label: 'Open', href: '/core/my-team?league=a' }] }] })).not.toBeNull()
  })
})
