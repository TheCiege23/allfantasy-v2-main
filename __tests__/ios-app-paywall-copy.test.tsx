// @vitest-environment jsdom
/**
 * Inside the iOS app nothing is sold (App Store 3.1.1), and pointing at a purchase made
 * elsewhere is steering (3.1.3). So on the /core depth paywall, everything that NAMES the
 * plan or invites an upgrade must be web-only (data-hide-in-ios-app), and the app must be
 * left with something true to read (data-only-in-ios-app) — not a hole.
 *
 * jsdom does not apply globals.css, so this pins the MARKUP and, separately, that the two
 * stylesheet rules exist. The launch card itself (LaunchOfferStrip) is already marked.
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

/** The text a person in the app would see: everything NOT inside a web-only block. */
function appVisibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-hide-in-ios-app]').forEach((n) => n.remove())
  return clone.textContent ?? ''
}
/** The text the website shows: everything NOT inside an app-only block. */
function webVisibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-only-in-ios-app]').forEach((n) => n.remove())
  return clone.textContent ?? ''
}

describe('the /core depth lock inside the iOS app', () => {
  it('shows the app nothing that names the plan or invites an upgrade', () => {
    const { container } = render(<CoreDepthLock access={access()} />)
    const app = appVisibleText(container)
    expect(app).not.toMatch(/AF Pro|upgrade/i)
    expect(app).toContain('Recommended moves are not included with your account')
    // The button is web-only too, not merely caught by the /upgrade link rule.
    expect(container.querySelector('a.af-core-lock-cta')?.hasAttribute('data-hide-in-ios-app')).toBe(true)
  })

  it('control: the website keeps its plan name, its call to action and the button', () => {
    const { container } = render(<CoreDepthLock access={access()} />)
    const web = webVisibleText(container)
    expect(web).toContain('Recommended moves are part of AF Pro')
    expect(web).toContain('Upgrade to see the rest.')
    expect(web).not.toContain('not included with your account')
    expect(container.querySelector('a.af-core-lock-cta')?.textContent).toBe('See AF Pro')
  })

  it('the "Free until Oct 15 — then AF Pro" note is web-only', () => {
    const { container } = render(<FreeUntilNote access={access({ unlocked: true, preLaunchFree: true })} />)
    const note = container.querySelector('.af-core-free-until')
    expect(note?.textContent).toMatch(/then AF Pro/)
    expect(note?.hasAttribute('data-hide-in-ios-app')).toBe(true)
    expect(appVisibleText(container)).toBe('')
  })

  it('the stylesheet hides web-only copy in the app and app-only copy on the web', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/html\[data-ios-app\] \[data-hide-in-ios-app\][\s\S]{0,900}display:\s*none !important/)
    expect(css).toMatch(/html:not\(\[data-ios-app\]\) \[data-only-in-ios-app\]\s*\{\s*display:\s*none !important;/)
  })
})
