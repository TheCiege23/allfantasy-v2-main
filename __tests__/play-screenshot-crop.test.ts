import { describe, expect, it } from 'vitest'

// @ts-expect-error — plain .mjs script, no type declarations
import { cropBox, OUT_H, OUT_W } from '../scripts/prepare-play-screenshots.mjs'

/**
 * The crop decides whether a phone screenshot is accepted by Google Play at
 * all: Play rejects an image whose longest side is more than twice its
 * shortest, and a modern 20:9 capture (1080x2400) is 2.22:1.
 */
describe('cropBox — phone capture to a Play 9:16 window', () => {
  const ratio = (b: { width: number; height: number }) => b.height / b.width

  it('takes a 20:9 capture to full-width 9:16 just below the status bar', () => {
    expect(cropBox(1080, 2400)).toEqual({ left: 0, top: 84, width: 1080, height: 1920 })
  })

  it('handles an iPhone-shaped 19.5:9 capture the same way', () => {
    const b = cropBox(1170, 2532)
    expect(b.left).toBe(0)
    expect(b.width).toBe(1170)
    expect(ratio(b)).toBeCloseTo(16 / 9, 2)
  })

  it('centres the window when the capture is wider than 9:16', () => {
    const b = cropBox(1920, 1080)
    expect(b.height).toBe(1080 - Math.round(1080 * 0.035))
    expect(b.left).toBe(Math.round((1920 - b.width) / 2))
    expect(ratio(b)).toBeCloseTo(16 / 9, 2)
  })

  it('never reaches outside the image, for any common phone size', () => {
    for (const [w, h] of [
      [1080, 2400],
      [1080, 2340],
      [1170, 2532],
      [1284, 2778],
      [1440, 3200],
      [720, 1600],
      [1080, 1920],
    ]) {
      const b = cropBox(w, h)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.left + b.width).toBeLessThanOrEqual(w)
      expect(b.top + b.height).toBeLessThanOrEqual(h)
      expect(ratio(b)).toBeCloseTo(16 / 9, 1)
    }
  })

  it('targets exactly Play\'s 9:16 promotion size', () => {
    expect([OUT_W, OUT_H]).toEqual([1080, 1920])
  })
})
