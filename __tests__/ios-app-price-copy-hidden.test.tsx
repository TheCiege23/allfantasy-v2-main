// @vitest-environment jsdom
/**
 * App Store 3.1.1: nothing is sold inside the iOS app, so a price, a checkout or a founding-pricing
 * promise must not be visible there. Purchase PAGES are redirected by middleware and purchase LINKS
 * are hidden by `html[data-ios-app] a[href^='/upgrade']` and friends (app/globals.css) — but COPY
 * outside a purchase page is neither. Measured in the app on 2026-09-29: the landing page said
 * "Paid plans run $9.99–$19.99/mo", and /war-room said "$9.99 / month or $79.99 a year" above
 * "Checkout is handled securely by Stripe." with only the button hidden.
 *
 * The rule is held by SHAPE, not by a list of strings: every rendered text node that quotes a
 * dollar figure, names Stripe, or promises founding pricing must sit inside an element marked
 * `data-hide-in-ios-app`. A new price line anywhere in these surfaces fails here without anyone
 * having to remember it. Each surface also asserts it renders at least one such text, so the check
 * cannot pass by rendering nothing.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import { LaunchBanner } from '@/components/launch/LaunchBanner'
import { LaunchOfferStrip } from '@/components/launch/LaunchOfferStrip'
import WarRoomPage from '@/app/war-room/page'

const PURCHASE_COPY = /\$\s?\d|\bstripe\b|founding[- ]member pricing|checkout/i

/** Text nodes that read as a purchase prompt, and whether each is inside a hidden-in-app element. */
function purchaseCopy(html: string): { text: string; hidden: boolean }[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: { text: string; hidden: boolean }[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const parent = node.parentElement
    if (!parent || /^(SCRIPT|STYLE)$/.test(parent.tagName)) continue
    // The whole element's text, so "$9.99" split across nodes from "/ month" still reads as a price.
    const text = (parent.textContent ?? '').trim()
    if (!PURCHASE_COPY.test(node.textContent ?? '') && !PURCHASE_COPY.test(text)) continue
    out.push({ text: text.slice(0, 120), hidden: parent.closest('[data-hide-in-ios-app]') !== null })
  }
  return out
}

const STARTS_AT = new Date(Date.now() + 14 * 86_400_000).toISOString()
const FOUNDING_PROSPECT = { audience: 'prospect' as const, label: '20% off your first year' }

describe('iOS app: no purchase copy outside a data-hide-in-ios-app block', () => {
  it('landing page (EN, signed out, launch banner with a founding offer)', () => {
    const copy = purchaseCopy(
      renderToStaticMarkup(<LandingV4 lang="en" launch={{ startsAt: STARTS_AT, founding: FOUNDING_PROSPECT }} />),
    )
    // Positive control: the page really does quote prices and the founding offer.
    expect(copy.some((c) => /\$\d/.test(c.text))).toBe(true)
    expect(copy.some((c) => /founding/i.test(c.text))).toBe(true)
    expect(copy.filter((c) => !c.hidden)).toEqual([])
  })

  it('landing page (ES)', () => {
    const copy = purchaseCopy(renderToStaticMarkup(<LandingV4 lang="es" />))
    expect(copy.some((c) => /\$\d/.test(c.text))).toBe(true)
    expect(copy.filter((c) => !c.hidden)).toEqual([])
  })

  it('/war-room hero price and plan block', () => {
    const copy = purchaseCopy(renderToStaticMarkup(<WarRoomPage />))
    expect(copy.some((c) => /\$\d/.test(c.text))).toBe(true)
    expect(copy.some((c) => /stripe/i.test(c.text))).toBe(true)
    expect(copy.filter((c) => !c.hidden)).toEqual([])
  })

  it('the launch banner and every offer-strip surface are hidden whole', () => {
    const banner = renderToStaticMarkup(
      <LaunchBanner startsAt={STARTS_AT} lang="en" signedIn={false} founding={FOUNDING_PROSPECT} />,
    )
    expect(banner).toContain('data-testid="launch-banner"')
    expect(new DOMParser().parseFromString(banner, 'text/html').querySelector('[data-testid="launch-banner"]')?.hasAttribute('data-hide-in-ios-app')).toBe(true)

    for (const surface of ['signup', 'core', 'pricing', 'upgrade'] as const) {
      const html = renderToStaticMarkup(
        <LaunchOfferStrip
          offer={{ startsAt: STARTS_AT, prelaunch: true, founding: FOUNDING_PROSPECT }}
          surface={surface}
        />,
      )
      const root = new DOMParser().parseFromString(html, 'text/html').querySelector(`[data-testid="launch-strip-${surface}"]`)
      expect(root, surface).not.toBeNull()
      expect(root?.hasAttribute('data-hide-in-ios-app'), surface).toBe(true)
    }
  })

  it('the FAQ keeps its three non-price answers in the app, and the schema keeps all four', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<LandingV4 lang="en" />), 'text/html')
    const items = [...doc.querySelectorAll('.af-lp-faq-item')]
    expect(items).toHaveLength(4)
    expect(items.filter((el) => el.hasAttribute('data-hide-in-ios-app')).map((el) => el.querySelector('h3')?.textContent)).toEqual([
      'What does it cost?',
    ])
  })
})
