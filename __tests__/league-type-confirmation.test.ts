import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: h.findUnique, update: h.update } },
}))

import {
  leagueTypeState,
  confirmLeagueType,
  pendingTypeConfirmations,
} from '@/lib/career/leagueTypeConfirmation'

const league = (over: Record<string, unknown> = {}) => ({
  id: 'L1', name: 'KBI Smoke Black', leagueType: 'redraft',
  isDynasty: false, guillotineMode: false, settings: null, ...over,
})

beforeEach(() => {
  h.findUnique.mockReset(); h.update.mockReset()
  h.findUnique.mockResolvedValue(league())
  h.update.mockResolvedValue({})
})

describe('rankableType is the only field a ranking may read', () => {
  it('is null until a human confirms, even with a confident suggestion', () => {
    // An unconfirmed specialty league scores as ordinary — understated rather
    // than inflated, which is the right direction to be wrong in.
    return leagueTypeState('L1').then((s) => {
      expect(s?.suggestion.suggested).toBe('tournament')
      expect(s?.rankableType).toBeNull()
    })
  })

  it('is populated once confirmed', async () => {
    h.findUnique.mockResolvedValue(league({
      settings: {
        leagueTypeConfirmation: {
          type: 'tournament', confirmedByUserId: 'u1',
          confirmedAt: '2026-08-19T00:00:00Z', suggestedAtConfirmation: 'tournament', buyIn: 20,
        },
      },
    }))
    const s = await leagueTypeState('L1')
    expect(s?.rankableType).toBe('tournament')
    expect(s?.confirmation?.buyIn).toBe(20)
  })

  it('ignores a malformed confirmation rather than trusting it', async () => {
    h.findUnique.mockResolvedValue(league({ settings: { leagueTypeConfirmation: { type: 'tournament' } } }))
    // No confirmedByUserId — we cannot say a human did this.
    expect((await leagueTypeState('L1'))?.rankableType).toBeNull()
  })
})

describe('confirming', () => {
  it('records who decided and when', async () => {
    h.findUnique.mockResolvedValue(league())
    await confirmLeagueType({ leagueId: 'L1', type: 'tournament', userId: 'u1' })
    const written = h.update.mock.calls[0][0].data.settings.leagueTypeConfirmation
    expect(written.type).toBe('tournament')
    expect(written.confirmedByUserId).toBe('u1')
    expect(written.confirmedAt).toBeTruthy()
  })

  it('keeps what the suggester proposed, so disagreement stays visible', async () => {
    // The human said zombie; we had suggested tournament. Both are recorded.
    await confirmLeagueType({ leagueId: 'L1', type: 'zombie', userId: 'u1' })
    const w = h.update.mock.calls[0][0].data.settings.leagueTypeConfirmation
    expect(w.type).toBe('zombie')
    expect(w.suggestedAtConfirmation).toBe('tournament')
  })

  it('preserves the rest of the settings blob', async () => {
    h.findUnique.mockResolvedValue(league({ settings: { scoring: { ppr: 1 }, keep: true } }))
    await confirmLeagueType({ leagueId: 'L1', type: 'zombie', userId: 'u1' })
    const s = h.update.mock.calls[0][0].data.settings
    expect(s.scoring).toEqual({ ppr: 1 })
    expect(s.keep).toBe(true)
  })

  it('rejects a type that is not a real format', async () => {
    const r = await confirmLeagueType({ leagueId: 'L1', type: 'best_ball_xyz', userId: 'u1' })
    expect(r).toEqual({ ok: false, reason: 'invalid-type' })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('takes the buy-in from the caller, not from the league name', async () => {
    // "$20" in a title is good enough to prefill a prompt, not to award money
    // credit on its own.
    await confirmLeagueType({ leagueId: 'L1', type: 'guillotine', userId: 'u1', buyIn: 30 })
    expect(h.update.mock.calls[0][0].data.settings.leagueTypeConfirmation.buyIn).toBe(30)
    h.update.mockClear()
    await confirmLeagueType({ leagueId: 'L1', type: 'guillotine', userId: 'u1' })
    expect(h.update.mock.calls[0][0].data.settings.leagueTypeConfirmation.buyIn).toBeNull()
  })

  it('reports a missing league instead of writing', async () => {
    h.findUnique.mockResolvedValue(null)
    expect(await confirmLeagueType({ leagueId: 'nope', type: 'zombie', userId: 'u1' }))
      .toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('what to actually ask about', () => {
  it('asks about a suspected specialty league', async () => {
    h.findUnique.mockResolvedValue(league())
    expect((await pendingTypeConfirmations(['L1'])).length).toBe(1)
  })

  it('does not ask about a plain redraft league', async () => {
    h.findUnique.mockResolvedValue(league({ name: 'Parbur' }))
    expect(await pendingTypeConfirmations(['L1'])).toEqual([])
  })

  it('does not ask about a chat league', async () => {
    h.findUnique.mockResolvedValue(league({ name: 'KBI Commish Chat' }))
    expect(await pendingTypeConfirmations(['L1'])).toEqual([])
  })

  it('stops asking once confirmed', async () => {
    h.findUnique.mockResolvedValue(league({
      settings: { leagueTypeConfirmation: { type: 'tournament', confirmedByUserId: 'u1' } },
    }))
    expect(await pendingTypeConfirmations(['L1'])).toEqual([])
  })
})
