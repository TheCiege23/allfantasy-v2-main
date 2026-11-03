/**
 * The automatic rookie draft order (standings: worst record first, or lowest max PF first) is an AF
 * Commissioner / AF Supreme setting, off by default. Off — or a commissioner without the plan — the next
 * rookie draft takes the league's own order.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({ isLeagueEntitledToLiveRookieOrder: vi.fn(async () => true) }))
// A dynasty league whose config says max PF: the preview must not be drawn from that alone.
vi.mock('@/lib/prisma', () => ({ prisma: { dynastyLeagueConfig: { findUnique: vi.fn(async () => ({ rookiePickOrderMethod: 'max_pf' })) } } }))

import { automaticRookieOrderFromSettings, automaticRookieOrderMethod } from '@/lib/rookie-order/automaticRookieOrder'
import { effectiveRookieDraftOrder } from '@/lib/league-rules-explainer/snapshot'

const ON_WORST = { rookie_draft_order: { enabled: true, mode: 'worst_to_first' } }
const ON_PF = { rookie_draft_order: { enabled: true, mode: 'reverse_max_pf' } }

describe('automaticRookieOrderFromSettings', () => {
  it('off by default: no setting, or switched off, seats nothing from standings', () => {
    expect(automaticRookieOrderFromSettings({})).toBeNull()
    expect(automaticRookieOrderFromSettings(null)).toBeNull()
    expect(automaticRookieOrderFromSettings({ rookie_draft_order: { enabled: false, mode: 'reverse_max_pf' } })).toBeNull()
  })
  it('on: worst record first, or lowest max PF first', () => {
    expect(automaticRookieOrderFromSettings(ON_WORST)).toBe('reverse_standings')
    expect(automaticRookieOrderFromSettings(ON_PF)).toBe('max_pf')
  })
})

describe('automaticRookieOrderMethod — the plan is checked when the draft is made', () => {
  it('on and entitled: the standings method', async () => {
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: ON_PF }, { isEntitled: async () => true })).toBe('max_pf')
  })
  it('on but the commissioner no longer holds AF Commissioner: the league’s own order', async () => {
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: ON_PF }, { isEntitled: async () => false })).toBeNull()
  })
  it('a failed plan check counts as not entitled', async () => {
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: ON_PF }, { isEntitled: async () => { throw new Error('down') } })).toBeNull()
  })
  it('off, or no commissioner: never asks', async () => {
    const isEntitled = vi.fn(async () => true)
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: {} }, { isEntitled })).toBeNull()
    expect(await automaticRookieOrderMethod({ userId: null, settings: ON_PF }, { isEntitled })).toBeNull()
    expect(isEntitled).not.toHaveBeenCalled()
  })
})

describe('the rules popup', () => {
  it('a dynasty method alone reads as set by the commissioner — never as an order the draft does not use', () => {
    expect(effectiveRookieDraftOrder('max_pf', {})).toBe('commissioner')
    expect(effectiveRookieDraftOrder('reverse_standings', {})).toBe('commissioner')
  })
  it('the automatic order, the live order and the lottery still read as themselves', () => {
    expect(effectiveRookieDraftOrder('max_pf', ON_WORST)).toBe('auto_worst_to_first')
    expect(effectiveRookieDraftOrder('max_pf', { rookie_draft_order: { live: { enabled: true } } })).toBe('live')
    expect(effectiveRookieDraftOrder('weighted_lottery', {})).toBe('weighted_lottery')
  })
})

describe('the standings "draft order if the season ended today" preview', () => {
  it('is drawn only for the lottery or the automatic order — never for a dynasty method alone', async () => {
    const { readDraftOrderRule } = await import('@/lib/core-app/standingsDraftOrder')
    expect(await readDraftOrderRule({ id: 'L', settings: {} })).toBeNull()
    expect(await readDraftOrderRule({ id: 'L', settings: ON_PF })).toEqual({ kind: 'lowest_points' })
    expect(await readDraftOrderRule({ id: 'L', settings: ON_WORST })).toEqual({ kind: 'reverse_standings' })
  })
})
