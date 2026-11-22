import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FallbackImg } from '@/components/core-app/FallbackImg'

/**
 * FallbackImg is lazy and async-decoded by default, and a lazy image that already failed before
 * hydration still lands on its fallback — via a probe, because a lazy `complete` with no
 * `naturalWidth` can also mean "not requested yet".
 */

afterEach(() => vi.unstubAllGlobals())

/** jsdom never loads images; this stand-in answers the probe the way a browser would. */
function stubImage(outcome: 'error' | 'load') {
  const created: Array<{ src: string }> = []
  class ProbeImage {
    onerror: (() => void) | null = null
    onload: (() => void) | null = null
    private _src = ''
    constructor() {
      created.push(this)
    }
    get src() {
      return this._src
    }
    set src(v: string) {
      this._src = v
      queueMicrotask(() => (outcome === 'error' ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', ProbeImage)
  return created
}

describe('FallbackImg defaults', () => {
  it('renders lazy and async-decoded unless told otherwise', () => {
    stubImage('load')
    const { container } = render(<FallbackImg src="https://cdn.example/a.jpg" alt="" fallback={null} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
  })

  it('honours an explicit eager image', () => {
    const { container } = render(<FallbackImg src="https://cdn.example/a.jpg" alt="" loading="eager" fallback={null} />)
    expect(container.querySelector('img')!.getAttribute('loading')).toBe('eager')
  })
})

/**
 * jsdom reports every image `complete: false` and implements no `loading` property, so the
 * pre-hydration branch never runs there. Pin what a browser reports for a settled image with
 * no pixels: `complete` true, `naturalWidth` 0, and `loading` mirroring the attribute.
 */
function asSettledWithNoPixels() {
  const proto = HTMLImageElement.prototype
  const saved = (['complete', 'naturalWidth', 'loading'] as const).map(
    (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const,
  )
  Object.defineProperty(proto, 'complete', { configurable: true, get: () => true })
  Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => 0 })
  Object.defineProperty(proto, 'loading', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.getAttribute('loading') ?? 'eager'
    },
  })
  return () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(proto, k, d)
      else delete (proto as unknown as Record<string, unknown>)[k]
    }
  }
}

describe('a lazy image that failed before React was listening', () => {
  let restore: () => void = () => {}
  beforeEach(() => {
    restore = asSettledWithNoPixels()
  })
  afterEach(() => restore())

  it('shows the fallback when the probe confirms the URL is dead', async () => {
    const probes = stubImage('error')
    const { container } = render(
      <FallbackImg src="https://cdn.example/dead.jpg" alt="" fallback={<span className="fb">AB</span>} />,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(probes.map((p) => p.src)).toEqual(['https://cdn.example/dead.jpg'])
    expect(container.querySelector('.fb')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps the image when the probe loads — a deferred image is not a failure', async () => {
    stubImage('load')
    const { container } = render(
      <FallbackImg src="https://cdn.example/fine.jpg" alt="" fallback={<span className="fb">AB</span>} />,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('.fb')).toBeNull()
  })
})
