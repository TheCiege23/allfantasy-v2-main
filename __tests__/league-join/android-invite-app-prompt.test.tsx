/**
 * League invite links: Android → the app or Google Play; iPhone and desktop → the website, never a prompt
 * (docs/audits/best-ball-guilly-audit-2026-11-06.md, "Android → app/Play"). The invite itself must survive:
 * "Open in the app" carries the same URL, code and all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const nav = vi.hoisted(() => ({ pathname: '/join' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { AndroidInviteAppPrompt } from '@/components/league-join/AndroidInviteAppPrompt'
import { androidAppIntentUrl, PLAY_STORE_URL, shouldOfferAndroidApp } from '@/lib/platform/androidApp'
import { translations } from '@/lib/i18n/translations'

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
}

describe('who is offered the app (lib/platform/androidApp.ts)', () => {
  it('Android browsers only, and never inside the app itself', () => {
    expect(shouldOfferAndroidApp({ userAgent: UA.androidChrome, inTrustedWebActivity: false })).toBe(true)
    expect(shouldOfferAndroidApp({ userAgent: UA.androidTablet, inTrustedWebActivity: false })).toBe(true)
    expect(shouldOfferAndroidApp({ userAgent: UA.androidChrome, inTrustedWebActivity: true })).toBe(false)
    for (const ua of [UA.iphone, UA.iphoneChrome, UA.ipad, UA.windowsChrome, '', null]) {
      expect(shouldOfferAndroidApp({ userAgent: ua, inTrustedWebActivity: false })).toBe(false)
    }
  })

  it('"Open in the app" carries the whole invite, and falls back to Google Play', () => {
    const href = androidAppIntentUrl('allfantasy.ai', '/join?code=AB12&src=recap')
    expect(href).toBe(
      `intent://allfantasy.ai/join?code=AB12&src=recap#Intent;scheme=https;package=ai.allfantasy.app;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`,
    )
    // Never an intent to another host.
    expect(androidAppIntentUrl('allfantasy.ai', '//evil.example/join')).toBe(PLAY_STORE_URL)
    expect(androidAppIntentUrl('evil.example/x', '/join')).toBe(PLAY_STORE_URL)
  })

  it('every string exists in English and Spanish', () => {
    const t = translations as unknown as Record<string, Record<string, string>>
    for (const key of ['label', 'body', 'open', 'play', 'dismiss']) {
      expect(t.en![`join.androidApp.${key}`]).toBeTruthy()
      expect(t.es![`join.androidApp.${key}`]).toBeTruthy()
      expect(t.es![`join.androidApp.${key}`]).not.toBe(t.en![`join.androidApp.${key}`])
    }
  })
})

describe('the prompt on the invite landing (components/league-join/AndroidInviteAppPrompt.tsx)', () => {
  const setUa = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  const original = window.navigator.userAgent

  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    nav.pathname = '/join'
    window.history.pushState({}, '', '/join?code=AB12&go=1')
  })
  afterEach(() => {
    cleanup()
    setUa(original)
  })

  it('an Android browser sees it, with the invite in the app link', async () => {
    setUa(UA.androidChrome)
    await act(async () => { render(<AndroidInviteAppPrompt />) })
    expect(screen.getByTestId('android-invite-app-prompt')).toBeTruthy()
    const open = screen.getByTestId('android-invite-app-open').getAttribute('href') ?? ''
    expect(open.startsWith(`intent://${window.location.host}/join?code=AB12&go=1#Intent;`)).toBe(true)
    expect(screen.getByTestId('android-invite-app-play').getAttribute('href')).toBe(PLAY_STORE_URL)
  })

  it('an iPhone and a desktop never see it', async () => {
    for (const ua of [UA.iphone, UA.iphoneChrome, UA.ipad, UA.windowsChrome]) {
      setUa(ua)
      await act(async () => { render(<AndroidInviteAppPrompt />) })
      expect(screen.queryByTestId('android-invite-app-prompt')).toBeNull()
      cleanup()
    }
  })

  it('dismissed stays dismissed on this device', async () => {
    setUa(UA.androidChrome)
    await act(async () => { render(<AndroidInviteAppPrompt />) })
    fireEvent.click(screen.getByTestId('android-invite-app-dismiss'))
    expect(screen.queryByTestId('android-invite-app-prompt')).toBeNull()
    cleanup()
    await act(async () => { render(<AndroidInviteAppPrompt />) })
    expect(screen.queryByTestId('android-invite-app-prompt')).toBeNull()
  })

  it('not on a World Cup bracket invite, which has its own flow', async () => {
    setUa(UA.androidChrome)
    nav.pathname = '/join/bracket/XYZ'
    window.history.pushState({}, '', '/join/bracket/XYZ')
    await act(async () => { render(<AndroidInviteAppPrompt />) })
    expect(screen.queryByTestId('android-invite-app-prompt')).toBeNull()
  })
})
