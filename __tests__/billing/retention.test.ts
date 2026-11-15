// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/*
 * Keeping the people who pay (2026-11-15): a failed card is told at once and again before access ends,
 * a free trial gets a personalised note two days before its first charge (only if it will really renew),
 * and a cancellation gets one "come back" note three days later — never by email after Unsubscribe.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/stripe-client', () => ({ getStripeClient: () => ({}) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/analytics/recordFunnelEvent', () => ({ recordFunnelEvent: vi.fn(async () => true) }))

import {
  paymentFailedNotice,
  summarizeRetention,
  trialEndingNotice,
  trialWeekSummary,
} from '@/lib/billing/retention'
import { onPaymentFailed, onPaymentRecovered, onSubscriptionCanceled, wasPastDue } from '@/lib/billing/retentionWebhook'
import { runRetentionPasses } from '@/lib/billing/retentionPasses'
import { MONETIZATION } from '@/lib/analytics/eventNames'

const NOW = new Date('2026-11-15T12:00:00Z')
const H = 3_600_000

describe('the words', () => {
  it('a failed card says when access ends, or just what to do', () => {
    expect(paymentFailedNotice('Nov 22').body).toContain('until Nov 22')
    expect(paymentFailedNotice(null).body).not.toContain('until')
  })

  it('the trial note says what AF Pro did, in facts, or nothing invented', () => {
    expect(trialWeekSummary({ lineupCalls: 6, waiverPicks: 3, leagues: 2 })).toBe('This week Chimmy gave you 6 lineup calls and 3 waiver picks across 2 leagues.')
    expect(trialWeekSummary({ lineupCalls: 1, waiverPicks: 0, leagues: 1 })).toBe('This week Chimmy gave you 1 lineup call.')
    expect(trialWeekSummary({ lineupCalls: 0, waiverPicks: 0, leagues: 0 })).toBeNull()
    const n = trialEndingNotice({ planName: 'AF Pro', chargeOn: 'Nov 22', summary: null })
    expect(n.body).toContain('Your AF Pro trial is almost over.')
    // It must say how to stop, before the charge.
    expect(n.body).toMatch(/cancel in Settings → Billing before then and you won't be charged/)
  })
})

describe('admin counting', () => {
  const N = {
    failed: MONETIZATION.PAYMENT_FAILED,
    recovered: MONETIZATION.PAYMENT_RECOVERED,
    trialStarted: MONETIZATION.TRIAL_STARTED,
    paid: MONETIZATION.PAID_CONVERSION_CONFIRMED,
    canceled: MONETIZATION.SUBSCRIPTION_CANCELED,
  }
  const t = (h: number) => new Date(NOW.getTime() + h * H)
  const e = (event: string, userId: string, h: number, meta: Record<string, unknown> = {}) => ({ event, userId, createdAt: t(h), meta })

  it('counts invoices once however often Stripe retried, and who came back after cancelling', () => {
    const s = summarizeRetention([
      e(N.failed, 'a', 0, { invoice_id: 'in1' }),
      e(N.failed, 'a', 24, { invoice_id: 'in1' }), // a retry of the same invoice
      e(N.failed, 'b', 0, { invoice_id: 'in2' }),
      e(N.recovered, 'a', 30, { invoice_id: 'in1' }),
      e(N.trialStarted, 'c', 0),
      e(N.trialStarted, 'd', 0),
      e(N.paid, 'c', 170, { from_trial: true }),
      e(N.canceled, 'f', 0),
      e(N.canceled, 'g', 0),
      e(N.paid, 'f', 100),
      e(N.paid, 'g', -100), // paid BEFORE cancelling: not a return
    ], N)
    expect(s).toEqual({ failedInvoices: 2, recoveredInvoices: 1, trialsStarted: 2, trialsConverted: 1, cancellations: 2, cameBack: 1 })
  })
})

describe('the webhook half', () => {
  const invoice = (over: Record<string, unknown> = {}) =>
    ({ id: 'in_1', customer: 'cus_1', attempt_count: 1, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [] }, ...over }) as never

  function db(opts: { recorded?: boolean; status?: string } = {}) {
    return {
      userSubscription: {
        findFirst: vi.fn(async () => ({ gracePeriodEnd: new Date(NOW.getTime() + 7 * 24 * H), status: opts.status ?? 'past_due' })),
      },
      analyticsEvent: { findFirst: vi.fn(async () => (opts.recorded ? { id: 'x' } : null)) },
    }
  }

  it('a failed card: an email and bell notice keyed on the invoice, and one analytics row', async () => {
    const notify = vi.fn(async () => {})
    const record = vi.fn(async () => true)
    await onPaymentFailed(invoice(), 'u1', { db: db() as never, notify: notify as never, record: record as never })
    const [p] = notify.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(p).toMatchObject({ category: 'system_account', dedupePrefix: 'billing-payment-failed:in_1', actionHref: '/api/subscription/billing-portal', skipChannels: { sms: true } })
    expect(String(p.body)).toContain('Nov 22')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event: MONETIZATION.PAYMENT_FAILED, meta: expect.objectContaining({ invoice_id: 'in_1' }) }))
  })

  it('a Stripe retry of the same invoice records nothing new (the notice dedupes on its key)', async () => {
    const record = vi.fn(async () => true)
    await onPaymentFailed(invoice(), 'u1', { db: db({ recorded: true }) as never, notify: vi.fn(async () => {}) as never, record: record as never })
    expect(record).not.toHaveBeenCalled()
  })

  it('a paid invoice on a past-due row is a recovered card; an ordinary renewal is not', async () => {
    expect(await wasPastDue(invoice(), 'u1', db({ status: 'past_due' }) as never)).toBe(true)
    expect(await wasPastDue(invoice(), 'u1', db({ status: 'active' }) as never)).toBe(false)
    const record = vi.fn(async () => true)
    await onPaymentRecovered(invoice(), 'u1', { db: db() as never, record: record as never })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event: MONETIZATION.PAYMENT_RECOVERED }))
  })

  it('a cancellation says whether it ended inside the free trial', async () => {
    const record = vi.fn(async () => true)
    const sec = (d: Date) => Math.floor(d.getTime() / 1000)
    await onSubscriptionCanceled({ id: 'sub_t', ended_at: sec(NOW), trial_end: sec(new Date(NOW.getTime() + 2 * 24 * H)) } as never, 'u1', { db: db() as never, record: record as never })
    await onSubscriptionCanceled({ id: 'sub_p', ended_at: sec(NOW), trial_end: sec(new Date(NOW.getTime() - 20 * 24 * H)) } as never, 'u1', { db: db() as never, record: record as never })
    expect(record.mock.calls.map((c) => (c[0] as { meta: Record<string, unknown> }).meta.was_trial)).toEqual([true, false])
  })

  it('never throws, so a notice failing can never fail Stripe’s delivery', async () => {
    const broken = { userSubscription: { findFirst: vi.fn(async () => { throw new Error('db down') }) }, analyticsEvent: { findFirst: vi.fn(async () => { throw new Error('db down') }) } }
    await expect(onPaymentFailed(invoice(), 'u1', { db: broken as never, notify: vi.fn(async () => { throw new Error('x') }) as never })).resolves.toBeUndefined()
    await expect(onSubscriptionCanceled({ id: 's' } as never, 'u1', { db: broken as never, record: vi.fn(async () => { throw new Error('x') }) as never })).resolves.toBeUndefined()
  })

  it('the webhook calls each at the right moment', () => {
    const src = readFileSync('app/api/stripe/webhook/route.ts', 'utf8')
    expect(src).toMatch(/await markSubscriptionPastDue\(invoice, userId\)\n\s+await syncUserProfileFromSubscriptions\(userId\)\n[^\n]*\n\s+await onPaymentFailed\(invoice, userId\)/)
    expect(src).toMatch(/await markSubscriptionAsExpired\(deletedSub, userId\)[\s\S]{0,200}await onSubscriptionCanceled\(deletedSub, userId\)/)
    // Read the status BEFORE the refresh overwrites it with `active`.
    expect(src.indexOf('const recovering = await wasPastDue(invoice, userId)')).toBeGreaterThan(-1)
    expect(src.indexOf('const recovering = await wasPastDue(invoice, userId)')).toBeLessThan(src.indexOf('await refreshSubscriptionPeriod(invoice, userId)'))
    const cron = readFileSync('app/api/cron/reap-sync-runs/route.ts', 'utf8')
    expect(cron).toMatch(/await runRetentionPasses\(\)\.catch/)
  })
})

describe('the hourly passes', () => {
  type Row = Record<string, unknown>
  function fakeDb(o: { pastDue?: Row[]; trials?: Row[]; canceled?: Row[]; liveFor?: string[]; advice?: Row[] } = {}) {
    return {
      userSubscription: {
        findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
          where.status === 'past_due' ? o.pastDue ?? [] : where.status === 'trialing' ? o.trials ?? [] : o.canceled ?? [],
        ),
        count: vi.fn(async ({ where }: { where: { userId: string } }) => ((o.liveFor ?? []).includes(where.userId) ? 1 : 0)),
      },
      adminSubscriptionGrant: { count: vi.fn(async () => 0) },
      chimmyAdvice: { findMany: vi.fn(async () => o.advice ?? []) },
      appUser: { findUnique: vi.fn(async () => ({ email: 'm@allfantasy-test.net' })) },
    }
  }
  const stripeWith = (subs: Record<string, Row>) => () => ({ subscriptions: { retrieve: vi.fn(async (id: string) => subs[id]) } }) as never
  const run = (db: unknown, extra: Record<string, unknown> = {}) => {
    const notify = vi.fn(async () => {})
    return {
      notify,
      done: runRetentionPasses({ db: db as never, now: NOW, notify: notify as never, readSubscription: async () => ({ unsubscribedAt: null }), stripe: stripeWith({}), ...extra }),
    }
  }

  it('the day before access ends, a last card notice keyed on the row and the date', async () => {
    const graceEnd = new Date(NOW.getTime() + 20 * H)
    const { notify, done } = run(fakeDb({ pastDue: [{ id: 's1', userId: 'u1', gracePeriodEnd: graceEnd }] }))
    expect((await done).paymentFinal).toEqual({ candidates: 1, sent: 1, failed: 0 })
    expect((notify.mock.calls[0] as unknown as [Row])[0]).toMatchObject({ type: 'billing_payment_final', dedupePrefix: `billing-payment-final:s1:${graceEnd.toISOString().slice(0, 10)}` })
  })

  it('a trial that will renew gets the personalised note; one already cancelled gets nothing', async () => {
    const end = new Date(NOW.getTime() + 48 * H)
    const db = fakeDb({
      trials: [
        { id: 't1', userId: 'u1', sku: 'af_pro_monthly', stripeSubscriptionId: 'sub_renews', currentPeriodEnd: end, createdAt: new Date(NOW.getTime() - 5 * 24 * H) },
        { id: 't2', userId: 'u2', sku: 'af_pro_monthly', stripeSubscriptionId: 'sub_cancelled', currentPeriodEnd: end, createdAt: new Date(NOW.getTime() - 5 * 24 * H) },
      ],
      advice: [
        { adviceType: 'start_sit', leagueId: 'L1' }, { adviceType: 'start_sit', leagueId: 'L2' }, { adviceType: 'add', leagueId: 'L1' },
      ],
    })
    const stripe = stripeWith({ sub_renews: { status: 'trialing', cancel_at_period_end: false, cancel_at: null }, sub_cancelled: { status: 'trialing', cancel_at_period_end: true, cancel_at: null } })
    const { notify, done } = run(db, { stripe })
    expect((await done).trialEnding).toEqual({ candidates: 2, sent: 1, notRenewing: 1, failed: 0 })
    const [p] = notify.mock.calls[0] as unknown as [Row]
    expect(p).toMatchObject({ userIds: ['u1'], type: 'billing_trial_ending', actionHref: '/settings?tab=billing' })
    expect(String(p.body)).toContain('This week Chimmy gave you 2 lineup calls and 1 waiver pick across 2 leagues.')
  })

  it('a win-back note only for someone who has not come back, and never by email after Unsubscribe', async () => {
    const db = fakeDb({ canceled: [{ id: 'c1', userId: 'gone' }, { id: 'c2', userId: 'returned' }], liveFor: ['returned'] })
    const { notify, done } = run(db, { readSubscription: async () => ({ unsubscribedAt: new Date('2026-10-01') }) })
    expect((await done).winBack).toEqual({ candidates: 2, sent: 1, cameBack: 1, failed: 0 })
    const [p] = notify.mock.calls[0] as unknown as [Row]
    expect(p).toMatchObject({ userIds: ['gone'], type: 'billing_win_back', dedupePrefix: 'billing-win-back:c1', skipChannels: { sms: true, email: true } })
  })

  it('a subscribed address does get the win-back email', async () => {
    const { notify, done } = run(fakeDb({ canceled: [{ id: 'c1', userId: 'gone' }] }))
    await done
    expect((notify.mock.calls[0] as unknown as [Row])[0].skipChannels).toEqual({ sms: true })
  })
})

describe('the banner', () => {
  beforeEach(() => vi.resetModules())
  it('source: mounted in the core shell, never in the iOS app, links to the card form', () => {
    const shell = readFileSync('components/core-app/AfCoreShell.tsx', 'utf8')
    expect(shell).toMatch(/<PaymentIssueBanner \/>/)
    const banner = readFileSync('components/billing/PaymentIssueBanner.tsx', 'utf8')
    expect(banner).toMatch(/isInIosAppClient\(\)/)
    expect(banner).toMatch(/status !== 'grace' && status !== 'past_due'/)
    expect(banner).toMatch(/href=\{BILLING_PORTAL_HREF\}/)
  })
})
