/**
 * iPhone / iPad detection for the draft room's "No sound? Tap the video once." line (2026-11-17).
 * Real user-agent strings; the iPad-as-Mac case is the one a plain /iPad/ test misses.
 */
import { describe, expect, it } from 'vitest'
import { appleTouchDevice } from '@/lib/platform/appleTouchDevice'

const UA = {
  iPhoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iPhoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iPadOld: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  iPadOsAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  afIosApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS AFIAP',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

describe('appleTouchDevice', () => {
  it('an iPhone, in Safari, in Chrome, and in the AllFantasy iOS app', () => {
    expect(appleTouchDevice(UA.iPhoneSafari, 5)).toBe('iPhone')
    expect(appleTouchDevice(UA.iPhoneChrome, 5)).toBe('iPhone')
    expect(appleTouchDevice(UA.afIosApp, 5)).toBe('iPhone')
  })

  it('an iPad, including iPadOS reporting itself as a Mac with a touch screen', () => {
    expect(appleTouchDevice(UA.iPadOld, 5)).toBe('iPad')
    expect(appleTouchDevice(UA.iPadOsAsMac, 5)).toBe('iPad')
  })

  it('🛑 a real Mac (no touch screen), Android and Windows are not', () => {
    expect(appleTouchDevice(UA.iPadOsAsMac, 0)).toBeNull()
    expect(appleTouchDevice(UA.iPadOsAsMac)).toBeNull()
    expect(appleTouchDevice(UA.android, 5)).toBeNull()
    expect(appleTouchDevice(UA.windows, 10)).toBeNull()
    expect(appleTouchDevice(null)).toBeNull()
    expect(appleTouchDevice('')).toBeNull()
  })
})
