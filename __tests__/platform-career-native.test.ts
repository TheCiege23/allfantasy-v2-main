import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { haptic, hapticOnce, VIBRATE_PATTERN } from '@/lib/platform/haptics'
import { syncCareerWidget } from '@/lib/platform/careerWidgetBridge'
import { buildCareerWidgetSnapshot, snapshotFingerprint } from '@/lib/core-app/careerWidgetSnapshot'
import { computeCareerAwards } from '@/lib/core-app/careerAwards'
import { buildCareerData, NO_CAREER_FILTER, type CareerRow, type CareerSource } from '@/lib/core-app/careerModel'
import { row } from './core-app/careerFixtures'

const IOS_UA = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 AllFantasyiOS/1.0'
const realUA = navigator.userAgent

function setUA(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}
function setReducedMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: on && q.includes('reduce'), media: q })) as never
}

const source = (rows: CareerRow[]): CareerSource => ({
  identity: { handle: 'guap', avatarUrl: null, xpTotal: null },
  rows,
  platforms: ['sleeper'],
  rosterless: 0,
})
const rows = [
  row({ season: 2023, isChampion: true, leagueName: 'A' }),
  row({ season: 2024, isChampion: true, leagueName: 'B' }),
  row({ season: 2026, counted: false, status: 'in_season', leagueName: 'Live', wins: 3, losses: 1 }),
]
const NOW = new Date('2026-10-04T18:00:00Z')

beforeEach(() => {
  window.sessionStorage.clear()
  setReducedMotion(false)
  setUA(realUA)
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})
afterEach(() => {
  setUA(realUA)
  vi.restoreAllMocks()
})

describe('haptic', () => {
  it('uses the iOS Haptics plugin when the app has it compiled in', () => {
    setUA(IOS_UA)
    const nativePromise = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { nativePromise, PluginHeaders: [{ name: 'Haptics' }] }
    expect(haptic('success')).toBe('ios')
    expect(nativePromise).toHaveBeenCalledWith('Haptics', 'notification', { type: 'SUCCESS' })
    haptic('light')
    expect(nativePromise).toHaveBeenLastCalledWith('Haptics', 'impact', { style: 'LIGHT' })
  })

  it('falls back to navigator.vibrate, and does nothing when the build lacks the plugin', () => {
    setUA(IOS_UA)
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { nativePromise: vi.fn(), PluginHeaders: [{ name: 'App' }] }
    const vibrate = vi.fn().mockReturnValue(true)
    Object.defineProperty(window.navigator, 'vibrate', { value: vibrate, configurable: true })
    expect(haptic('success')).toBe('vibrate')
    expect(vibrate).toHaveBeenCalledWith(VIBRATE_PATTERN.success)
  })

  it('stays still for someone who asked the OS for reduced motion', () => {
    setReducedMotion(true)
    const vibrate = vi.fn().mockReturnValue(true)
    Object.defineProperty(window.navigator, 'vibrate', { value: vibrate, configurable: true })
    expect(haptic('success')).toBe('none')
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('fires a keyed celebration once per session', () => {
    Object.defineProperty(window.navigator, 'vibrate', { value: vi.fn().mockReturnValue(true), configurable: true })
    expect(hapticOnce('career-wire:x', 'success')).toBe(true)
    expect(hapticOnce('career-wire:x', 'success')).toBe(false)
    expect(hapticOnce('career-wire:y', 'success')).toBe(true)
  })
})

describe('career widget snapshot', () => {
  const data = buildCareerData(source(rows))
  const awards = computeCareerAwards({ rows, trades: [] })

  it('carries the Career screen own figures', () => {
    expect(buildCareerWidgetSnapshot(data, awards, NOW)).toMatchObject({
      v: 1,
      handle: 'guap',
      titles: 2,
      record: '16-12',
      stakeTitle: 'Win Live',
      stakeRing: 3,
      nextTitle: 'Ring Collector Silver',
      nextShort: '1 title to go',
      updatedAt: NOW.toISOString(),
    })
  })

  it('is null under a filter, so the home screen never shows a slice as the whole career', () => {
    const filtered = buildCareerData(source(rows), { ...NO_CAREER_FILTER, platform: 'espn' })
    expect(buildCareerWidgetSnapshot(filtered, [], NOW)).toBeNull()
  })

  it('has exactly the keys the Swift widget decodes', () => {
    const swift = readFileSync('ios-app/ios/App/CareerWidget/CareerWidget.swift', 'utf8')
    const struct = swift.slice(swift.indexOf('struct CareerSnapshot'), swift.indexOf('static let sample'))
    const swiftKeys = [...struct.matchAll(/^\s+let (\w+):/gm)].map((m) => m[1]).sort()
    const tsKeys = Object.keys(buildCareerWidgetSnapshot(data, awards, NOW)!).sort()
    expect(swiftKeys).toEqual(tsKeys)
    // And the names the plugin, the widget and the bridge share.
    const shared = readFileSync('ios-app/ios/App/App/CareerWidgetShared.swift', 'utf8')
    expect(shared).toContain('"group.ai.allfantasy.app"')
    expect(readFileSync('ios-app/ios/App/CareerWidget/CareerWidget.entitlements', 'utf8')).toContain('group.ai.allfantasy.app')
    expect(readFileSync('ios-app/ios/App/App/CareerWidgetPlugin.swift', 'utf8')).toContain('jsName = "CareerWidget"')
  })

  it('fingerprints without the timestamp', () => {
    const a = buildCareerWidgetSnapshot(data, awards, NOW)!
    const b = buildCareerWidgetSnapshot(data, awards, new Date('2026-10-05T00:00:00Z'))!
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b))
  })
})

describe('syncCareerWidget', () => {
  const snap = buildCareerWidgetSnapshot(buildCareerData(source(rows)), computeCareerAwards({ rows, trades: [] }), NOW)

  it('does nothing outside the iOS app', async () => {
    expect(await syncCareerWidget(snap)).toBe('skipped')
  })

  it('sends a snapshot once per session, and tolerates a binary without the plugin', async () => {
    setUA(IOS_UA)
    const nativePromise = vi.fn().mockResolvedValue({ stored: true })
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { nativePromise }
    expect(await syncCareerWidget(snap)).toBe('sent')
    expect(nativePromise).toHaveBeenCalledWith('CareerWidget', 'setSnapshot', { json: JSON.stringify(snap) })
    expect(await syncCareerWidget(snap)).toBe('skipped')

    window.sessionStorage.clear()
    nativePromise.mockRejectedValueOnce(new Error('"CareerWidget" plugin is not implemented on ios'))
    expect(await syncCareerWidget(snap)).toBe('unavailable')
  })
})

describe('the iOS workflows keep the widget gated', () => {
  const release = readFileSync('.github/workflows/ios-testflight.yml', 'utf8')
  const check = readFileSync('.github/workflows/ios-build-check.yml', 'utf8')

  it('adds the widget target and the App Group only when career_widget is ticked', () => {
    expect(release).toMatch(/career_widget:\s*\n\s*description:[^\n]*\n\s*type: boolean[\s\S]*?default: false/)
    expect(release).toMatch(/- name: Add the career widget target\s*\n\s*if: \$\{\{ inputs\.career_widget \}\}/)
    expect(release).toMatch(/if \[ "\$WIDGET" = "true" \]; then\s*\n[^\n]*\n[^\n]*\n\s*\/usr\/libexec\/PlistBuddy -c "Add :com\.apple\.security\.application-groups array"/)
    // The committed app entitlements never ask for the group — only the gated step adds it.
    expect(readFileSync('ios-app/ios/App/App/App.entitlements', 'utf8')).not.toContain('application-groups')
    // The committed project has no widget target; the script adds it at build time.
    expect(readFileSync('ios-app/ios/App/App.xcodeproj/project.pbxproj', 'utf8')).not.toContain('CareerWidget.appex')
  })

  it('compile-checks both shapes on every ios-app change', () => {
    expect(check).toMatch(/paths:\s*\n\s*- 'ios-app\/\*\*'/)
    expect(check).toContain('- name: Build the app as committed')
    expect(check).toContain('ruby scripts/add-career-widget-target.rb')
    expect(check).toContain('- name: Build the app with the career widget')
    expect(check).not.toMatch(/secrets\./)
  })
})
