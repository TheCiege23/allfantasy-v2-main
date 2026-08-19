import { describe, it, expect, vi } from 'vitest'
import { resolveChimmyCommissionerGrounding } from '@/lib/intelligence/chimmy/resolveChimmyGrounding'

const okDeps = () => ({
  resolveUserId: vi.fn(async () => 'u1'),
  assertCommissioner: vi.fn(async () => true),
  buildGrounding: vi.fn(async () => ({ available: true, text: 'COMMISSIONER GROUNDING TEXT' })),
})

describe('resolveChimmyCommissionerGrounding (live pass-through gating)', () => {
  it('attaches grounding for a commissioner-intent question by a commissioner', async () => {
    const r = await resolveChimmyCommissionerGrounding({ userId: 'u1', leagueId: 'L', question: 'Give me a commissioner summary' }, okDeps())
    expect(r).toBe('COMMISSIONER GROUNDING TEXT')
  })

  it('does NOT attach for an ordinary fantasy question (gates out before any DB work)', async () => {
    const d = okDeps()
    const r = await resolveChimmyCommissionerGrounding({ userId: 'u1', leagueId: 'L', question: 'Should I start Josh or Patrick?' }, d)
    expect(r).toBeNull()
    expect(d.assertCommissioner).not.toHaveBeenCalled()
    expect(d.buildGrounding).not.toHaveBeenCalled()
  })

  it('attaches when an explicit commissionerFlag is set even without intent', async () => {
    const r = await resolveChimmyCommissionerGrounding({ userId: 'u1', leagueId: 'L', question: 'hi', commissionerFlag: true }, okDeps())
    expect(r).toBe('COMMISSIONER GROUNDING TEXT')
  })

  it('returns null when there is no leagueId', async () => {
    expect(await resolveChimmyCommissionerGrounding({ userId: 'u1', question: 'commissioner summary' }, okDeps())).toBeNull()
  })

  it('returns null when the requester is not a commissioner', async () => {
    const r = await resolveChimmyCommissionerGrounding(
      { userId: 'u1', leagueId: 'L', question: 'commissioner summary' },
      { ...okDeps(), assertCommissioner: vi.fn(async () => false) },
    )
    expect(r).toBeNull()
  })

  it('returns null when no user can be resolved', async () => {
    const r = await resolveChimmyCommissionerGrounding(
      { leagueId: 'L', question: 'commissioner summary' },
      { ...okDeps(), resolveUserId: vi.fn(async () => null) },
    )
    expect(r).toBeNull()
  })

  it('returns null when grounding is restricted/unavailable', async () => {
    const r = await resolveChimmyCommissionerGrounding(
      { userId: 'u1', leagueId: 'L', question: 'commissioner summary' },
      { ...okDeps(), buildGrounding: vi.fn(async () => ({ available: false, text: 'restricted' })) },
    )
    expect(r).toBeNull()
  })

  it('never throws — a grounding error degrades to null (chat continues)', async () => {
    const r = await resolveChimmyCommissionerGrounding(
      { userId: 'u1', leagueId: 'L', question: 'commissioner summary' },
      { ...okDeps(), buildGrounding: vi.fn(async () => { throw new Error('db down') }) },
    )
    expect(r).toBeNull()
  })
})
