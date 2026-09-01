import { describe, expect, it } from 'vitest'

import {
  AVATAR_OUTPUT_PX,
  AVATAR_VIEWPORT_PX,
  clampOffsets,
  coverScale,
  displayedSize,
  outputTypeFor,
  shouldCropBeforeUpload,
  type Transform,
} from '@/components/identity/AvatarCropDialog'

/**
 * The crop maths, which is where a cropper is actually wrong or right.
 *
 * The dragging, pinching and painting need a canvas and are left to manual verification.
 * These four functions decide whether the saved image is square, filled, and the right
 * format — and they are pure, so there is no excuse for not pinning them.
 */

const LANDSCAPE = { width: 4000, height: 3000 }
const PORTRAIT = { width: 3000, height: 4000 }
const SQUARE = { width: 1000, height: 1000 }

const base = (over: Partial<Transform> = {}): Transform => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  ...over,
})

function file(type: string): File {
  return new File([new Uint8Array([1])], 'x', { type })
}

describe('cover scaling fills the circle rather than fitting inside it', () => {
  it('scales by the SHORTER edge, so the square is always covered', () => {
    // Contain would divide by 4000 and leave empty wedges left and right.
    expect(coverScale(LANDSCAPE, 0)).toBeCloseTo(AVATAR_VIEWPORT_PX / 3000)
    expect(coverScale(PORTRAIT, 0)).toBeCloseTo(AVATAR_VIEWPORT_PX / 3000)
    expect(coverScale(SQUARE, 0)).toBeCloseTo(AVATAR_VIEWPORT_PX / 1000)
  })

  it('a quarter turn swaps which edge has to cover', () => {
    // The short edge is the same 3000 either way here, so the scale must not move...
    expect(coverScale(LANDSCAPE, 90)).toBeCloseTo(coverScale(LANDSCAPE, 0))
    // ...but the on-screen box does swap, which is what the clamp has to notice.
    const t = base({ scale: coverScale(LANDSCAPE, 0) })
    const flat = displayedSize(LANDSCAPE, t)
    const turned = displayedSize(LANDSCAPE, { ...t, rotation: 90 })
    expect(turned.w).toBeCloseTo(flat.h)
    expect(turned.h).toBeCloseTo(flat.w)
  })

  it('at cover scale the displayed box is never smaller than the square', () => {
    for (const img of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (const rotation of [0, 90, 180, 270] as const) {
        const { w, h } = displayedSize(img, base({ scale: coverScale(img, rotation), rotation }))
        expect(w).toBeGreaterThanOrEqual(AVATAR_VIEWPORT_PX - 0.001)
        expect(h).toBeGreaterThanOrEqual(AVATAR_VIEWPORT_PX - 0.001)
      }
    }
  })
})

describe('clamping keeps the crop square filled', () => {
  /*
   * ⚠ THE INVARIANT IS "NO GUTTER", NOT "OFFSET IS SMALL". A drag that runs past the edge
   * of the photo must stop at the edge; if it does not, the exported avatar has a
   * transparent or black wedge in it and nothing else in the pipeline would catch that.
   */
  it('refuses to drag the image off the square', () => {
    const t = base({ scale: coverScale(LANDSCAPE, 0), offsetX: 99999, offsetY: -99999 })
    const clamped = clampOffsets(LANDSCAPE, t)
    const { w, h } = displayedSize(LANDSCAPE, clamped)
    expect(Math.abs(clamped.offsetX)).toBeLessThanOrEqual((w - AVATAR_VIEWPORT_PX) / 2 + 0.001)
    expect(Math.abs(clamped.offsetY)).toBeLessThanOrEqual((h - AVATAR_VIEWPORT_PX) / 2 + 0.001)
  })

  it('pins a square image at cover scale to dead centre, with no free play', () => {
    // Both edges exactly cover, so any offset at all would expose a gutter.
    const t = base({ scale: coverScale(SQUARE, 0), offsetX: 40, offsetY: -40 })
    const clamped = clampOffsets(SQUARE, t)
    expect(clamped.offsetX).toBeCloseTo(0)
    expect(clamped.offsetY).toBeCloseTo(0)
  })

  it('allows movement along the long edge once zoomed', () => {
    const t = base({ scale: coverScale(LANDSCAPE, 0) * 2, offsetX: 10, offsetY: 5 })
    const clamped = clampOffsets(LANDSCAPE, t)
    expect(clamped.offsetX).toBeCloseTo(10)
    expect(clamped.offsetY).toBeCloseTo(5)
  })
})

describe('format decisions', () => {
  /*
   * ⚠ GIF BYPASSES THE CROPPER ENTIRELY. Drawing one to a canvas keeps the first frame and
   * silently discards the animation, which is a worse outcome than an uncropped avatar.
   */
  it('sends GIFs straight to the uploader and crops everything else', () => {
    expect(shouldCropBeforeUpload(file('image/gif'))).toBe(false)
    expect(shouldCropBeforeUpload(file('image/jpeg'))).toBe(true)
    expect(shouldCropBeforeUpload(file('image/png'))).toBe(true)
    expect(shouldCropBeforeUpload(file('image/webp'))).toBe(true)
  })

  it('keeps alpha-capable sources lossless and photos as JPEG', () => {
    expect(outputTypeFor('image/png')).toBe('image/png')
    expect(outputTypeFor('image/webp')).toBe('image/png')
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg')
  })
})

describe('the exported avatar stays small', () => {
  it('renders larger than it is ever displayed, without being wasteful', () => {
    expect(AVATAR_OUTPUT_PX).toBeGreaterThan(AVATAR_VIEWPORT_PX)
    // A 512px square JPEG lands far under the 8MB ceiling, which is the point of cropping
    // client-side: the limit stops being something a phone photo can trip.
    expect(AVATAR_OUTPUT_PX).toBeLessThanOrEqual(1024)
  })
})
