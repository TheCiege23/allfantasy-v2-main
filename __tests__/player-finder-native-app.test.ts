import { describe, expect, it } from 'vitest'

import { APP_LINKS_MEASURED_ON, appLinkHint, appLinkLanding, phoneOs } from '@/lib/core-app/nativeApp'

/*
 * Where a tap on a platform link lands on a phone — read from each platform's
 * own app-association files on 2026-09-06 (see the module header), never from
 * a guessed URL scheme.
 */

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

describe('phoneOs', () => {
  it('reads an iPhone, an Android phone, and nothing else', () => {
    expect(phoneOs(IPHONE)).toBe('ios')
    expect(phoneOs(ANDROID)).toBe('android')
    expect(phoneOs(DESKTOP)).toBeNull()
    expect(phoneOs(null)).toBeNull()
  })
})

describe('appLinkLanding — the measured table', () => {
  it('on an iPhone: ESPN and Yahoo lineup/waivers/trade open the app; Sleeper league screens and the Yahoo league page do not', () => {
    expect(appLinkLanding('espn', 'Lineup', 'ios')).toBe('app')
    expect(appLinkLanding('espn', 'Waivers', 'ios')).toBe('app')
    expect(appLinkLanding('espn', 'Trade', 'ios')).toBe('app')
    expect(appLinkLanding('yahoo', 'Lineup', 'ios')).toBe('app')
    expect(appLinkLanding('yahoo', 'Waivers', 'ios')).toBe('app')
    expect(appLinkLanding('yahoo', 'Trade', 'ios')).toBe('app')
    expect(appLinkLanding('yahoo', 'League', 'ios')).toBe('web')
    expect(appLinkLanding('sleeper', 'Lineup', 'ios')).toBe('web')
    expect(appLinkLanding('sleeper', 'Waivers', 'ios')).toBe('web')
    expect(appLinkLanding('sleeper', 'Trade', 'ios')).toBe('web')
  })

  it('on Android: every launch platform claims its domain, and the paths are the app’s own business — so "may open", never "opens"', () => {
    expect(appLinkLanding('sleeper', 'Lineup', 'android')).toBe('unknown')
    expect(appLinkLanding('espn', 'Waivers', 'android')).toBe('unknown')
    expect(appLinkLanding('yahoo', 'Trade', 'android')).toBe('unknown')
  })

  it('claims nothing for a desktop, an unmeasured platform, an unverified screen, or an AllFantasy league', () => {
    expect(appLinkLanding('yahoo', 'Lineup', null)).toBeNull()
    expect(appLinkLanding('mfl', 'Lineup', 'ios')).toBeNull()
    expect(appLinkLanding('yahoo', 'Yahoo home', 'ios')).toBeNull()
    expect(appLinkLanding('allfantasy', 'My team', 'ios')).toBeNull()
    expect(appLinkLanding(null, 'Lineup', 'ios')).toBeNull()
  })

  it('accepts the platform as a label or a key', () => {
    expect(appLinkLanding('Yahoo', 'lineup', 'ios')).toBe('app')
    expect(appLinkLanding('ESPN', 'Lineup', 'ios')).toBe('app')
  })
})

describe('appLinkHint', () => {
  it('says where the tap lands, in one honest line', () => {
    expect(appLinkHint('yahoo', 'Lineup', 'ios')).toBe('Opens in the Yahoo app when it’s installed')
    expect(appLinkHint('espn', 'Waivers', 'ios')).toBe('Opens in the ESPN app when it’s installed')
    expect(appLinkHint('sleeper', 'Lineup', 'ios')).toBe('Opens Sleeper on the web — its app does not take league links on iPhone')
    expect(appLinkHint('yahoo', 'League', 'ios')).toBe('Opens Yahoo on the web')
    expect(appLinkHint('sleeper', 'Lineup', 'android')).toBe('May open the Sleeper app')
    expect(appLinkHint('yahoo', 'Lineup', null)).toBeNull()
    expect(appLinkHint('mfl', 'Lineup', 'ios')).toBeNull()
  })

  it('carries the date the table was measured, so a stale claim is visibly stale', () => {
    expect(APP_LINKS_MEASURED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
