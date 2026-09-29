// @vitest-environment jsdom
/**
 * The email-verification link reopens the iOS app (2026-09-29).
 *
 * A new user who signed up in the app got a verify email; tapping it opened Safari, so the account
 * was verified in a browser while the app still said "verify your email". Now the app claims
 * /verify/email on www.allfantasy.ai and navigates to the link it was opened with.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const inApp = { value: true }
vi.mock('@/lib/platform/iosApp', () => ({ isInIosAppClient: () => inApp.value }))

import { appSiteAssociation, isAppleTeamId, IOS_APP_LINK_PATHS } from '@/lib/platform/appSiteAssociation'
import { inAppPathForLink, installIosAppLinkHandler, LAUNCH_HANDLED_KEY } from '@/lib/platform/iosAppLinks'
import { GET } from '@/app/api/ios/app-site-association/route'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('the apple-app-site-association document', () => {
  it('names the app and claims only the verify-email link', () => {
    expect(appSiteAssociation('ABCDE12345')).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.ai.allfantasy.app'],
            components: [{ '/': '/verify/email*', comment: 'Email verification links reopen the app that asked for them.' }],
          },
        ],
      },
    })
    expect(IOS_APP_LINK_PATHS).toEqual(['/verify/email*'])
  })

  it('accepts only a 10-character Apple Team ID', () => {
    expect(isAppleTeamId('ABCDE12345')).toBe(true)
    for (const bad of ['abcde12345', 'ABCDE1234', 'ABCDE123456', '', null, undefined]) expect(isAppleTeamId(bad)).toBe(false)
  })
})

describe('GET /.well-known/apple-app-site-association', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is 404 — no association, links keep opening in Safari — until a Team ID is configured', async () => {
    vi.stubEnv('APNS_TEAM_ID', '')
    vi.stubEnv('APPLE_TEAM_ID', '')
    expect(GET().status).toBe(404)
    vi.stubEnv('APNS_TEAM_ID', 'not-a-team')
    expect(GET().status).toBe(404)
  })

  it('serves JSON naming the Team ID the push sender uses, falling back to APPLE_TEAM_ID', async () => {
    vi.stubEnv('APNS_TEAM_ID', 'ABCDE12345')
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect((await res.json()).applinks.details[0].appIDs).toEqual(['ABCDE12345.ai.allfantasy.app'])
    vi.stubEnv('APNS_TEAM_ID', '')
    vi.stubEnv('APPLE_TEAM_ID', 'ZYXWV98765')
    expect((await GET().json()).applinks.details[0].appIDs).toEqual(['ZYXWV98765.ai.allfantasy.app'])
  })
})

describe('inAppPathForLink', () => {
  it('turns one of our https links into the path the app should open', () => {
    expect(inAppPathForLink('https://www.allfantasy.ai/verify/email?token=t0k&returnTo=%2Fimport')).toBe(
      '/verify/email?token=t0k&returnTo=%2Fimport',
    )
    expect(inAppPathForLink('https://allfantasy.ai/core')).toBe('/core')
  })

  it('ignores anything that is not an https link to this site', () => {
    for (const u of ['http://www.allfantasy.ai/core', 'https://evil.example/verify/email', 'not a url', '', null, 42]) {
      expect(inAppPathForLink(u)).toBeNull()
    }
  })
})

describe('installIosAppLinkHandler', () => {
  let listeners: Record<string, (d: unknown) => void>
  const bridge = (launchUrl: string | null, plugins = ['App']) => {
    listeners = {}
    ;(window as unknown as { Capacitor: unknown }).Capacitor = {
      PluginHeaders: plugins.map((name) => ({ name })),
      nativePromise: vi.fn(async (plugin: string, method: string) =>
        plugin === 'App' && method === 'getLaunchUrl' ? (launchUrl ? { url: launchUrl } : {}) : undefined,
      ),
      addListener: vi.fn((plugin: string, event: string, cb: (d: unknown) => void) => {
        listeners[`${plugin}:${event}`] = cb
        return { remove: vi.fn() }
      }),
    }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const VERIFY = 'https://www.allfantasy.ai/verify/email?token=t0k&returnTo=%2Fimport'

  beforeEach(() => {
    inApp.value = true
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/core')
  })
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
  })

  it('a link that launched the app sends it to that page', async () => {
    bridge(VERIFY)
    const go = vi.fn()
    installIosAppLinkHandler(go)
    await flush()
    expect(go).toHaveBeenCalledWith('/verify/email?token=t0k&returnTo=%2Fimport')
  })

  /** 🛑 The loop: every page load re-runs this, and the launch URL never changes. */
  it('follows the launch link ONCE per app session — never back to a spent verify link', async () => {
    bridge(VERIFY)
    const go = vi.fn()
    installIosAppLinkHandler(go)
    await flush()
    // The verify link redirected on to /import; that page load runs the handler again.
    window.history.replaceState(null, '', '/import')
    installIosAppLinkHandler(go)
    await flush()
    expect(go).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(LAUNCH_HANDLED_KEY)).toBe(VERIFY)
  })

  it('a link tapped while the app is running navigates too', async () => {
    bridge(null)
    const go = vi.fn()
    installIosAppLinkHandler(go)
    await flush()
    expect(go).not.toHaveBeenCalled()
    listeners['App:appUrlOpen']({ url: VERIFY })
    expect(go).toHaveBeenCalledWith('/verify/email?token=t0k&returnTo=%2Fimport')
  })

  it('does nothing outside the app, in a build without the App plugin, or for a foreign link', async () => {
    const go = vi.fn()
    inApp.value = false
    bridge(VERIFY)
    installIosAppLinkHandler(go)
    inApp.value = true
    bridge(VERIFY, ['PushNotifications'])
    installIosAppLinkHandler(go)
    bridge('https://evil.example/verify/email')
    installIosAppLinkHandler(go)
    await flush()
    expect(go).not.toHaveBeenCalled()
  })
})

describe('the pieces this depends on', () => {
  it('the app claims www.allfantasy.ai — the canonical host every emailed link uses', () => {
    expect(read('ios-app/ios/App/App/App.entitlements')).toMatch(
      /<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>\s*<string>applinks:www\.allfantasy\.ai<\/string>/,
    )
  })

  it('iOS hands the link to Capacitor (SceneDelegate forwards continue userActivity)', () => {
    expect(read('ios-app/ios/App/App/SceneDelegate.swift')).toMatch(/SceneDelegateProxy\.shared\.scene\(scene, continue: userActivity\)/)
  })

  it('the file is served at the well-known path, and no geo gate can refuse Apple fetching it', () => {
    expect(read('next.config.js')).toMatch(
      /source: '\/\.well-known\/apple-app-site-association',\s*destination: '\/api\/ios\/app-site-association'/,
    )
    expect(read('middleware.ts')).toMatch(/const GEO_EXEMPT_PREFIXES = \[[\s\S]*?"\/\.well-known",[\s\S]*?\]/)
  })

  it('the root layout mounts the handler', () => {
    expect(read('app/layout.tsx')).toMatch(/<IosAppLinkHandler \/>/)
  })
})
