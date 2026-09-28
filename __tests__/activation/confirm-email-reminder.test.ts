import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: vi.fn() }))

import {
  CONFIRM_FIRST_AFTER_SIGNUP_MS,
  CONFIRM_MAX_SIGNUP_AGE_MS,
  CONFIRM_SECOND_AFTER_FIRST_MS,
  confirmEmailReminderDue,
  confirmEmailReminderKey,
  renderConfirmEmailReminder,
} from '@/lib/onboarding-retention/confirmEmailReminder'
import { runConfirmEmailReminder, type ConfirmEmailReminderDeps } from '@/lib/onboarding-retention/runConfirmEmailReminder'

/**
 * The "confirm your email" reminder: two, ever, each with a link that still works when it is opened,
 * and never to an address that is not a real inbox or asked not to hear from us.
 */

const NOW = new Date('2026-09-26T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const DAY = 24 * 60 * 60 * 1000

describe('when', () => {
  it('first a day after signup, second four days after the first, then never', () => {
    expect(confirmEmailReminderDue({ createdAt: ago(CONFIRM_FIRST_AFTER_SIGNUP_MS - 1), now: NOW, sent: {} })).toBeNull()
    expect(confirmEmailReminderDue({ createdAt: ago(CONFIRM_FIRST_AFTER_SIGNUP_MS), now: NOW, sent: {} })).toBe(1)
    expect(confirmEmailReminderDue({ createdAt: ago(10 * DAY), now: NOW, sent: { 1: ago(CONFIRM_SECOND_AFTER_FIRST_MS - 1) } })).toBeNull()
    expect(confirmEmailReminderDue({ createdAt: ago(10 * DAY), now: NOW, sent: { 1: ago(CONFIRM_SECOND_AFTER_FIRST_MS) } })).toBe(2)
    expect(confirmEmailReminderDue({ createdAt: ago(20 * DAY), now: NOW, sent: { 1: ago(10 * DAY), 2: ago(6 * DAY) } })).toBeNull()
    // A second on record without a first still ends it.
    expect(confirmEmailReminderDue({ createdAt: ago(20 * DAY), now: NOW, sent: { 2: ago(6 * DAY) } })).toBeNull()
  })

  it('only recent sign-ups START the sequence, but a started one is finished', () => {
    expect(confirmEmailReminderDue({ createdAt: ago(CONFIRM_MAX_SIGNUP_AGE_MS), now: NOW, sent: {} })).toBe(1)
    expect(confirmEmailReminderDue({ createdAt: ago(CONFIRM_MAX_SIGNUP_AGE_MS + 1), now: NOW, sent: {} })).toBeNull()
    expect(confirmEmailReminderDue({ createdAt: ago(150 * DAY), now: NOW, sent: {} })).toBeNull()
    // Got the first at day 60, so the second still goes at day 64.
    expect(
      confirmEmailReminderDue({ createdAt: ago(CONFIRM_MAX_SIGNUP_AGE_MS + 4 * DAY), now: NOW, sent: { 1: ago(4 * DAY) } }),
    ).toBe(2)
  })

  it('keys one row per reminder, apart from the connect-your-league ones', () => {
    expect(confirmEmailReminderKey('u1', 1)).toBe('confirm-email-reminder:v1:u1:1')
    expect(confirmEmailReminderKey('u1', 2)).not.toContain('activation-reminder')
  })
})

describe('what it says', () => {
  const opts = {
    verifyUrl: 'https://allfantasy.ai/verify/email?token=t0k&returnTo=%2Fonboarding',
    baseUrl: 'https://allfantasy.ai/',
    unsubscribeUrl: 'https://allfantasy.ai/api/email/unsubscribe?token=a"b',
  }

  it('the button is the confirmation link, and it says how long the link works', () => {
    const one = renderConfirmEmailReminder(1, opts)
    expect(one.subject).toBe("Confirm your email and you're in")
    expect(one.html).toContain('href="https://allfantasy.ai/verify/email?token=t0k&amp;returnTo=%2Fonboarding"')
    expect(one.html).toContain('Confirm my email')
    expect(one.html).toContain('This link works for 7 days.')
    expect(one.html).toContain('Not you? Ignore this email')
    expect(one.html).toContain('Unsubscribe')
    expect(one.html).toContain('token=a&quot;b')
    expect(one.html).not.toContain('last reminder')
  })

  it('the second says it is the last', () => {
    const two = renderConfirmEmailReminder(2, opts)
    expect(two.subject).toBe('Your AllFantasy account is still waiting')
    expect(two.html).toMatch(/last reminder/)
  })

  it('never says AI to a customer', () => {
    for (const n of [1, 2] as const) {
      const e = renderConfirmEmailReminder(n, opts)
      expect(e.subject).not.toMatch(/\bAI\b/)
      expect(e.html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\bAI\b/)
    }
  })
})

describe('runConfirmEmailReminder', () => {
  let deps: ConfirmEmailReminderDeps
  let claimed: Set<string>
  let issued: string[]
  let discarded: string[]
  const cand = (userId: string, email: string, signedUpDaysAgo: number) => ({ userId, email, createdAt: ago(signedUpDaysAgo * DAY) })

  beforeEach(() => {
    claimed = new Set()
    issued = []
    discarded = []
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
      issueLink: vi.fn(async (userId: string) => {
        issued.push(userId)
        return {
          url: `https://allfantasy.ai/verify/email?token=fresh-${userId}`,
          discard: async () => {
            discarded.push(userId)
          },
        }
      }),
      send: vi.fn(async () => ({ ok: true })),
      baseUrl: () => 'https://allfantasy.ai',
      unsubscribeUrl: (e: string) => `https://allfantasy.ai/unsub?e=${e}`,
    }
  })

  it('asks for unconfirmed sign-ups at least a day old, reaching back far enough to finish a sequence', async () => {
    await runConfirmEmailReminder({}, deps)
    const [after, before] = vi.mocked(deps.loadCandidates).mock.calls[0]!
    expect(before).toEqual(new Date(NOW.getTime() - CONFIRM_FIRST_AFTER_SIGNUP_MS))
    expect(NOW.getTime() - after.getTime()).toBeGreaterThanOrEqual(CONFIRM_MAX_SIGNUP_AGE_MS + CONFIRM_SECOND_AFTER_FIRST_MS)
  })

  it('sends each a fresh link of their own, newest signup first, and never twice', async () => {
    const run = await runConfirmEmailReminder({}, deps)
    expect(run).toMatchObject({ sent: 2, due: { first: 2, second: 0 }, failed: 0 })
    const calls = vi.mocked(deps.send).mock.calls.map((c) => c[0])
    expect(calls.map((c) => c.to)).toEqual(['one@gmail.com', 'two@gmail.com'])
    expect(calls[0]!.subject).toBe("Confirm your email and you're in")
    expect(calls[0]!.html).toContain('token=fresh-u1')
    expect(calls[0]!.html).not.toContain('token=fresh-u2')
    expect(calls[1]!.html).toContain('token=fresh-u2')
    expect(calls[0]!.html).toContain('https://allfantasy.ai/unsub?e=one@gmail.com')

    const again = await runConfirmEmailReminder({}, deps)
    expect(again).toMatchObject({ sent: 0, skipped: { alreadyClaimed: 2 } })
    expect(deps.send).toHaveBeenCalledTimes(2)
    // A reminder that is not sent mints no link.
    expect(issued).toEqual(['u1', 'u2'])
  })

  it('claims before it mints a link or sends', async () => {
    const order: string[] = []
    deps.claim = vi.fn(async () => {
      order.push('claim')
      return true
    })
    const issue = deps.issueLink
    deps.issueLink = vi.fn(async (userId: string, now: Date) => {
      order.push('link')
      return issue(userId, now)
    })
    deps.send = vi.fn(async () => {
      order.push('send')
      return { ok: true }
    })
    deps.loadCandidates = vi.fn(async () => [cand('u1', 'one@gmail.com', 3)])
    await runConfirmEmailReminder({}, deps)
    expect(order).toEqual(['claim', 'link', 'send'])
    expect(deps.claim).toHaveBeenCalledWith('confirm-email-reminder:v1:u1:1', NOW)
  })

  it('sends the second only four days after the first', async () => {
    deps.loadSent = vi.fn(async () => new Map([
      ['u1', { 1: ago(5 * DAY) }],
      ['u2', { 1: ago(2 * DAY) }],
    ]))
    const run = await runConfirmEmailReminder({}, deps)
    expect(run).toMatchObject({ sent: 1, due: { first: 0, second: 1 }, skipped: { notDue: 1 } })
    expect(vi.mocked(deps.send).mock.calls[0]![0]).toMatchObject({ to: 'one@gmail.com', subject: 'Your AllFantasy account is still waiting' })
    expect(deps.claim).toHaveBeenCalledWith('confirm-email-reminder:v1:u1:2', NOW)
  })

  it('skips placeholder and test addresses and anyone who unsubscribed', async () => {
    deps.loadCandidates = vi.fn(async () => [
      cand('u1', 'One@Gmail.com', 3),
      cand('u2', '99@sleeper.allfantasy.ai', 3),
      cand('u3', 'three@gmail.com', 3),
      cand('u4', 'x@example.com', 3),
    ])
    deps.loadOptedOut = vi.fn(async () => new Set(['one@gmail.com']))
    const run = await runConfirmEmailReminder({}, deps)
    expect(run).toMatchObject({ candidates: 4, sent: 1, skipped: { ineligibleEmail: 2, optedOut: 1 } })
    expect(vi.mocked(deps.send).mock.calls[0]![0].to).toBe('three@gmail.com')
    expect(issued).toEqual(['u3'])
  })

  it('a dry run counts who is due and claims, mints and sends nothing', async () => {
    const run = await runConfirmEmailReminder({ dryRun: true }, deps)
    expect(run).toMatchObject({ dryRun: true, sent: 0, due: { first: 2 } })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.issueLink).not.toHaveBeenCalled()
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('stops at its cap and says how many it did not reach', async () => {
    const run = await runConfirmEmailReminder({ limit: 1 }, deps)
    expect(run).toMatchObject({ sent: 1, notReached: 1 })
    const none = await runConfirmEmailReminder({ budgetMs: 0 }, { ...deps, claim: vi.fn(async () => true) })
    expect(none).toMatchObject({ sent: 0, notReached: 2 })
  })

  it('a link whose email did not go out is deleted — rejected or thrown', async () => {
    deps.send = vi.fn(async ({ to }: { to: string }) => {
      if (to === 'two@gmail.com') return { ok: false, error: 'bounced' }
      throw new Error('network down')
    })
    const run = await runConfirmEmailReminder({}, deps)
    expect(run).toMatchObject({ sent: 0, failed: 2 })
    expect(discarded.sort()).toEqual(['u1', 'u2'])
    // Reported by user, never by address.
    expect(run.errors.sort()).toEqual(['u1: network down', 'u2: bounced'])
    expect(JSON.stringify(run)).not.toContain('@gmail.com')
  })

  it('a delivered link is kept', async () => {
    await runConfirmEmailReminder({}, deps)
    expect(discarded).toEqual([])
  })
})
