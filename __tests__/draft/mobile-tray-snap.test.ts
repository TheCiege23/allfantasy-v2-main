import { describe, expect, it } from 'vitest'

import {
  FLICK_VELOCITY,
  cycleTraySnap,
  resolveTraySnap,
  stepTraySnap,
  trayHeightFor,
} from '@/lib/draft-room/mobileTraySnap'

const FULL = 600 // half = 330

describe('mobile tray snap maths', () => {
  it('maps snaps to heights', () => {
    expect(trayHeightFor('peek', FULL)).toBe(0)
    expect(trayHeightFor('half', FULL)).toBe(330)
    expect(trayHeightFor('full', FULL)).toBe(600)
  })

  it('a slow release settles on the nearest height', () => {
    expect(resolveTraySnap({ heightPx: 120, velocity: 0, fullHeight: FULL })).toBe('peek')
    expect(resolveTraySnap({ heightPx: 300, velocity: 0, fullHeight: FULL })).toBe('half')
    expect(resolveTraySnap({ heightPx: 520, velocity: 0, fullHeight: FULL })).toBe('full')
  })

  it('a downward flick goes to the next lower height even when nearer the current one', () => {
    expect(resolveTraySnap({ heightPx: 560, velocity: FLICK_VELOCITY + 0.1, fullHeight: FULL })).toBe('half')
    expect(resolveTraySnap({ heightPx: 320, velocity: FLICK_VELOCITY + 0.1, fullHeight: FULL })).toBe('peek')
  })

  it('an upward flick goes to the next higher height', () => {
    expect(resolveTraySnap({ heightPx: 40, velocity: -(FLICK_VELOCITY + 0.1), fullHeight: FULL })).toBe('half')
    expect(resolveTraySnap({ heightPx: 340, velocity: -(FLICK_VELOCITY + 0.1), fullHeight: FULL })).toBe('full')
  })

  it('flicks past either end clamp instead of wrapping', () => {
    expect(resolveTraySnap({ heightPx: 0, velocity: 5, fullHeight: FULL })).toBe('peek')
    expect(resolveTraySnap({ heightPx: 600, velocity: -5, fullHeight: FULL })).toBe('full')
  })

  it('keyboard stepping clamps; Enter cycles', () => {
    expect(stepTraySnap('peek', 'down')).toBe('peek')
    expect(stepTraySnap('peek', 'up')).toBe('half')
    expect(stepTraySnap('full', 'up')).toBe('full')
    expect(cycleTraySnap('peek')).toBe('half')
    expect(cycleTraySnap('half')).toBe('full')
    expect(cycleTraySnap('full')).toBe('peek')
  })
})
