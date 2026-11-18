import { describe, expect, it } from 'vitest'
import { describeMrrEstimate, estimateMrr, formatUsdCents } from '@/lib/monetization/mrrEstimate'
import { entrySourceFromSearch, normalizeEntrySource, withEntrySource } from '@/lib/monetization/upgradeEntrySource'

/*
 * Revenue you can see (2026-11-15): an MRR estimate from the catalog's list prices, and the surface
 * that sent each buyer to checkout, carried from the lock card's link through Stripe to the webhook.
 */

describe('estimateMrr', () => {
  it('prices paid, billed subscriptions at list price, a yearly plan ÷ 12', () => {
    const e = estimateMrr([
      { status: 'active', source: 'stripe', sku: 'af_pro_monthly' }, // 999
      { status: 'active', source: 'apple', sku: 'af_pro_yearly' }, // 7999 / 12 = 666.58
      { status: 'past_due', source: 'stripe', sku: 'af_commissioner_monthly' }, // 1499
      { status: 'grace', source: 'google_play', sku: 'af_supreme_monthly' }, // 1999
    ])
    expect(e.priced).toBe(4)
    expect(e.mrrCents).toBe(Math.round(999 + 7999 / 12 + 1499 + 1999))
    expect(formatUsdCents(e.mrrCents)).toBe('$51.64')
  })

  it('🛑 never counts a trial, a grant, a canceled plan, or an unknown SKU as revenue — and says which', () => {
    const e = estimateMrr([
      { status: 'trialing', source: 'stripe', sku: 'af_pro_monthly' },
      { status: 'active', source: 'admin_grant', sku: 'af_pro_monthly' },
      { status: 'canceled', source: 'stripe', sku: 'af_pro_monthly' },
      { status: 'active', source: 'stripe', sku: 'legacy_mystery_plan' },
      { status: 'active', source: 'stripe', sku: null, planCode: 'af_war_room_monthly' },
    ])
    expect(e).toMatchObject({ trialing: 1, comped: 1, unpriced: 1, priced: 1, mrrCents: 999 })
    expect(describeMrrEstimate(e)).toBe(
      '1 paid subscription at list price (yearly ÷ 12), before coupons and store fees · 1 with an unknown SKU left out · 1 in a free trial (not counted) · 1 not billed through a store (not counted)',
    )
  })
})

describe('the entry source', () => {
  it('tags an upgrade path without clobbering one already there', () => {
    expect(withEntrySource('/upgrade?plan=pro', 'lock_player_depth')).toBe('/upgrade?plan=pro&from=lock_player_depth')
    expect(withEntrySource('/upgrade', 'lock_trade_depth')).toBe('/upgrade?from=lock_trade_depth')
    expect(withEntrySource('/upgrade?plan=pro&from=chimmy-drawer', 'lock_player_depth')).toBe('/upgrade?plan=pro&from=chimmy-drawer')
    expect(withEntrySource('https://evil.test/x', 'lock_player_depth')).toBe('https://evil.test/x')
    // 🛑 an access object with no upgrade path passes through — the lock card must never be the crash.
    expect(withEntrySource(undefined as never, 'lock_player_depth')).toBeUndefined()
  })

  it('keeps only a short token — never free text into Stripe metadata', () => {
    expect(normalizeEntrySource(' Lock_Player_Depth ')).toBe('lock_player_depth')
    expect(normalizeEntrySource('chimmy-drawer')).toBe('chimmy-drawer')
    expect(normalizeEntrySource('a b')).toBeNull()
    expect(normalizeEntrySource('<script>')).toBeNull()
    expect(normalizeEntrySource('x'.repeat(49))).toBeNull()
    expect(normalizeEntrySource(42)).toBeNull()
    expect(entrySourceFromSearch('?plan=pro&from=lock_competitive_edge')).toBe('lock_competitive_edge')
    expect(entrySourceFromSearch('?plan=pro')).toBeNull()
    expect(entrySourceFromSearch(null)).toBeNull()
  })
})

describe('the lock card names itself on the way to checkout', () => {
  it('links to /upgrade with from=lock_<depth>', async () => {
    const React = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { CoreDepthLock } = await import('@/components/core-app/CoreDepthLock')
    const html = renderToStaticMarkup(
      React.createElement(CoreDepthLock, {
        access: { depth: 'player_depth', unlocked: false, hasPlan: false, planName: 'AF Pro', label: 'Player deep dives', upgradePath: '/upgrade?plan=pro', preLaunchFree: false, startsAt: null } as never,
      }),
    )
    expect(html).toContain('href="/upgrade?plan=pro&amp;offer=monthly&amp;from=lock_player_depth"')
  })
})
