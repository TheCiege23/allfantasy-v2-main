import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD_PX,
  clampLauncher,
  exceedsDragThreshold,
  launcherDevice,
  launcherStorageKey,
  parseStoredLauncher,
  snapLauncher,
  type LauncherBounds,
} from '@/components/core-app/comms/launcherPosition'

/*
 * The movable chat bubble. What must hold whatever the user does with it:
 * it lands on an edge, it never drops onto the phone tab bar (the stylesheet's
 * own bottom offset is the floor), and a tap is still a tap.
 */

const phone: LauncherBounds = {
  viewportWidth: 390,
  viewportHeight: 844,
  size: 56,
  // --af-fab-bottom on a phone: tab bar 56 + home indicator 34 + 12.
  minBottom: 102,
  topReserve: 72,
}

describe('snapLauncher', () => {
  it('snaps to the nearer side, at the height it was dropped', () => {
    expect(snapLauncher({ x: 60, y: 400 }, phone)).toEqual({ side: 'left', bottom: 844 - (400 + 28) })
    expect(snapLauncher({ x: 330, y: 400 }, phone)).toEqual({ side: 'right', bottom: 416 })
  })

  it('cannot be dropped onto the tab bar — the stylesheet’s bottom is the floor', () => {
    expect(snapLauncher({ x: 300, y: 830 }, phone)).toEqual({ side: 'right', bottom: 102 })
  })

  it('cannot be dragged up under the status bar or header', () => {
    expect(snapLauncher({ x: 300, y: 5 }, phone)).toEqual({ side: 'right', bottom: 844 - 56 - 72 })
  })
})

describe('clampLauncher', () => {
  it('re-fits a remembered spot into a smaller window (rotation, split screen)', () => {
    const landscape = { ...phone, viewportWidth: 844, viewportHeight: 390 }
    expect(clampLauncher({ side: 'left', bottom: 700 }, landscape)).toEqual({ side: 'left', bottom: 390 - 56 - 72 })
  })

  it('treats a garbage height as the floor rather than NaN px', () => {
    expect(clampLauncher({ side: 'left', bottom: Number.NaN }, phone).bottom).toBe(102)
  })

  it('never inverts when the window is shorter than the safe band', () => {
    const tiny = { ...phone, viewportHeight: 150 }
    expect(clampLauncher({ side: 'right', bottom: 500 }, tiny).bottom).toBe(102)
  })
})

describe('tap vs drag', () => {
  it(`is a tap under ${DRAG_THRESHOLD_PX}px of travel, a drag at or past it`, () => {
    expect(exceedsDragThreshold(3, 4)).toBe(false) // 5px
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true)
    expect(exceedsDragThreshold(-6, -6)).toBe(true) // ~8.5px
  })
})

describe('remembered per device', () => {
  it('keys phone, tablet and desktop separately', () => {
    expect(launcherDevice(390)).toBe('phone')
    expect(launcherDevice(820)).toBe('tablet')
    expect(launcherDevice(1440)).toBe('desktop')
    expect(new Set(['phone', 'tablet', 'desktop'].map((d) => launcherStorageKey(d as never))).size).toBe(3)
  })

  it('reads only a well-formed stored position, and never throws on junk', () => {
    expect(parseStoredLauncher('{"side":"left","bottom":240}')).toEqual({ side: 'left', bottom: 240 })
    expect(parseStoredLauncher('{"side":"middle","bottom":240}')).toBeNull()
    expect(parseStoredLauncher('{"side":"left","bottom":"240"}')).toBeNull()
    expect(parseStoredLauncher('not json')).toBeNull()
    expect(parseStoredLauncher(null)).toBeNull()
  })
})
