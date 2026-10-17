import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 🛑 STORYLINES SPENT TOKENS ON ONE CLICK, AND ON BAD REQUESTS (fixed 2026-09-29). Both routes ran the
 * entitlement gate FIRST with `confirmTokenSpend: true` hardcoded: no question was asked, and a missing
 * `eventId` or an invalid `storyType` was charged and then refused. Now: validate first, spend only on
 * the client's confirmation, and refund a story that fails after the charge.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  refund: vi.fn(),
  event: vi.fn(),
  narrative: vi.fn(),
  createStory: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1', email: 'u1@example.test' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ assertLeagueMember: async () => ({ leagueSport: 'NFL' }) }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: h.gate }))
vi.mock('@/lib/tokens/storylineSpendRefund', () => ({ refundStorylineSpend: h.refund }))
vi.mock('@/lib/drama-engine/DramaQueryService', () => ({ getDramaEventById: h.event }))
vi.mock('@/lib/drama-engine/AIDramaNarrativeAdapter', () => ({ buildDramaNarrative: h.narrative }))
vi.mock('@/lib/relationship-insights', () => ({ buildAIRelationshipContext: async () => null }))
vi.mock('@/lib/league-story-creator', () => ({
  createLeagueStory: h.createStory,
  getStoryVariant: () => null,
  storyToMediaShape: () => null,
}))

import { POST as tellStory } from '@/app/api/leagues/[leagueId]/drama/tell-story/route'
import { POST as createStory } from '@/app/api/leagues/[leagueId]/story/create/route'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const post = (body: unknown) =>
  new Request('http://test/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const EVENT = {
  id: 'e1', leagueId: 'L1', sport: 'NFL', season: 2026, summary: 'A rivalry.', headline: 'Rivals', dramaType: 'rivalry',
  relatedManagerIds: ['m1'],
}
const SPENT = { ok: true, decision: {}, tokenSpend: { id: 'ledger-1', balanceAfter: 90 }, tokenPreview: { ruleCode: 'ai_storyline_creation', tokenCost: 30 } }

beforeEach(() => {
  h.gate.mockReset().mockResolvedValue(SPENT)
  h.refund.mockReset().mockResolvedValue(undefined)
  h.event.mockReset().mockResolvedValue(EVENT)
  h.narrative.mockReset().mockResolvedValue({ narrative: 'Once upon a time', source: 'ai' })
  h.createStory.mockReset().mockResolvedValue({ ok: true, story: null, sections: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST drama/tell-story', () => {
  it('a missing eventId is refused BEFORE the gate — nothing is charged', async () => {
    const res = await tellStory(post({}), ctx)
    expect(res.status).toBe(400)
    expect(h.gate).not.toHaveBeenCalled()
  })

  it('an event from another league is refused BEFORE the gate', async () => {
    h.event.mockResolvedValue({ ...EVENT, leagueId: 'OTHER' })
    const res = await tellStory(post({ eventId: 'e1' }), ctx)
    expect(res.status).toBe(404)
    expect(h.gate).not.toHaveBeenCalled()
  })

  it('without the client’s confirmation the gate is told NOT to spend', async () => {
    await tellStory(post({ eventId: 'e1' }), ctx)
    expect(h.gate).toHaveBeenCalledWith(expect.objectContaining({ confirmTokenSpend: false, featureId: 'storyline_creation' }))
  })

  it('the confirmation is passed through only when it is literally true', async () => {
    await tellStory(post({ eventId: 'e1', confirmTokenSpend: 'yes' }), ctx)
    expect(h.gate).toHaveBeenLastCalledWith(expect.objectContaining({ confirmTokenSpend: false }))
    await tellStory(post({ eventId: 'e1', confirmTokenSpend: true }), ctx)
    expect(h.gate).toHaveBeenLastCalledWith(expect.objectContaining({ confirmTokenSpend: true }))
  })

  it('the gate’s own answer (e.g. the 409 question) is returned untouched', async () => {
    const ask = new Response(JSON.stringify({ code: 'token_confirmation_required' }), { status: 409 })
    h.gate.mockResolvedValue({ ok: false, response: ask })
    const res = await tellStory(post({ eventId: 'e1' }), ctx)
    expect(res).toBe(ask)
    expect(h.narrative).not.toHaveBeenCalled()
  })

  it('a story that fails after the charge is refunded', async () => {
    h.narrative.mockRejectedValue(new Error('model down'))
    const res = await tellStory(post({ eventId: 'e1', confirmTokenSpend: true }), ctx)
    expect(res.status).toBe(500)
    expect(h.refund).toHaveBeenCalledWith({ userId: 'u1', ledgerId: 'ledger-1', surface: 'league_drama_tell_story' })
  })

  it('[control] a delivered story is not refunded', async () => {
    const res = await tellStory(post({ eventId: 'e1', confirmTokenSpend: true }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).narrative).toBe('Once upon a time')
    expect(h.refund).not.toHaveBeenCalled()
  })
})

describe('POST story/create', () => {
  it('an invalid storyType is refused BEFORE the gate — nothing is charged', async () => {
    const res = await createStory(post({ storyType: 'nope' }), ctx)
    expect(res.status).toBe(400)
    expect(h.gate).not.toHaveBeenCalled()
  })

  it('without the client’s confirmation the gate is told NOT to spend', async () => {
    await createStory(post({ storyType: 'rivalry' }), ctx)
    expect(h.gate).toHaveBeenCalledWith(expect.objectContaining({ confirmTokenSpend: false }))
  })

  it('a story the creator could not write is refunded', async () => {
    h.createStory.mockResolvedValue({ ok: false, error: 'no data' })
    const res = await createStory(post({ storyType: 'rivalry', confirmTokenSpend: true }), ctx)
    expect(res.status).toBe(500)
    expect(h.refund).toHaveBeenCalledWith({ userId: 'u1', ledgerId: 'ledger-1', surface: 'league_story_create' })
  })

  it('a creator that throws is refunded too', async () => {
    h.createStory.mockRejectedValue(new Error('boom'))
    const res = await createStory(post({ storyType: 'rivalry', confirmTokenSpend: true }), ctx)
    expect(res.status).toBe(500)
    expect(h.refund).toHaveBeenCalledTimes(1)
  })

  it('[control] a written story is not refunded', async () => {
    const res = await createStory(post({ storyType: 'rivalry', confirmTokenSpend: true }), ctx)
    expect(res.status).toBe(200)
    expect(h.refund).not.toHaveBeenCalled()
  })
})
