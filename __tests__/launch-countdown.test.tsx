import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'

/*
 * The launch countdown and every surface that carries it (components/launch/*):
 *  - hydration-safe: the server and the browser's first render print the same static text;
 *  - ticks each second after mount, and renders NOTHING once the paywall has started;
 *  - accessible: a role="timer" that is never announced, digits hidden from screen readers;
 *  - the banner / strips say "Chimmy", never bare "AI", and name no discount figure of their own.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/pricing',
  redirect: vi.fn(),
}))
vi.mock('@/lib/monetization/checkout-client', () => ({
  resolveCheckoutUrl: vi.fn(async () => ({ ok: false as const, error: 'stopped in test' })),
}))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))

import { LaunchCountdown } from '@/components/launch/LaunchCountdown'
import { LaunchBanner } from '@/components/launch/LaunchBanner'
import { LaunchOfferStrip } from '@/components/launch/LaunchOfferStrip'
import { LaunchOfferProvider } from '@/components/launch/LaunchOfferContext'
import { landingBannerCopy, offerStripCopy } from '@/components/launch/launchCopy'
import { describeRemaining, formatLaunchDay, splitRemaining } from '@/components/launch/launchTime'
import { homeLaunchOfferFor } from '@/components/launch/homeLaunchOffer'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import { PricingV4 } from '@/components/core-app/screens/PricingV4'
import MonetizationPurchaseSurface from '@/components/monetization/MonetizationPurchaseSurface'
import { DEFAULT_PAYWALL_STARTS_AT } from '@/lib/monetization/paywallLaunch'
import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import type { LaunchOfferView } from '@/lib/monetization/foundingMember'

const LAUNCH = DEFAULT_PAYWALL_STARTS_AT.toISOString()
const LAUNCH_MS = DEFAULT_PAYWALL_STARTS_AT.getTime()
/** 1 day, 2 hours, 3 minutes and 4 seconds before launch. */
const BEFORE = LAUNCH_MS - ((((1 * 24 + 2) * 60 + 3) * 60 + 4) * 1000)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BEFORE)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function digits(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('.af-lc-num'))
    .map((n) => n.textContent)
    .join(':')
}

describe('launch time helpers', () => {
  it('splits the remaining time and stops at zero', () => {
    expect(splitRemaining(LAUNCH_MS - BEFORE)).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 4 })
    expect(splitRemaining(0)).toBeNull()
    expect(splitRemaining(-5)).toBeNull()
    expect(splitRemaining(Number.NaN)).toBeNull()
  })

  it('names the launch day in US Eastern, the same on server and browser', () => {
    // 04:00Z on Oct 15 is midnight Eastern — a UTC-evening reader must still see Oct 15, not Oct 14.
    expect(formatLaunchDay(LAUNCH, 'en')).toBe('Oct 15')
    expect(formatLaunchDay(LAUNCH, 'es')).toBe('15 de octubre')
  })

  it('speaks the remaining time at minute granularity', () => {
    expect(describeRemaining({ days: 1, hours: 2, minutes: 3, seconds: 4 })).toBe('1 day, 2 hours and 3 minutes')
    expect(describeRemaining({ days: 0, hours: 0, minutes: 1, seconds: 59 })).toBe('1 minute')
    expect(describeRemaining({ days: 3, hours: 1, minutes: 0, seconds: 0 }, 'es')).toBe('3 días, 1 hora y 0 minutos')
  })
})

describe('<LaunchCountdown>', () => {
  it('server-renders static text, not a clock reading', () => {
    const html = renderToString(<LaunchCountdown startsAt={LAUNCH} />)
    expect(html).toContain('Free until Oct 15')
    expect(html).toContain('data-state="static"')
    expect(html).not.toContain('af-lc-num')
  })

  it('hydrates without a mismatch even when the browser clock has moved on, then starts ticking', async () => {
    const html = renderToString(<LaunchCountdown startsAt={LAUNCH} />)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    vi.setSystemTime(BEFORE + 17_000)

    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(String(args[0]))
    })
    await act(async () => {
      hydrateRoot(container, <LaunchCountdown startsAt={LAUNCH} />)
    })
    spy.mockRestore()

    expect(errors.filter((e) => /hydrat|did not match|mismatch/i.test(e))).toEqual([])
    // After mount the clock took over: 1d 02h 02m 47s.
    expect(digits(container)).toBe('01:02:02:47')
    document.body.removeChild(container)
  })

  it('ticks every second', () => {
    const { container } = render(<LaunchCountdown startsAt={LAUNCH} />)
    expect(digits(container)).toBe('01:02:03:04')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(digits(container)).toBe('01:02:03:03')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(digits(container)).toBe('01:02:02:58')
  })

  it('renders nothing after launch', () => {
    vi.setSystemTime(LAUNCH_MS + 1)
    const { container } = render(<LaunchCountdown startsAt={LAUNCH} />)
    expect(container.innerHTML).toBe('')
  })

  it('disappears on its own when the clock runs out while the page is open', () => {
    vi.setSystemTime(LAUNCH_MS - 2000)
    const { container } = render(<LaunchCountdown startsAt={LAUNCH} />)
    expect(digits(container)).toBe('00:00:00:02')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for an unparseable instant rather than a nonsense clock', () => {
    const { container } = render(<LaunchCountdown startsAt="not a date" />)
    expect(container.innerHTML).toBe('')
  })

  it('is a silent timer: role=timer, aria-live=off, digits hidden, a label that does not change every second', () => {
    render(<LaunchCountdown startsAt={LAUNCH} />)
    const timer = screen.getByRole('timer')
    expect(timer.getAttribute('aria-live')).toBe('off')
    expect(timer.querySelector('.af-lc-segs')?.getAttribute('aria-hidden')).toBe('true')
    const label = timer.getAttribute('aria-label')
    expect(label).toBe('Free until Oct 15 — 1 day, 2 hours and 3 minutes left')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('timer').getAttribute('aria-label')).toBe(label)
  })
})

describe('landing banner', () => {
  const founding = { audience: 'prospect' as const, label: null }

  it('asks a signed-out visitor to sign up while it is free, with founding pricing when it is on', () => {
    render(<LaunchBanner startsAt={LAUNCH} lang="en" signedIn={false} founding={founding} />)
    expect(screen.getByRole('heading', { name: "Everything's free until Oct 15." })).toBeTruthy()
    expect(screen.getByText('Sign up now and lock in founding-member pricing.')).toBeTruthy()
    const cta = screen.getByTestId('launch-banner-cta')
    expect(cta.getAttribute('href')).toBe('/signup')
    expect(cta.textContent).toBe('Sign up free')
    expect(screen.getByRole('timer')).toBeTruthy()
  })

  it('makes no founding promise when founding pricing is switched off', () => {
    const copy = landingBannerCopy({ startsAt: LAUNCH, lang: 'en', signedIn: false, founding: null })
    expect(copy.body).not.toMatch(/founding/i)
    expect(copy.cta.href).toBe('/signup')
  })

  it('quotes the owner label verbatim and never invents a figure', () => {
    const withLabel = landingBannerCopy({
      startsAt: LAUNCH,
      lang: 'en',
      signedIn: false,
      founding: { audience: 'prospect', label: '50% off AF Pro for life' },
    })
    expect(withLabel.body).toBe('Sign up now and lock in founding-member pricing: 50% off AF Pro for life.')
    const without = landingBannerCopy({ startsAt: LAUNCH, lang: 'en', signedIn: false, founding })
    expect(without.body).not.toMatch(/\d+\s*%|\$\d/)
  })

  it('tells a signed-in visitor they are a founding member instead of asking them to sign up again', () => {
    const copy = landingBannerCopy({ startsAt: LAUNCH, lang: 'en', signedIn: true, founding: { audience: 'member', label: null } })
    expect(copy.cta.href).not.toBe('/signup')
    expect(copy.body).toMatch(/founding member/)
  })

  it('speaks Spanish on the Spanish page', () => {
    render(<LaunchBanner startsAt={LAUNCH} lang="es" signedIn={false} founding={founding} />)
    expect(screen.getByRole('heading', { name: 'Todo es gratis hasta el 15 de octubre.' })).toBeTruthy()
    expect(screen.getByTestId('launch-banner-cta').textContent).toBe('Regístrate gratis')
  })

  it('renders nothing after launch', () => {
    vi.setSystemTime(LAUNCH_MS + 1000)
    const { container } = render(<LaunchBanner startsAt={LAUNCH} lang="en" signedIn={false} founding={founding} />)
    expect(container.innerHTML).toBe('')
  })

  it('LandingV4 shows it only when the page hands it launch data', () => {
    const without = renderToString(<LandingV4 lang="en" signedIn={false} />)
    expect(without).not.toContain('launch-banner')
    const withBanner = renderToString(
      <LandingV4 lang="en" signedIn={false} launch={{ startsAt: LAUNCH, founding: null }} />
    )
    expect(withBanner).toContain('data-testid="launch-banner"')
    expect(withBanner).toContain('Everything&#x27;s free until Oct 15.')
    // The static server text, before any clock is read.
    expect(withBanner).toContain('Paid plans start Oct 15')
    // Above the hero, which is the point.
    expect(withBanner.indexOf('launch-banner')).toBeLessThan(withBanner.indexOf('landing-hero-headline'))
  })
})

describe('offer strip', () => {
  const prelaunch = (founding: LaunchOfferView['founding']): LaunchOfferView => ({ startsAt: LAUNCH, prelaunch: true, founding })

  it('shows the countdown and the founding line to a founding member before launch', () => {
    render(<LaunchOfferStrip offer={prelaunch({ audience: 'member', label: null })} surface="pricing" />)
    expect(screen.getByText("Everything's free until Oct 15")).toBeTruthy()
    expect(screen.getByRole('timer')).toBeTruthy()
    expect(screen.getByTestId('launch-founding-member').textContent).toMatch(/applied automatically at checkout/)
  })

  it('after launch keeps the founding line for a founding member, and drops the countdown', () => {
    vi.setSystemTime(LAUNCH_MS + 60_000)
    render(<LaunchOfferStrip offer={{ startsAt: LAUNCH, prelaunch: false, founding: { audience: 'member', label: null } }} surface="pricing" />)
    expect(screen.queryByRole('timer')).toBeNull()
    expect(screen.queryByText(/Everything's free/)).toBeNull()
    expect(screen.getByTestId('launch-founding-member')).toBeTruthy()
  })

  it('after launch with no founding offer renders nothing at all', () => {
    vi.setSystemTime(LAUNCH_MS + 60_000)
    const { container } = render(
      <LaunchOfferStrip offer={{ startsAt: LAUNCH, prelaunch: false, founding: null }} surface="pricing" />
    )
    expect(container.innerHTML).toBe('')
  })

  it('hides the countdown when the browser clock says launch has passed, even if the server said otherwise', () => {
    vi.setSystemTime(LAUNCH_MS + 60_000)
    const { container } = render(<LaunchOfferStrip offer={prelaunch(null)} surface="pricing" />)
    expect(container.innerHTML).toBe('')
  })

  it('on /upgrade warns a founding member that a promo code would replace the founding discount', () => {
    const copy = offerStripCopy({ startsAt: LAUNCH, surface: 'upgrade', founding: { audience: 'member', label: null } })
    expect(copy.founding).toMatch(/promo code would replace it/)
  })

  it('invites a signed-out visitor to sign up for founding pricing, with a link', () => {
    render(<LaunchOfferStrip offer={prelaunch({ audience: 'prospect', label: null })} surface="pricing" />)
    expect(screen.getByText(/Sign up before Oct 15 and lock in founding-member pricing\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create a free account' }).getAttribute('href')).toBe('/signup')
  })

  it('the /core card points at AF Pro', () => {
    render(<LaunchOfferStrip offer={prelaunch(null)} surface="core" />)
    expect(screen.getByRole('link', { name: 'See AF Pro' }).getAttribute('href')).toBe('/upgrade?plan=pro')
  })
})

describe('/core home: only viewers without a plan, only before launch', () => {
  const before = new Date(BEFORE)
  const after = new Date(LAUNCH_MS + 1)

  it('counts down for a viewer without a plan before launch', () => {
    expect(homeLaunchOfferFor({ hasPlan: false, now: before, env: {} })).toMatchObject({ startsAt: LAUNCH, prelaunch: true })
  })

  it('never for a plan holder', () => {
    expect(homeLaunchOfferFor({ hasPlan: true, now: before, env: {} })).toBeNull()
  })

  it('never after launch', () => {
    expect(homeLaunchOfferFor({ hasPlan: false, now: after, env: {} })).toBeNull()
  })

  it('never when the plan read failed', () => {
    expect(homeLaunchOfferFor({ hasPlan: null, now: before, env: {} })).toBeNull()
  })

  it('carries the founding line only when the coupon is configured', () => {
    expect(homeLaunchOfferFor({ hasPlan: false, now: before, env: {} })?.founding).toBeNull()
    expect(
      homeLaunchOfferFor({ hasPlan: false, now: before, env: { STRIPE_FOUNDING_COUPON_ID: 'c1', FOUNDING_OFFER_LABEL: 'Half off' } })?.founding
    ).toEqual({ audience: 'member', label: 'Half off' })
  })
})

describe('pricing surfaces read the offer from their layout', () => {
  const offer: LaunchOfferView = { startsAt: LAUNCH, prelaunch: true, founding: { audience: 'member', label: null } }

  it('/pricing: the strip sits above the plans when the layout provides an offer, and is absent without one', () => {
    const props = { plans: [], packs: [], savingsHeadline: null }
    const { unmount } = render(<PricingV4 {...props} />)
    expect(screen.queryByTestId('launch-strip-pricing')).toBeNull()
    unmount()

    const { container } = render(
      <LaunchOfferProvider offer={offer}>
        <PricingV4 {...props} />
      </LaunchOfferProvider>
    )
    const strip = screen.getByTestId('launch-strip-pricing')
    const grid = container.querySelector('.af-pr-grid')!
    expect(strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('/upgrade: a founding member sees the strip and is not nudged toward the sponsor code', async () => {
    const subs = getMonetizationCatalog().subscriptions.map((s) => ({ ...s, stripePriceConfigured: true }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            catalog: { subscriptions: subs, tokenPacks: [], all: subs },
            fancredBoundary: { version: 't', short: '', long: '', checklist: [] },
          }),
          { status: 200 }
        )
      )
    )
    render(
      <LaunchOfferProvider offer={offer}>
        <MonetizationPurchaseSurface pagePath="/upgrade" title="t" subtitle="s" />
      </LaunchOfferProvider>
    )
    expect(screen.getByTestId('launch-strip-upgrade')).toBeTruthy()
    expect(screen.queryByText(/for 20% off your first subscription/)).toBeNull()
  })

  it('/upgrade: everyone else still sees the sponsor-code hint', () => {
    render(<MonetizationPurchaseSurface pagePath="/upgrade" title="t" subtitle="s" />)
    expect(screen.getByText(/for 20% off your first subscription/)).toBeTruthy()
  })
})

describe('launch copy voice', () => {
  const surfaces = ['pricing', 'upgrade', 'signup', 'core'] as const
  const foundings = [null, { audience: 'member' as const, label: null }, { audience: 'prospect' as const, label: null }]
  const all: string[] = []
  for (const surface of surfaces) {
    for (const founding of foundings) {
      const c = offerStripCopy({ startsAt: LAUNCH, surface, founding })
      all.push(c.title, c.body ?? '', c.founding ?? '', c.cta?.label ?? '', c.foundingLink?.label ?? '')
    }
  }
  for (const lang of ['en', 'es'] as const) {
    for (const signedIn of [true, false]) {
      for (const founding of foundings) {
        const c = landingBannerCopy({ startsAt: LAUNCH, lang, signedIn, founding })
        all.push(c.kicker, c.title, c.body, c.cta.label)
      }
    }
  }

  it('says Chimmy, never bare "AI", and avoids the banned words', () => {
    const text = all.join(' | ')
    expect(text.length).toBeGreaterThan(200)
    expect(text).not.toMatch(/\bAI\b/)
    expect(text).not.toMatch(/leverage|synergy|disrupt|revolutionary|game-changing/i)
  })
})
