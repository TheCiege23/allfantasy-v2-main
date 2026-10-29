import { afterEach, describe, expect, it, vi } from 'vitest'
import { chimmySurfaceForWidth, currentChimmySurface } from '@/lib/draft-room/chimmySurface'

/**
 * One Chimmy surface per breakpoint. The draft room mounts both layouts at every width and hides
 * one with CSS, so opening all of them mounted invisible chats beside the visible one.
 */
describe('chimmySurfaceForWidth', () => {
  it('follows the CSS breakpoints the three surfaces are hidden at', () => {
    expect(chimmySurfaceForWidth(390)).toBe('mobile_tray')
    expect(chimmySurfaceForWidth(767)).toBe('mobile_tray')
    expect(chimmySurfaceForWidth(768)).toBe('bottom_dock')
    expect(chimmySurfaceForWidth(1279)).toBe('bottom_dock')
    expect(chimmySurfaceForWidth(1280)).toBe('right_dock')
    expect(chimmySurfaceForWidth(1920)).toBe('right_dock')
  })
})

describe('currentChimmySurface', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubWidth(width: number) {
    vi.stubGlobal('matchMedia', (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
      return { matches: width >= min } as MediaQueryList
    })
  }

  it('measures with media queries, as the CSS does', () => {
    stubWidth(390)
    expect(currentChimmySurface()).toBe('mobile_tray')
    stubWidth(1000)
    expect(currentChimmySurface()).toBe('bottom_dock')
    stubWidth(1440)
    expect(currentChimmySurface()).toBe('right_dock')
  })
})
