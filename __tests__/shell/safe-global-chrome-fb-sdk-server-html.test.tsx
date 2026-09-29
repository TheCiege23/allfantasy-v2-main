// @vitest-environment node
/**
 * The server cannot see the iOS app's User-Agent marker, so anything the server
 * renders for the Facebook SDK reaches the app too. It used to render the
 * <Script>, and in the app router `next/script` calls `ReactDOM.preload(src)`
 * DURING RENDER — that call is the `<link rel="preload" as="script">` which made
 * the app fetch connect.facebook.net/en_US/sdk.js on `/`, `/privacy` and `/terms`
 * (measured with scripts/probe-ios-app-trackers.cjs). The SDK now renders only
 * after mount, so a server render must never ask for it.
 *
 * ⚠ HOW THIS REPRODUCES THE SERVER, AND WHY A PLAIN renderToString DOES NOT.
 * `next/script` only takes the preload branch when its HeadManagerContext says
 * `appDir: true` — without that context the component renders nothing and a test
 * passes against the leaking code too (it did, on the first attempt). And
 * `next/script` is CommonJS that loads `react-dom` with Node's `require`, which
 * vi.mock cannot intercept, so the recorder is installed on that same CJS module.
 */
import React from 'react'
import { createRequire } from 'node:module'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/components/auth/AuthRouteGlobalChrome', () => ({ AuthRouteGlobalChrome: () => null }))
vi.mock('@/components/legal/AgeConfirmationPrompt', () => ({ default: () => null }))
vi.mock('@/lib/pwa', () => ({ initPWA: vi.fn() }))

import { SafeGlobalChrome } from '@/components/shell/SafeGlobalChrome'

const req = createRequire(import.meta.url)
const reactDomCjs = req('react-dom') as { preload?: (href: string, opts: unknown) => void }
const { HeadManagerContext } = req('next/dist/shared/lib/head-manager-context.shared-runtime') as {
  HeadManagerContext: React.Context<Record<string, unknown>>
}

function serverRender(fbAppId: string) {
  const preloaded: string[] = []
  const original = reactDomCjs.preload
  reactDomCjs.preload = (href: string) => {
    preloaded.push(href)
  }
  try {
    const html = renderToString(
      <HeadManagerContext.Provider value={{ appDir: true }}>
        <SafeGlobalChrome fbAppId={fbAppId} />
      </HeadManagerContext.Provider>,
    )
    return { html, preloaded }
  } finally {
    reactDomCjs.preload = original
  }
}

afterEach(() => vi.restoreAllMocks())

describe('SafeGlobalChrome — the Facebook SDK is never requested by the server render', () => {
  it('asks for no connect.facebook.net preload, so the iOS app never fetches the SDK', () => {
    const { html, preloaded } = serverRender('1790659191546539')
    expect(preloaded.filter((href) => href.includes('connect.facebook.net'))).toEqual([])
    expect(html).not.toContain('connect.facebook.net')
  })

  it('[control] still renders the chrome around it — the page did not simply render nothing', () => {
    const { html } = serverRender('1790659191546539')
    expect(html).toContain('id="fb-root"')
  })
})
