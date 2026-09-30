import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * Inside the iOS app, running out of Chimmy answers offers nothing to buy (App Store 3.1.1).
 *
 * The app sells no plan and no tokens, and its CSS already hid the "Get AF Pro" / "Buy tokens"
 * links — but the card's BODY still said "AF Pro includes 100 Chimmy answers a day, or buy tokens
 * to keep going now", and the legacy right rail printed "Upgrade or buy tokens for more". The
 * review notes send the reviewer to Chimmy, and a free account meets this after two questions.
 */

const inApp = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/platform/iosApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/iosApp')>()),
  isInIosAppClient: () => inApp.value,
}))
const consent = vi.hoisted(() => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('@/lib/tokens/client-confirm', () => consent)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import { describeOutOfAnswers, inIosAppAccessLine } from '@/lib/chimmy/outOfAnswers'

const SELLS = /\b(AF Pro includes|buy|upgrade|purchase|top up)\b/i
const PLAN = { included: false, planName: 'AF Pro', used: 100, limit: 100, resetsAt: '2026-09-25T00:00:00.000Z' }

describe('describeOutOfAnswers in the iOS app', () => {
  it('free account: says when the answers come back, offers nothing to buy', () => {
    const c = describeOutOfAnswers(null, { inIosApp: true })
    expect(c.title).toBe('You are out of Chimmy answers')
    expect(c.body).toBe('This answer was not bought. Your 2 free questions come back at midnight UTC.')
    expect(c.body).not.toMatch(SELLS)
    expect(c.actions).toEqual([])
  })

  it('plan holder: says when the plan refills, offers nothing to buy', () => {
    const c = describeOutOfAnswers(PLAN as never, { inIosApp: true })
    expect(c.title).toBe("Today's 100 AF Pro answers are used")
    expect(c.body).toBe('This answer was not bought. Your AF Pro answers refill at midnight UTC.')
    expect(c.body).not.toMatch(SELLS)
    expect(c.actions).toEqual([])
  })

  it('the website is unchanged (control)', () => {
    const free = describeOutOfAnswers(null)
    expect(free.body).toMatch(SELLS)
    expect(free.actions.map((a) => a.label)).toEqual(['Get AF Pro', 'Buy tokens'])
    expect(describeOutOfAnswers(PLAN as never).actions.map((a) => a.label)).toEqual(['Buy tokens'])
  })
})

describe('the Chimmy drawer in the iOS app', () => {
  beforeEach(() => {
    inApp.value = true
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    consent.confirmTokenSpend.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url) === '/api/chat/chimmy'
          ? { ok: false, status: 402, json: async () => ({ code: 'insufficient_token_balance', planAllowance: null }) }
          : { ok: true, status: 200, json: async () => ({}) },
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  function openAndAsk(text: string) {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[{ id: 'l0', name: 'KBFL', platform: 'sleeper' }] as never}
        pageLeagueId={null}
        chimmyTokenCost={10}
        chimmyPlanAllowance={null}
        initialTab="chimmy"
        userId="u1"
      />,
    )
    const box = screen.getByLabelText('Message') as HTMLInputElement
    fireEvent.change(box, { target: { value: text } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    return box
  }

  it('shows the refill time, no purchase links, and still hands the question back', async () => {
    const box = openAndAsk('Who should I start at flex?')
    expect(await screen.findByText('You are out of Chimmy answers')).toBeTruthy()
    expect(screen.getByText(/Your 2 free questions come back at midnight UTC/)).toBeTruthy()
    expect(screen.queryByText(/AF Pro includes/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Get AF Pro' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Buy tokens' })).toBeNull()
    expect(box.value).toBe('Who should I start at flex?')
  })

  it('outside the app the same refusal still offers both (control)', async () => {
    inApp.value = false
    openAndAsk('Who should I start at flex?')
    expect(await screen.findByRole('link', { name: 'Get AF Pro' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Buy tokens' })).toBeTruthy()
  })
})

describe('the AI-access line in the legacy right rail', () => {
  it('in the app: what the account has, never a purchase', () => {
    expect(inIosAppAccessLine({ hasSubscription: true, tokenBalance: 0 })).toBe('Premium AI active.')
    expect(inIosAppAccessLine({ hasSubscription: false, tokenBalance: 1 })).toBe('1 AI token available.')
    expect(inIosAppAccessLine({ hasSubscription: false, tokenBalance: 30 })).toBe('30 AI tokens available.')
    expect(inIosAppAccessLine({ hasSubscription: false, tokenBalance: 0 })).toBe('2 free Chimmy questions a day.')
  })

  it("the rail hides the resolver's message in the app and shows the app line instead", () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/navigation/SharedRightRail.tsx'), 'utf8')
    expect(src).toMatch(/<div data-hide-in-ios-app>\{aiAccess\.data\.message\}<\/div>/)
    expect(src).toMatch(/<div data-only-in-ios-app>\{inIosAppAccessLine\(aiAccess\.data\)\}<\/div>/)
    // …and the attribute pair is real CSS, not a convention nobody implemented.
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/html\[data-ios-app\] \[data-hide-in-ios-app\]/)
    expect(css).toMatch(/html:not\(\[data-ios-app\]\) \[data-only-in-ios-app\]/)
  })
})
