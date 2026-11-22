/**
 * The iPhone app went live on the App Store on 2026-11-19. iPhone browsers are now offered it, the way
 * Android browsers are offered Google Play: the Safari Smart App Banner on every page, and an App Store link
 * on league and bracket invites. Android, iPad, desktop and the app itself are never offered it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const nav = vi.hoisted(() => ({ pathname: '/join' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { IosInviteAppPrompt } from '@/components/league-join/IosInviteAppPrompt'
import IosBracketAppOption from '@/components/brackets/IosBracketAppOption'
import { APP_STORE_APP_ID, APP_STORE_URL, shouldOfferIosApp } from '@/lib/platform/iosAppStore'
import { shouldOfferAndroidApp } from '@/lib/platform/androidApp'
import { translations } from '@/lib/i18n/translations'

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1',
  iosApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.1 AFIAP/1',
  iosApp10: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktopUa: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
}

const NOT_OFFERED = [UA.iosApp, UA.iosApp10, UA.ipad, UA.ipadDesktopUa, UA.androidChrome, UA.windowsChrome, '', null]

describe('who is offered the App Store app (lib/platform/iosAppStore.ts)', () => {
  it('iPhone browsers only, any browser, never inside the app', () => {
    expect(shouldOfferIosApp(UA.iphone)).toBe(true)
    expect(shouldOfferIosApp(UA.iphoneChrome)).toBe(true)
    for (const ua of NOT_OFFERED) expect(shouldOfferIosApp(ua)).toBe(false)
  })

  it('no device is offered both stores', () => {
    for (const ua of Object.values(UA)) {
      expect(shouldOfferIosApp(ua) && shouldOfferAndroidApp({ userAgent: ua, inTrustedWebActivity: false })).toBe(false)
    }
  })

  it('links to the live app record', () => {
    expect(APP_STORE_APP_ID).toBe('6815778932')
    expect(APP_STORE_URL).toBe('https://apps.apple.com/app/allfantasy/id6815778932')
  })

  it('every string exists in English and Spanish', () => {
    const t = translations as unknown as Record<string, Record<string, string>>
    for (const key of ['label', 'body', 'appStore', 'dismiss']) {
      expect(t.en![`join.iosApp.${key}`]).toBeTruthy()
      expect(t.es![`join.iosApp.${key}`]).toBeTruthy()
    }
    expect(t.es!['join.iosApp.body']).not.toBe(t.en!['join.iosApp.body'])
  })
})

describe('the Smart App Banner (app/layout.tsx)', () => {
  // Safari reads apple-itunes-app only from <head>. Next 15 streams the `metadata` object into <body> for
  // ordinary browsers, so the tag must be rendered by the layout (React hoists it into <head>), not set as
  // `itunes` metadata, which shipped once and showed no banner.
  it('renders the tag in the layout, not as streamed metadata', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('app/layout.tsx', 'utf8')
    expect(src).toMatch(/^\s*<meta name="apple-itunes-app" content=\{`app-id=\$\{APP_STORE_APP_ID\}`\} \/>/m)
    expect(src).not.toMatch(/^\s*itunes:/m)
  })
})

describe('the invite prompt (components/league-join/IosInviteAppPrompt.tsx)', () => {
  const setUa = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  const original = window.navigator.userAgent

  beforeEach(() => {
    window.localStorage.clear()
    nav.pathname = '/join'
  })
  afterEach(() => {
    cleanup()
    setUa(original)
  })

  it('an iPhone browser sees it, with the App Store link and no "open in app"', async () => {
    setUa(UA.iphone)
    await act(async () => { render(<IosInviteAppPrompt />) })
    expect(screen.getByTestId('ios-invite-app-prompt')).toBeTruthy()
    expect(screen.getByTestId('ios-invite-app-store').getAttribute('href')).toBe(APP_STORE_URL)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('the app, iPad, Android and desktop never see it', async () => {
    for (const ua of NOT_OFFERED) {
      setUa(ua ?? '')
      await act(async () => { render(<IosInviteAppPrompt />) })
      expect(screen.queryByTestId('ios-invite-app-prompt')).toBeNull()
      cleanup()
    }
  })

  it('dismissed stays dismissed on this device', async () => {
    setUa(UA.iphone)
    await act(async () => { render(<IosInviteAppPrompt />) })
    fireEvent.click(screen.getByTestId('ios-invite-app-dismiss'))
    expect(screen.queryByTestId('ios-invite-app-prompt')).toBeNull()
    cleanup()
    await act(async () => { render(<IosInviteAppPrompt />) })
    expect(screen.queryByTestId('ios-invite-app-prompt')).toBeNull()
  })

  it('not on a World Cup bracket invite, which has its own flow', async () => {
    setUa(UA.iphone)
    nav.pathname = '/join/bracket/XYZ'
    await act(async () => { render(<IosInviteAppPrompt />) })
    expect(screen.queryByTestId('ios-invite-app-prompt')).toBeNull()
  })

  it('the bracket invite option shows on iPhone only', async () => {
    setUa(UA.iphone)
    await act(async () => { render(<IosBracketAppOption />) })
    expect(screen.getByTestId('ios-bracket-app-option').querySelector('a')?.getAttribute('href')).toBe(APP_STORE_URL)
    cleanup()
    setUa(UA.iosApp)
    await act(async () => { render(<IosBracketAppOption />) })
    expect(screen.queryByTestId('ios-bracket-app-option')).toBeNull()
  })
})
