import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * /admin/growth (2026-11-15): the whole path — visit, sign up, bring a league, trial, paid — on one screen,
 * which features sell the plan, and whether payers stay. Distinct people per stage, this window against
 * the one before, and a section whose read failed is left out and said, never shown as zero.
 */

vi.mock('server-only', () => ({}))

import { entrySourceLabel, formatDelta, formatRate, summarizeGrowth, type GrowthEvent } from '@/lib/admin-dashboard/growthRevenue'

const NAMES = {
  landing: 'landing', signup: 'signup', emailVerified: 'verified', importStarted: 'import_started',
  importCompleted: 'import_completed', trialStarted: 'trial', checkoutStarted: 'checkout', paid: 'paid',
}
const NOW = new Date('2026-11-15T12:00:00Z')
const DAY = 86_400_000
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY)
const e = (event: string, userId: string | null, daysAgo: number, meta: Record<string, unknown> | null = null, sessionId: string | null = null): GrowthEvent =>
  ({ event, userId, sessionId, createdAt: at(daysAgo), meta })
const WINDOW = { from: at(7), to: NOW, prevFrom: at(14), days: 7 }

describe('counting the path', () => {
  const events: GrowthEvent[] = [
    e('landing', null, 1, null, 's1'), e('landing', null, 1, null, 's1'), e('landing', null, 2, null, 's2'),
    e('landing', null, 3, null, 's3'), e('landing', null, 4, null, 's4'),
    e('signup', 'a', 1), e('signup', 'b', 2),
    e('signup', 'z', 10), // the window before
    e('verified', 'a', 1),
    e('import_completed', 'a', 1, { outcome: 'imported' }), e('import_completed', 'a', 1, { outcome: 'imported' }), // two leagues, one person
    e('import_completed', 'c', 2, { outcome: 'joined_existing' }),
    e('checkout', 'a', 1, { entry_source: 'lock_player_depth' }),
    e('checkout', 'c', 1, { entry_source: 'lock_player_depth' }),
    e('checkout', 'd', 1, {}),
    e('trial', 'a', 1, { entry_source: 'lock_player_depth' }),
    e('paid', 'c', 0.5, { entry_source: 'lock_player_depth' }),
    e('paid', 'f', 0.5, { entry_source: 'ai_daily_cap', from_trial: true }),
    e('paid', 'g', 30, {}), // outside both windows
  ]
  const s = summarizeGrowth(events, NAMES, WINDOW)

  it('distinct people per stage, against the window before', () => {
    expect(s.funnel.map((x) => [x.key, x.count, x.previous])).toEqual([
      ['visitors', 4, 0], ['signups', 2, 1], ['imported', 2, 0], ['trials', 1, 0], ['paid', 2, 0],
    ])
  })

  it('each step as a share of the step before', () => {
    expect(s.funnel[0]!.fromPrevious).toBeNull()
    expect(s.funnel[1]!.fromPrevious).toBeCloseTo(0.5) // 2 of 4 visitors
    expect(s.funnel[3]!.fromPrevious).toBeCloseTo(0.5) // 1 of 2 who brought a league
  })

  it('leaguemates who joined a league someone else brought, and payers who came from a trial', () => {
    const side = Object.fromEntries(s.side.map((f) => [f.key, f.count]))
    expect(side).toMatchObject({ verified: 1, joinedLeaguemates: 1, paidFromTrial: 1 })
  })

  it('what sells: by surface, people who paid first', () => {
    expect(s.whatSells).toEqual([
      { entrySource: 'lock_player_depth', viewed: 0, clicked: 0, checkouts: 2, trials: 1, paid: 1 },
      { entrySource: 'ai_daily_cap', viewed: 0, clicked: 0, checkouts: 0, trials: 0, paid: 1 },
      { entrySource: 'unknown', viewed: 0, clicked: 0, checkouts: 1, trials: 0, paid: 0 },
    ])
  })

  it('counts offer views by user and confirmed token packs by Stripe session', () => {
    const source = { entry_source: 'lock_trade_breakdown' }
    const token = { entry_source: 'trade_review_starter_pack', stripe_session_id: 'cs_starter' }
    const report = summarizeGrowth([
      e('view', 'a', 1, source), e('view', 'a', 1, source), e('click', 'a', 1, source),
      e('token_checkout', 'a', 1, token), e('token_paid', 'a', 1, token), e('token_paid', 'a', 1, token),
    ], { ...NAMES, offerViewed: 'view', offerClicked: 'click', tokenCheckout: 'token_checkout', tokenPaid: 'token_paid' }, WINDOW)
    expect(report.whatSells).toMatchObject([{ entrySource: 'lock_trade_breakdown', viewed: 1, clicked: 1, paid: 0 }])
    expect(report.tokenSales).toEqual([{ entrySource: 'trade_review_starter_pack', checkouts: 1, paid: 1 }])
    expect(report.funnel.at(-1)?.count).toBe(0)
  })

  it('reads in plain words', () => {
    expect(entrySourceLabel('lock_player_depth')).toBe('Player depth lock')
    expect(entrySourceLabel('ai_daily_cap')).toBe('Daily AI limit reached')
    expect(entrySourceLabel('unknown')).toBe('Not tagged yet')
    expect(formatDelta(5, 3)).toBe('+2')
    expect(formatDelta(3, 5)).toBe('−2')
    expect(formatDelta(3, 3)).toBe('same')
    expect(formatRate(null)).toBe('—')
    expect(formatRate(0.123)).toBe('12%')
  })
})

describe('the report', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
  })

  function fakeDb(over: Partial<Record<'events' | 'visitors' | 'subs' | 'retention', () => Promise<unknown>>> = {}) {
    return {
      analyticsEvent: {
        findMany: vi.fn(async (args: { where: { event: { in: string[] } } }) => {
          // The retention loader reads its own events through the same table.
          if (args.where.event.in.includes('monetization.payment_failed')) return over.retention ? over.retention() : []
          return over.events ? over.events() : []
        }),
      },
      $queryRaw: vi.fn(async () => (over.visitors ? over.visitors() : [{ now: 40n, before: 30n }])),
      userSubscription: { findMany: vi.fn(async () => (over.subs ? over.subs() : [{ status: 'active', source: 'stripe', sku: 'af_pro_monthly', plan: { code: 'af_pro' } }])) },
      adminSubscriptionGrant: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    }
  }

  it('visitors are counted in SQL and feed the first step', async () => {
    const { getGrowthRevenueReport } = await import('@/lib/admin-dashboard/GrowthRevenueService')
    const r = await getGrowthRevenueReport({ db: fakeDb({ events: async () => [e('acquisition.signup_completed', 'a', 1)] }) as never, now: NOW, days: 7 })
    expect(r.growth!.funnel[0]).toMatchObject({ count: 40, previous: 30 })
    expect(r.growth!.funnel[1]!.fromPrevious).toBeCloseTo(1 / 40)
    expect(r.mrr!.priced).toBe(1)
    expect(r.errors).toEqual([])
  })

  it('🛑 a failed read leaves its section out and says so — never a zero', async () => {
    const { getGrowthRevenueReport } = await import('@/lib/admin-dashboard/GrowthRevenueService')
    const r = await getGrowthRevenueReport({ db: fakeDb({ subs: async () => { throw new Error('db') }, events: async () => { throw new Error('db') } }) as never, now: NOW })
    expect(r.mrr).toBeNull()
    expect(r.growth).toBeNull()
    expect(r.errors).toEqual(expect.arrayContaining(['Could not read the funnel events', 'Could not read subscriptions for MRR']))
  })

  it('an unknown window falls back to 7 days', async () => {
    const { getGrowthRevenueReport } = await import('@/lib/admin-dashboard/GrowthRevenueService')
    expect((await getGrowthRevenueReport({ db: fakeDb() as never, now: NOW, days: 999 })).days).toBe(7)
    expect((await getGrowthRevenueReport({ db: fakeDb() as never, now: NOW, days: 30 })).days).toBe(30)
  })
})

describe('the page', () => {
  const gate = vi.hoisted(() => ({ status: 'ok' as string }))
  const report = vi.hoisted(() => ({ value: null as unknown }))
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`redirect ${u}`) }) }))
    vi.doMock('@/lib/adminAuth', () => ({ getAdminAccessState: async () => ({ status: gate.status }) }))
    vi.doMock('@/lib/admin-dashboard/GrowthRevenueService', () => ({ GROWTH_WINDOWS: [7, 14, 30], getGrowthRevenueReport: async () => report.value }))
  })
  afterEach(() => cleanup())

  it('shows the path, what sells and revenue health, and names a missing section', async () => {
    gate.status = 'ok'
    const growth = summarizeGrowth([e('signup', 'a', 1), e('paid', 'a', 1, { entry_source: 'lock_player_depth' })], NAMES, WINDOW)
    report.value = {
      days: 7, generatedAt: NOW.toISOString(), truncated: false, growth,
      mrr: { mrrCents: 99900, priced: 1, unpriced: 0, trialing: 2, comped: 0, byFamily: {} },
      retention: { failedInvoices: 4, recoveredInvoices: 3, trialsStarted: 10, trialsConverted: 4, cancellations: 2, cameBack: 1 },
      proWeek: null,
      errors: ['Could not read referral weeks'],
    }
    const { default: Page } = await import('@/app/admin/growth/page')
    render(await Page({ searchParams: Promise.resolve({ days: '7' }) }))
    expect(screen.getByRole('heading', { name: 'Growth & revenue' })).toBeTruthy()
    expect(screen.getByTestId('admin-growth-funnel').querySelectorAll('li')).toHaveLength(5)
    // In 'What sells' and again in the AF Intelligence locks group (2026-11-22), which also sums them.
    expect(screen.getAllByText('Player depth lock')).toHaveLength(2)
    expect(screen.getByText('All Chimmy Intelligence locks')).toBeTruthy()
    expect(screen.getByText('$999.00')).toBeTruthy()
    expect(screen.getByText('3 of 4')).toBeTruthy()
    expect(screen.getByTestId('admin-growth-errors').textContent).toContain('Could not read referral weeks')
  })

  it('🛑 refuses anyone who is not an admin', async () => {
    gate.status = 'forbidden'
    const { default: Page } = await import('@/app/admin/growth/page')
    render(await Page({}))
    expect(screen.getByText(/Forbidden/)).toBeTruthy()
    expect(screen.queryByTestId('admin-growth')).toBeNull()
  })
})
