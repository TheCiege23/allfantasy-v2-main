/**
 * Pro / Commissioner → Supreme is one subscription, prorated (owner's decision, 2026-11-16). Before, the
 * "Switch from AF Pro" link opened a second checkout and the member paid for both plans.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ rows: [] as any[], updates: [] as any[] }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription: {
      findMany: vi.fn(async () => db.rows),
      update: vi.fn(async (a: any) => { db.updates.push(a); return {} }),
    },
  },
}))
vi.mock('@/lib/subscription/webhookHandlers', () => ({ upsertSubscriptionPlanForCatalogItem: vi.fn(async () => ({ id: 'plan-supreme' })) }))

import { pickSwitchSources, SUPREME_BUNDLED_FAMILIES, switchToSupreme } from '@/lib/monetization/supremeSwitch'
import { SUPREME_INCLUDED_PLAN_IDS } from '@/lib/subscription/feature-access'

const ENV = { STRIPE_PRICE_AF_SUPREME_MONTHLY: 'price_supreme_m' } as NodeJS.ProcessEnv
const future = new Date(Date.now() + 20 * 86_400_000)
const row = (id: string, sku: string, sub: string, over: Record<string, unknown> = {}) => ({ id, sku, stripeSubscriptionId: sub, status: 'active', currentPeriodEnd: future, gracePeriodEnd: null, expiresAt: null, ...over })

function fakeStripe(over: { status?: string; updateError?: unknown } = {}) {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({ id, status: over.status ?? 'active', metadata: { userId: 'u1', sku: 'af_pro_monthly' }, items: { data: [{ id: `si_${id}` }] } })),
      update: vi.fn(async (id: string) => {
        if (over.updateError) throw over.updateError
        return { id, status: 'active' }
      }),
      cancel: vi.fn(async (id: string) => ({ id, status: 'canceled' })),
    },
  }
}

beforeEach(() => {
  db.rows = []
  db.updates = []
})

describe('switchToSupreme', () => {
  it('🛑 switches the Pro subscription IN PLACE to Supreme, prorated and paid now — no second subscription', async () => {
    db.rows = [row('r-pro', 'af_pro_monthly', 'sub_pro')]
    const stripe = fakeStripe()
    const r = await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: ENV, entrySource: 'supreme_spotlight' })
    expect(r).toEqual({ kind: 'switched', stripeSubscriptionId: 'sub_pro', fromSku: 'af_pro_monthly', cancelledSubscriptionIds: [] })
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_pro', expect.objectContaining({
      items: [{ id: 'si_sub_pro', price: 'price_supreme_m' }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
      cancel_at_period_end: false,
      metadata: expect.objectContaining({ userId: 'u1', sku: 'af_supreme_monthly', switchedFromSku: 'af_pro_monthly', entrySource: 'supreme_spotlight' }),
    }))
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
    // Access is immediate: the row already says Supreme.
    expect(db.updates[0]).toMatchObject({ where: { id: 'r-pro' }, data: { sku: 'af_supreme_monthly', status: 'active', subscriptionPlanId: 'plan-supreme' } })
  })

  it('holding Pro AND Commissioner: switches Commissioner, cancels Pro with a prorated credit', async () => {
    db.rows = [row('r-pro', 'af_pro_monthly', 'sub_pro'), row('r-com', 'af_commissioner_monthly', 'sub_com')]
    const stripe = fakeStripe()
    const r = await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: ENV })
    expect(r).toMatchObject({ kind: 'switched', stripeSubscriptionId: 'sub_com', cancelledSubscriptionIds: ['sub_pro'] })
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_pro', { prorate: true, invoice_now: true })
    expect(db.updates.find((u) => u.where.id === 'r-pro')?.data).toMatchObject({ status: 'canceled' })
  })

  it('a Pro trial switching to Supreme ends the trial: the trial was for Pro', async () => {
    db.rows = [row('r-pro', 'af_pro_monthly', 'sub_pro', { status: 'trialing' })]
    const stripe = fakeStripe({ status: 'trialing' })
    await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: ENV })
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_pro', expect.objectContaining({ trial_end: 'now' }))
  })

  it('🛑 a declined card changes nothing: no cancel, no row update, a plain message', async () => {
    db.rows = [row('r-pro', 'af_pro_monthly', 'sub_pro'), row('r-com', 'af_commissioner_monthly', 'sub_com')]
    const stripe = fakeStripe({ updateError: Object.assign(new Error('declined'), { type: 'StripeCardError', code: 'card_declined' }) })
    const r = await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: ENV })
    expect(r).toEqual({ kind: 'failed', status: 402, code: 'payment_failed', error: 'Your card was declined, so the switch to AF Supreme did not go through. Nothing changed.' })
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(db.updates).toEqual([])
  })

  it('no Stripe Pro/Commissioner/Legacy to switch (none, or expired): a normal checkout', async () => {
    const stripe = fakeStripe()
    expect(await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: ENV })).toEqual({ kind: 'not_applicable' })
    // A Legacy row is SWITCHED since 2026-11-27 (Supreme includes Legacy) — only an expired one is left out.
    db.rows = [row('r-old', 'af_pro_monthly', 'sub_old', { status: 'canceled', currentPeriodEnd: new Date(Date.now() - 86_400_000) })]
    expect(await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: ENV })).toEqual({ kind: 'not_applicable' })
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
  })

  it('no Supreme price configured: refused before Stripe is touched', async () => {
    db.rows = [row('r-pro', 'af_pro_monthly', 'sub_pro')]
    const stripe = fakeStripe()
    const r = await switchToSupreme({ userId: 'u1', supremeSku: 'af_supreme_monthly' as any, stripe: stripe as any, env: {} as NodeJS.ProcessEnv })
    expect(r).toMatchObject({ kind: 'failed', code: 'price_unavailable' })
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })
})

describe('pickSwitchSources', () => {
  it('only live Stripe Pro / Commissioner / Legacy rows, most expensive first', () => {
    expect(pickSwitchSources([
      { id: 'a', stripeSubscriptionId: 's1', sku: 'af_pro_yearly', live: true },
      { id: 'b', stripeSubscriptionId: 's2', sku: 'af_commissioner_monthly', live: true },
      { id: 'c', stripeSubscriptionId: 's3', sku: 'af_war_room_monthly', live: true },
      { id: 'd', stripeSubscriptionId: null, sku: 'af_pro_monthly', live: true },
      { id: 'e', stripeSubscriptionId: 's5', sku: 'af_pro_monthly', live: false },
    ]).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('the families switched are exactly what Supreme includes', () => {
    expect([...SUPREME_BUNDLED_FAMILIES].map((f) => f.replace('af_', '')).sort()).toEqual([...SUPREME_INCLUDED_PLAN_IDS].sort())
  })
})
