// @vitest-environment jsdom
/**
 * The analytics label for iOS app / Android app / web (2026-11-20). Real User-Agent
 * strings; the Android app is detected by its launch referrer, not its UA.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPlatformProperties, detectAppPlatform } from '@/lib/platform/appPlatform'

const UA = {
  iosApp10: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS',
  iosApp11: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS AFIAP',
  iPhoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
}

function setEnv(userAgent: string, referrer = '') {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer)
}

describe('detectAppPlatform / appPlatformProperties', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('the iOS app, with and without the in-app purchase bridge', () => {
    setEnv(UA.iosApp10)
    expect(appPlatformProperties()).toEqual({ app_platform: 'ios_app', ios_iap_build: false })
    setEnv(UA.iosApp11)
    expect(appPlatformProperties()).toEqual({ app_platform: 'ios_app', ios_iap_build: true })
  })

  it('the Android app is recognised by its launch referrer', () => {
    setEnv(UA.androidChrome, 'android-app://ai.allfantasy.app')
    expect(detectAppPlatform()).toBe('android_app')
    expect(appPlatformProperties()).toEqual({ app_platform: 'android_app' })
  })

  it('🛑 Safari, Chrome, and another Android app linking in are all web', () => {
    setEnv(UA.iPhoneSafari)
    expect(detectAppPlatform()).toBe('web')
    window.sessionStorage.clear()
    setEnv(UA.androidChrome)
    expect(detectAppPlatform()).toBe('web')
    window.sessionStorage.clear()
    setEnv(UA.androidChrome, 'android-app://com.twitter.android')
    expect(appPlatformProperties()).toEqual({ app_platform: 'web' })
  })
})
