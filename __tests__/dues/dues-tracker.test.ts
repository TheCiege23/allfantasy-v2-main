import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyCommissionerUpdate,
  applySelfReport,
  isTracking,
  parsePaymentLink,
  readDuesConfig,
  reminderDue,
  teamPaid,
} from '@/lib/dues/duesTracker'
import { LEAGUE_ENTRY_FEE_ENV_VAR, leagueMoneyRefusal } from '@/lib/monetization/leagueEntryFeeKillSwitch'

const NOW = new Date('2026-11-07T12:00:00Z')
const actor = { userId: 'commish', now: NOW }

describe('payment links — rendered as a link on every member’s screen', () => {
  it('accepts an https link on the service’s own host', () => {
    expect(parsePaymentLink({ kind: 'venmo', url: 'https://venmo.com/u/LeagueBank' })).toEqual({ kind: 'venmo', url: 'https://venmo.com/u/LeagueBank' })
    expect(parsePaymentLink({ kind: 'cashapp', url: 'https://cash.app/$league' })).not.toBeNull()
    expect(parsePaymentLink({ kind: 'paypal', url: 'https://www.paypal.com/paypalme/league' })).not.toBeNull()
    expect(parsePaymentLink({ kind: 'other', url: 'https://example.org/pay' })).not.toBeNull()
  })

  it('refuses anything that is not https, or a known kind on another host', () => {
    expect(parsePaymentLink({ kind: 'other', url: 'javascript:alert(1)' })).toBeNull()
    expect(parsePaymentLink({ kind: 'other', url: 'http://example.org/pay' })).toBeNull()
    expect(parsePaymentLink({ kind: 'venmo', url: 'https://venmo.com.evil.example/u/x' })).toBeNull()
    expect(parsePaymentLink({ kind: 'paypal', url: 'https://evil.example/paypal.me' })).toBeNull()
    expect(parsePaymentLink({ kind: 'other', url: 'https://user:pass@example.org' })).toBeNull()
    expect(parsePaymentLink({ kind: 'bitcoin', url: 'https://example.org' })).toBeNull()
  })

  it('a commissioner save with one bad link is refused whole', () => {
    const r = applyCommissionerUpdate(readDuesConfig(null), { paymentLinks: [{ kind: 'venmo', url: 'https://venmo.com/u/a' }, { kind: 'other', url: 'javascript:x' }] }, actor)
    expect(r).toEqual({ ok: false, error: 'invalid_payment_link' })
  })
})

describe('reading what is stored', () => {
  it('reads the old single-link shape into the new one, and drops an unsafe old link', () => {
    expect(readDuesConfig({ amount: 50, paymentLink: 'https://leaguesafe.com/join/1', paymentProvider: 'leaguesafe' }).paymentLinks).toEqual([
      { kind: 'leaguesafe', url: 'https://leaguesafe.com/join/1' },
    ])
    expect(readDuesConfig({ paymentLink: 'javascript:alert(1)' }).paymentLinks).toEqual([])
  })

  it('a league that set an amount is tracking dues even though the switch was never shown', () => {
    expect(isTracking(readDuesConfig({ amount: 25 }))).toBe(true)
    expect(isTracking(readDuesConfig({}))).toBe(false)
  })
})

describe('"I paid" is a claim, not a payment', () => {
  it('records the claim on the member’s team and never marks it paid', () => {
    const c = applySelfReport(readDuesConfig({ amount: 50, entries: [] }), 't1', 'Venmo Tuesday', NOW)
    expect(c.entries).toEqual([expect.objectContaining({ teamId: 't1', paid: false, selfReportedAt: NOW.toISOString(), selfReportedNote: 'Venmo Tuesday' })])
    expect(teamPaid(c, 't1', 2026, false)).toBe(false)
  })

  it('survives the commissioner’s next save, and confirming it records who confirmed', () => {
    const claimed = applySelfReport(readDuesConfig({ amount: 50 }), 't1', '', NOW)
    const r = applyCommissionerUpdate(claimed, { entries: [{ teamId: 't1', paid: true, paidSeasons: [2026] }] }, actor)
    if (!r.ok) throw new Error('refused')
    expect(r.config.entries[0]).toMatchObject({ paid: true, confirmedBy: 'commish', selfReportedAt: NOW.toISOString(), paidAt: NOW.toISOString() })
  })
})

describe('reminders — a week before, the day before, once overdue', () => {
  const config = (over: Record<string, unknown> = {}) => readDuesConfig({ amount: 50, dueDate: '2026-11-14', ...over })
  const at = (iso: string) => new Date(iso)

  it('fires in each window, once per season', () => {
    expect(reminderDue(config(), 2026, at('2026-11-08T12:00:00Z'))).toBe('week_before')
    expect(reminderDue(config(), 2026, at('2026-11-14T08:00:00Z'))).toBe('day_before')
    expect(reminderDue(config(), 2026, at('2026-11-19T12:00:00Z'))).toBe('overdue')
    expect(reminderDue(config(), 2026, at('2026-11-11T12:00:00Z'))).toBeNull()
    expect(reminderDue(config({ remindersSent: { '2026:week_before': 'x' } }), 2026, at('2026-11-08T12:00:00Z'))).toBeNull()
  })

  it('nothing without a due date, an amount, or long after the due date', () => {
    expect(reminderDue(config({ dueDate: null }), 2026, at('2026-11-08T12:00:00Z'))).toBeNull()
    expect(reminderDue(readDuesConfig({ dueDate: '2026-11-14' }), 2026, at('2026-11-08T12:00:00Z'))).toBeNull()
    expect(reminderDue(config(), 2026, at('2026-12-30T12:00:00Z'))).toBeNull()
  })

  it('a new due date starts the reminders over', () => {
    const r = applyCommissionerUpdate(config({ remindersSent: { '2026:week_before': 'x' } }), { dueDate: '2026-11-21' }, actor)
    if (!r.ok) throw new Error('refused')
    expect(r.config.remindersSent).toEqual({})
  })
})

describe('🛑 the league money switch', () => {
  const prior = process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
  afterEach(() => {
    if (prior === undefined) delete process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
    else process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = prior
  })

  it('refuses while unset, or set to anything but exactly "true"', () => {
    delete process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
    expect(leagueMoneyRefusal('payouts')).toMatchObject({ code: 'league_entry_fee_disabled', status: 403 })
    process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = 'TRUE'
    expect(leagueMoneyRefusal()).not.toBeNull()
    process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = 'true'
    expect(leagueMoneyRefusal()).toBeNull()
  })
})

describe('🛑 the paid-join gate while AllFantasy holds no money', () => {
  const h = vi.hoisted(() => ({ finance: vi.fn(), dues: vi.fn() }))
  vi.mock('@/lib/league-finance/leagueFinanceService', () => ({ getOrCreateLeagueFinance: h.finance, resolveSeasonForLeague: async () => 2026 }))
  vi.mock('@/lib/prisma', () => ({ prisma: { leagueDues: { findUnique: h.dues } } }))
  const prior = process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
  beforeEach(() => {
    h.finance.mockReset().mockResolvedValue({ isPaidLeague: true, entryFeeCents: 5000 })
    h.dues.mockReset().mockResolvedValue(null)
  })
  afterEach(() => {
    if (prior === undefined) delete process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
    else process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = prior
  })

  it('lets a manager join a "paid" league — nobody can pay through AllFantasy, so nobody is blocked for it', async () => {
    delete process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
    const { assertPaidJoinAllowed } = await import('@/lib/league-finance/joinGate')
    expect(await assertPaidJoinAllowed({ leagueId: 'L1', userId: 'u1' })).toEqual({ ok: true })
    expect(h.finance).not.toHaveBeenCalled()
  })

  it('positive control: with the switch on, the same unpaid join is still refused', async () => {
    process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = 'true'
    const { assertPaidJoinAllowed } = await import('@/lib/league-finance/joinGate')
    expect(await assertPaidJoinAllowed({ leagueId: 'L1', userId: 'u1' })).toMatchObject({ ok: false, code: 'PAYMENT_REQUIRED' })
  })
})
