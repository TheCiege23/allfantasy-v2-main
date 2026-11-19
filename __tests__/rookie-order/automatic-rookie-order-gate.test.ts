/**
 * The automatic rookie draft order. Worst record first is the free default; a league can switch it off
 * (or name the commissioner's own order), and lowest max PF first is an AF Commissioner / AF Supreme mode.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({ isLeagueEntitledToLiveRookieOrder: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({ prisma: { dynastyLeagueConfig: { findUnique: vi.fn(async () => ({ rookiePickOrderMethod: 'max_pf' })) } } }))

import { automaticRookieOrderFromSettings, automaticRookieOrderMethod, automaticRookieOrderSwitch } from '@/lib/rookie-order/automaticRookieOrder'
import { effectiveRookieDraftOrder } from '@/lib/league-rules-explainer/snapshot'

const ON_WORST = { rookie_draft_order: { enabled: true, mode: 'worst_to_first' } }
const ON_PF = { rookie_draft_order: { enabled: true, mode: 'reverse_max_pf' } }
const OFF = { rookie_draft_order: { enabled: false, mode: 'reverse_max_pf' } }
// A league that only ever saved the live order has no toggle on file.
const LIVE_ONLY = { rookie_draft_order: { live: { enabled: false } } }

describe('automaticRookieOrderFromSettings', () => {
  it('a league that never saved the toggle is seated worst record first, whatever its dynasty method', () => {
    expect(automaticRookieOrderFromSettings({})).toBe('reverse_standings')
    expect(automaticRookieOrderFromSettings(null)).toBe('reverse_standings')
    expect(automaticRookieOrderFromSettings(LIVE_ONLY, 'max_pf')).toBe('reverse_standings')
    expect(automaticRookieOrderSwitch(LIVE_ONLY)).toBe('unset')
  })
  it('switched off, or the dynasty method is the commissioner’s own order: standings seat nothing', () => {
    expect(automaticRookieOrderFromSettings(OFF)).toBeNull()
    expect(automaticRookieOrderFromSettings({}, 'commissioner')).toBeNull()
    // The toggle switched on wins over the dynasty method.
    expect(automaticRookieOrderFromSettings(ON_WORST, 'commissioner')).toBe('reverse_standings')
  })
  it('on: worst record first, or lowest max PF first', () => {
    expect(automaticRookieOrderFromSettings(ON_WORST)).toBe('reverse_standings')
    expect(automaticRookieOrderFromSettings(ON_PF)).toBe('max_pf')
  })
})

describe('automaticRookieOrderMethod — only lowest max PF needs the plan', () => {
  it('worst record first never asks about the plan, even with no commissioner on file', async () => {
    const isEntitled = vi.fn(async () => false)
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: {} }, { isEntitled })).toBe('reverse_standings')
    expect(await automaticRookieOrderMethod({ userId: null, settings: ON_WORST }, { isEntitled })).toBe('reverse_standings')
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: OFF }, { isEntitled })).toBeNull()
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: {} }, { isEntitled, configMethod: 'commissioner' })).toBeNull()
    expect(isEntitled).not.toHaveBeenCalled()
  })
  it('lowest max PF on the plan: max PF', async () => {
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: ON_PF }, { isEntitled: async () => true })).toBe('max_pf')
  })
  it('lowest max PF without the plan, or with a failed plan check: worst record first, never the startup seating', async () => {
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: ON_PF }, { isEntitled: async () => false })).toBe('reverse_standings')
    expect(await automaticRookieOrderMethod({ userId: 'c', settings: ON_PF }, { isEntitled: async () => { throw new Error('down') } })).toBe('reverse_standings')
    expect(await automaticRookieOrderMethod({ userId: null, settings: ON_PF })).toBe('reverse_standings')
  })
})

describe('the rules popup', () => {
  it('a league that said nothing reads as worst record first; switched off reads as set by the commissioner', () => {
    expect(effectiveRookieDraftOrder('max_pf', {})).toBe('auto_worst_to_first')
    expect(effectiveRookieDraftOrder('reverse_standings', {})).toBe('auto_worst_to_first')
    expect(effectiveRookieDraftOrder('max_pf', OFF)).toBe('commissioner')
    expect(effectiveRookieDraftOrder('commissioner', {})).toBe('commissioner')
  })
  it('the automatic order, the live order and the lottery still read as themselves', () => {
    expect(effectiveRookieDraftOrder('max_pf', ON_WORST)).toBe('auto_worst_to_first')
    expect(effectiveRookieDraftOrder('max_pf', ON_PF)).toBe('auto_reverse_max_pf')
    expect(effectiveRookieDraftOrder('max_pf', { rookie_draft_order: { live: { enabled: true } } })).toBe('live')
    expect(effectiveRookieDraftOrder('weighted_lottery', {})).toBe('weighted_lottery')
  })
})

describe('the standings "draft order if the season ended today" preview', () => {
  it('is drawn only for the lottery or an automatic order the league saved (it cannot tell a dynasty league from a redraft one)', async () => {
    const { readDraftOrderRule } = await import('@/lib/core-app/standingsDraftOrder')
    expect(await readDraftOrderRule({ id: 'L', settings: {} })).toBeNull()
    expect(await readDraftOrderRule({ id: 'L', settings: ON_PF })).toEqual({ kind: 'lowest_points' })
    expect(await readDraftOrderRule({ id: 'L', settings: ON_WORST })).toEqual({ kind: 'reverse_standings' })
  })
})
