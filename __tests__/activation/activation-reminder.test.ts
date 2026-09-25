import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: vi.fn() }))

import {
  activationEmailEligible,
  activationReminderDue,
  activationReminderKey,
  FIRST_REMINDER_AFTER_SIGNUP_MS,
  renderActivationReminder,
  SECOND_REMINDER_AFTER_FIRST_MS,
} from '@/lib/onboarding-retention/activationReminder'
import { runActivationReminder, type ActivationReminderDeps } from '@/lib/onboarding-retention/runActivationReminder'

/**
 * The "connect your league" reminder: two, ever, to a real inbox that asked for product email.
 * Every rule here protects either the recipient or the sender reputation the lineup checks ride on.
 */

const NOW = new Date('2026-09-26T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const DAY = 24 * 60 * 60 * 1000

describe('who can be emailed', () => {
  it('a real address only — never a Sleeper placeholder or a test domain', () => {
    expect(activationEmailEligible('manager@gmail.com')).toBe(true)
    expect(activationEmailEligible('12345@sleeper.allfantasy.ai')).toBe(false)
    expect(activationEmailEligible('x@example.com')).toBe(false)
    expect(activationEmailEligible('not-an-email')).toBe(false)
    expect(activationEmailEligible(null)).toBe(false)
  })
})

describe('when', () => {
  it('first a day after signup, second a week after the first, then never', () => {
    expect(activationReminderDue({ createdAt: ago(FIRST_REMINDER_AFTER_SIGNUP_MS - 1), now: NOW, sent: {} })).toBeNull()
    expect(activationReminderDue({ createdAt: ago(FIRST_REMINDER_AFTER_SIGNUP_MS), now: NOW, sent: {} })).toBe(1)
    expect(activationReminderDue({ createdAt: ago(30 * DAY), now: NOW, sent: { 1: ago(SECOND_REMINDER_AFTER_FIRST_MS - 1) } })).toBeNull()
    expect(activationReminderDue({ createdAt: ago(30 * DAY), now: NOW, sent: { 1: ago(SECOND_REMINDER_AFTER_FIRST_MS) } })).toBe(2)
    expect(activationReminderDue({ createdAt: ago(90 * DAY), now: NOW, sent: { 1: ago(60 * DAY), 2: ago(50 * DAY) } })).toBeNull()
    // A second on record without a first still ends it.
    expect(activationReminderDue({ createdAt: ago(90 * DAY), now: NOW, sent: { 2: ago(50 * DAY) } })).toBeNull()
  })
  it('keys one row per reminder', () => {
    expect(activationReminderKey('u1', 1)).toBe('activation-reminder:v1:u1:1')
  })
})

describe('what it says', () => {
  const opts = { baseUrl: 'https://allfantasy.ai/', unsubscribeUrl: 'https://allfantasy.ai/api/email/unsubscribe?token=a"b' }

  it('points at the import, tagged by which reminder, and carries an unsubscribe link', () => {
    const one = renderActivationReminder(1, opts)
    expect(one.subject).toBe("Chimmy can't see your team yet")
    expect(one.html).toContain('https://allfantasy.ai/import?from=activation_email_1')
    expect(one.html).toContain('Unsubscribe')
    expect(one.html).toContain('token=a&quot;b')
    expect(one.html).not.toContain('last reminder')
  })
  it('the second says it is the last', () => {
    const two = renderActivationReminder(2, opts)
    expect(two.subject).toBe('Still want Chimmy on your lineup?')
    expect(two.html).toContain('/import?from=activation_email_2')
    expect(two.html).toMatch(/last reminder/)
  })
  it('never says AI to a customer', () => {
    for (const n of [1, 2] as const) {
      const e = renderActivationReminder(n, opts)
      expect(e.subject).not.toMatch(/\bAI\b/)
      expect(e.html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\bAI\b/)
    }
  })
})

describe('runActivationReminder', () => {
  let deps: ActivationReminderDeps
  let claimed: Set<string>
  const cand = (userId: string, email: string, signedUpDaysAgo: number) => ({ userId, email, createdAt: ago(signedUpDaysAgo * DAY) })

  beforeEach(() => {
    claimed = new Set()
    deps = {
      now: () => NOW,
      loadCandidates: vi.fn(async () => [cand('u1', 'one@gmail.com', 3), cand('u2', 'two@gmail.com', 10)]),
      loadSent: vi.fn(async () => new Map()),
      loadOptedOut: vi.fn(async () => new Set<string>()),
      claim: vi.fn(async (key: string) => {
        if (claimed.has(key)) return false
        claimed.add(key)
        return true
      }),
      send: vi.fn(async () => ({ ok: true })),
      baseUrl: () => 'https://allfantasy.ai',
      unsubscribeUrl: (e: string) => `https://allfantasy.ai/unsub?e=${e}`,
    }
  })

  it('asks for users who signed up over an hour ago, in the current season', async () => {
    await runActivationReminder({}, deps)
    expect(deps.loadCandidates).toHaveBeenCalledWith(2026, new Date(NOW.getTime() - 60 * 60 * 1000))
  })

  it('sends the first reminder to each, oldest signup first, and never twice', async () => {
    const run = await runActivationReminder({}, deps)
    expect(run).toMatchObject({ sent: 2, due: { first: 2, second: 0 }, failed: 0 })
    expect(vi.mocked(deps.send).mock.calls.map((c) => c[0].to)).toEqual(['two@gmail.com', 'one@gmail.com'])
    expect(vi.mocked(deps.send).mock.calls[0]![0]).toMatchObject({ subject: "Chimmy can't see your team yet" })
    expect(vi.mocked(deps.send).mock.calls[0]![0].html).toContain('https://allfantasy.ai/unsub?e=two@gmail.com')

    const again = await runActivationReminder({}, deps)
    expect(again).toMatchObject({ sent: 0, skipped: { alreadyClaimed: 2 } })
    expect(deps.send).toHaveBeenCalledTimes(2)
  })

  it('sends the second only a week after the first, and nothing after it', async () => {
    deps.loadSent = vi.fn(async () => new Map([
      ['u1', { 1: ago(8 * DAY) }],
      ['u2', { 1: ago(2 * DAY) }],
    ]))
    const run = await runActivationReminder({}, deps)
    expect(run).toMatchObject({ sent: 1, due: { first: 0, second: 1 }, skipped: { notDue: 1 } })
    expect(vi.mocked(deps.send).mock.calls[0]![0]).toMatchObject({ to: 'one@gmail.com', subject: 'Still want Chimmy on your lineup?' })
    expect(deps.claim).toHaveBeenCalledWith('activation-reminder:v1:u1:2', NOW)
  })

  it('skips placeholder addresses and anyone who unsubscribed', async () => {
    deps.loadCandidates = vi.fn(async () => [
      cand('u1', 'One@Gmail.com', 3),
      cand('u2', '99@sleeper.allfantasy.ai', 3),
      cand('u3', 'three@gmail.com', 3),
    ])
    deps.loadOptedOut = vi.fn(async () => new Set(['one@gmail.com']))
    const run = await runActivationReminder({}, deps)
    expect(run).toMatchObject({ candidates: 3, sent: 1, skipped: { ineligibleEmail: 1, optedOut: 1 } })
    expect(vi.mocked(deps.send).mock.calls[0]![0].to).toBe('three@gmail.com')
    expect(deps.loadOptedOut).toHaveBeenCalledWith(['One@Gmail.com', 'three@gmail.com'])
  })

  it('a dry run counts who is due and sends and claims nothing', async () => {
    const run = await runActivationReminder({ dryRun: true }, deps)
    expect(run).toMatchObject({ dryRun: true, sent: 0, due: { first: 2 } })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('stops at its cap and says how many it did not reach', async () => {
    const run = await runActivationReminder({ limit: 1 }, deps)
    expect(run).toMatchObject({ sent: 1, notReached: 1 })
    const none = await runActivationReminder({ budgetMs: 0 }, { ...deps, claim: vi.fn(async () => true) })
    expect(none).toMatchObject({ sent: 0, notReached: 2 })
  })

  it('reports a failed send by user, never by address, and carries on', async () => {
    deps.send = vi.fn(async ({ to }: { to: string }) => (to === 'two@gmail.com' ? { ok: false, error: 'bounced' } : { ok: true }))
    const run = await runActivationReminder({}, deps)
    expect(run).toMatchObject({ sent: 1, failed: 1 })
    expect(run.errors).toEqual(['u2: bounced'])
    expect(JSON.stringify(run)).not.toContain('@gmail.com')
  })
})
