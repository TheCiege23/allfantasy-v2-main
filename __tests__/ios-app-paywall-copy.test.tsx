// @vitest-environment jsdom
/**
 * An iOS app build WITHOUT the StoreKit bridge sells nothing (App Store 3.1.1), and pointing at a
 * purchase made elsewhere is steering (3.1.3). So on the /core depth paywall, everything that NAMES
 * the plan or invites an upgrade is marked data-ios-purchase (hidden in that build), and that build
 * is left with something true to read (data-ios-purchase-alt) — not a hole.
 *
 * A build WITH the bridge (html[data-ios-iap]) sells the plan through Apple, so it shows the web
 * wording and the button, and never the alt line.
 *
 * jsdom does not apply globals.css, so this pins the MARKUP and, separately, that the stylesheet
 * rules exist. The launch card itself (LaunchOfferStrip) stays hidden in every app build.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

afterEach(cleanup)

const access = (over: Partial<CoreDepthAccess> = {}): CoreDepthAccess => ({
  depth: 'player' as CoreDepthAccess['depth'],
  unlocked: false,
  hasPlan: false,
  preLaunchFree: false,
  startsAt: '2026-10-15T04:00:00.000Z',
  planName: 'AF Pro' as CoreDepthAccess['planName'],
  label: 'Recommended moves',
  upgradePath: '/upgrade?plan=pro',
  ...over,
})

/** What globals.css hides in each place. */
const HIDDEN = {
  web: '[data-only-in-ios-app], [data-ios-purchase-alt]',
  appWithoutIap: '[data-hide-in-ios-app], [data-ios-purchase]',
  appWithIap: '[data-hide-in-ios-app], [data-ios-purchase-alt]',
} as const

function visible(root: HTMLElement, where: keyof typeof HIDDEN): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll(HIDDEN[where]).forEach((n) => n.remove())
  return clone
}
const visibleText = (root: HTMLElement, where: keyof typeof HIDDEN) => visible(root, where).textContent ?? ''
const visibleCta = (root: HTMLElement, where: keyof typeof HIDDEN) =>
  visible(root, where).querySelector('a.af-core-lock-cta')

describe('the /core depth lock', () => {
  it('an app build without IAP shows nothing that names the plan or invites an upgrade', () => {
    const { container } = render(<CoreDepthLock access={access()} />)
    const app = visibleText(container, 'appWithoutIap')
    expect(app).not.toMatch(/AF Pro|upgrade/i)
    expect(app).toContain('Recommended moves are not included with your account')
    // The button is marked too, not merely caught by the /upgrade link rule.
    expect(visibleCta(container, 'appWithoutIap')).toBeNull()
  })

  it('an IAP build keeps the plan name, the call to action and the button — and no alt line', () => {
    const { container } = render(<CoreDepthLock access={access()} />)
    const app = visibleText(container, 'appWithIap')
    expect(app).toContain('Recommended moves are part of AF Pro')
    expect(app).toContain('Upgrade to see the rest.')
    expect(app).not.toContain('not included with your account')
    expect(visibleCta(container, 'appWithIap')?.textContent).toBe('See AF Pro')
  })

  it('control: the website keeps its plan name, its call to action and the button', () => {
    const { container } = render(<CoreDepthLock access={access()} />)
    const web = visibleText(container, 'web')
    expect(web).toContain('Recommended moves are part of AF Pro')
    expect(web).toContain('Upgrade to see the rest.')
    expect(web).not.toContain('not included with your account')
    expect(visibleCta(container, 'web')?.textContent).toBe('See AF Pro')
  })

  it('the "Free until Oct 15 — then AF Pro" note is hidden only in an app build without IAP', () => {
    const { container } = render(<FreeUntilNote access={access({ unlocked: true, preLaunchFree: true })} />)
    expect(container.querySelector('.af-core-free-until')?.textContent).toMatch(/then AF Pro/)
    expect(visibleText(container, 'appWithoutIap')).toBe('')
    expect(visibleText(container, 'appWithIap')).toMatch(/then AF Pro/)
  })

  it('the stylesheet implements those three views', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/html\[data-ios-app\] \[data-hide-in-ios-app\][\s\S]{0,1200}display:\s*none !important/)
    expect(css).toMatch(/html\[data-ios-app\]:not\(\[data-ios-iap\]\) \[data-ios-purchase\],/)
    expect(css).toMatch(/html:not\(\[data-ios-app\]\) \[data-only-in-ios-app\]\s*\{\s*display:\s*none !important;/)
    expect(css).toMatch(
      /html:not\(\[data-ios-app\]\) \[data-ios-purchase-alt\],\s*html\[data-ios-iap\] \[data-ios-purchase-alt\]\s*\{\s*display:\s*none !important;/,
    )
  })
})
