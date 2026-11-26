/**
 * The long-pick-clock deadline ("due 6:31 PM" beside the countdown) and the PickClockPlanner cards
 * read the clock and formatted it in the RUNTIME's time zone during render. The server (UTC) and the
 * browser (the viewer's zone) render seconds apart, so the text differed — measured on
 * /e2e/draft-room-fixture?clock=long: server "due 12:12 AM", browser "due 1:12 PM" — and React threw
 * the draft-room tree away. Before mount both now render from props alone (an invisible placeholder
 * holds each time's place); the mount effect fills in the viewer's local time.
 */
import React from 'react'
import { act, cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const value = () => {
    const t = (key: string) => dict.en[key] ?? key
    return { language: 'en', setLanguage: () => {}, t, tInterpolate: (key: string) => t(key) }
  }
  return { useLanguage: value, useOptionalLanguage: value }
})
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? '')} src={String(props.src ?? '')} />,
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => null }))

import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { PickClockPlanner, type PickClockPlannerProps } from '@/components/app/draft-room/PickClockPlanner'
import { clockTimePlaceholder, resolvePickDueTime } from '@/lib/draft-room/pickClockPlanning'

const T0 = Date.parse('2026-11-25T23:00:00.000Z')
const END_AT = new Date(T0 + (3 * 3600 + 5 * 60) * 1000).toISOString() // 3h05m left on a 4h clock
const ORIGINAL_TZ = process.env.TZ

const topBar = {
  leagueName: 'Sample League',
  sport: 'NFL',
  draftType: 'snake',
  teamCount: 10,
  rounds: 15,
  currentManagerOnClock: 'You',
  pickLabel: '2.04',
  overallPickNumber: 14,
  timerStatus: 'running' as const,
  timerRemainingSeconds: 3 * 3600 + 5 * 60,
  timerEndAtIso: END_AT,
  timerSeconds: 4 * 3600,
  isCommissioner: false,
  draftStatus: 'in_progress',
}

function planner(over: Partial<PickClockPlannerProps> = {}): PickClockPlannerProps {
  return {
    timerSeconds: 4 * 3600,
    timerEndAtIso: END_AT,
    isOnClock: false,
    picksAway: 5,
    nextLabel: '2.9',
    pickTimesMs: [],
    quietWindow: { start: '22:00', end: '08:00', timezone: 'America/New_York' },
    allowPicksDuringPause: false,
    pausedForQuietHours: false,
    queueTop: { name: 'North Star', position: 'QB' },
    ...over,
  }
}

/** Server render: UTC, at `T0 + offsetMs`. */
function serverHtml(node: React.ReactElement, offsetMs: number, tz = 'UTC'): string {
  process.env.TZ = tz
  vi.setSystemTime(T0 + offsetMs)
  return renderToString(node)
}

async function hydrateIn(tz: string, offsetMs: number, html: string, node: React.ReactElement) {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  process.env.TZ = tz
  vi.setSystemTime(T0 + offsetMs)
  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.map(String).join(' '))
  })
  const recoverable: string[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    await act(async () => {
      root = hydrateRoot(container, node, { onRecoverableError: (e) => recoverable.push(String(e)) })
    })
  } finally {
    spy.mockRestore()
  }
  return {
    container,
    recoverable,
    hydrationErrors: errors.filter((e) => /hydrat|did not match|mismatch|server rendered/i.test(e)),
    unmount: () => {
      act(() => root?.unmount())
      document.body.removeChild(container)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notificationPreferences: {} }), { status: 200 })))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('resolvePickDueTime', () => {
  const input = { timerStatus: 'running', timerSeconds: 4 * 3600, timerEndAtIso: END_AT, quietWindow: null, locale: 'en-US' }

  it('before mount reads neither the clock nor the time zone', () => {
    process.env.TZ = 'UTC'
    vi.setSystemTime(T0)
    const a = resolvePickDueTime({ ...input, nowMs: null })
    process.env.TZ = 'Pacific/Auckland'
    vi.setSystemTime(T0 + 7_000)
    const b = resolvePickDueTime({ ...input, nowMs: null })
    expect(a).toEqual({ time: null, placeholder: '12:00 AM' })
    expect(b).toEqual(a)
  })

  it('after mount gives the viewer’s local time — the control that the zone switch above is real', () => {
    process.env.TZ = 'UTC'
    const utc = resolvePickDueTime({ ...input, nowMs: T0 })
    process.env.TZ = 'Pacific/Auckland'
    const nz = resolvePickDueTime({ ...input, nowMs: T0 })
    expect(utc?.time).toBe('2:05 AM')
    expect(nz?.time).toBe('3:05 PM')
  })

  it('is null on a short clock, and the placeholder follows the locale', () => {
    expect(resolvePickDueTime({ ...input, timerSeconds: 90, nowMs: null })).toBeNull()
    expect(clockTimePlaceholder('es-US')).toMatch(/^12:00\s?a/)
  })
})

describe('DraftTopBar due label hydration', () => {
  it('server-renders the same placeholder whatever the clock or zone, and never a time', () => {
    const a = serverHtml(<DraftTopBar {...topBar} />, 0, 'UTC')
    const b = serverHtml(<DraftTopBar {...topBar} />, 9_000, 'Pacific/Auckland')
    expect(a).toBe(b)
    expect(a).toContain('data-testid="draft-topbar-timer-due-slot"')
    expect(a).not.toContain('data-testid="draft-topbar-timer-due"')
  })

  it('hydrates in another zone, seconds later, without a mismatch — then shows the local deadline', async () => {
    const html = serverHtml(<DraftTopBar {...topBar} />, 2_000, 'UTC')
    const h = await hydrateIn('Pacific/Auckland', 5_000, html, <DraftTopBar {...topBar} />)
    try {
      expect(h.recoverable).toEqual([])
      expect(h.hydrationErrors).toEqual([])
      // END_AT is 02:05 UTC = 3:05 PM in Auckland (NZDT).
      expect(h.container.querySelector('[data-testid="draft-topbar-timer-due"]')?.textContent).toBe('due 3:05 PM')
      // The placeholder stays in the same grid cell, invisible, so the pill keeps its width.
      const slot = h.container.querySelector('[data-testid="draft-topbar-timer-due-slot"]')!
      expect(slot.querySelector('[aria-hidden="true"]')?.textContent).toBe('due 12:00 AM')
    } finally {
      h.unmount()
    }
  })
})

describe('PickClockPlanner hydration', () => {
  for (const [label, over] of [
    ['on the clock', { isOnClock: true, picksAway: 0 }],
    ['five picks away', {}],
  ] as const) {
    it(`${label}: server render is independent of the clock and zone`, () => {
      const a = serverHtml(<PickClockPlanner {...planner(over)} />, 0, 'UTC')
      const b = serverHtml(<PickClockPlanner {...planner(over)} />, 3 * 3600_000, 'Pacific/Auckland')
      expect(a).toBe(b)
      expect(a).toContain('data-pending="true"')
    })

    it(`${label}: hydrates in another zone without a mismatch, then shows the real time`, async () => {
      const html = serverHtml(<PickClockPlanner {...planner(over)} />, 2_000, 'UTC')
      const h = await hydrateIn('America/Los_Angeles', 5_000, html, <PickClockPlanner {...planner(over)} />)
      try {
        expect(h.recoverable).toEqual([])
        expect(h.hydrationErrors).toEqual([])
        const headline = h.container.querySelector('[data-testid="pick-clock-next-headline"]')!
        expect(headline.getAttribute('data-pending')).toBeNull()
        expect(headline.textContent).not.toContain('12:00 AM')
        if ('isOnClock' in over) expect(headline.textContent).toContain('due 6:05 PM') // 02:05Z in LA (PST)
      } finally {
        h.unmount()
      }
    })
  }
})
