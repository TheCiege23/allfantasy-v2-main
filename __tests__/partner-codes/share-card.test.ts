import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The share image must still render when the Inter font cannot be fetched. Satori calls .split on
 * `fontFamily`, so the first version (fontFamily: undefined on failure) crashed every image the
 * moment Google Fonts was unreachable.
 */

vi.mock('server-only', () => ({}))

describe('renderShareCard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a PNG when the font download fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { renderShareCard } = await import('@/lib/partner-codes/shareCard')
    const res = await renderShareCard({
      code: 'TheCiege', name: 'TheCiege', look: 'gridiron', format: 'square', logo: 'initials', logoUrl: null, discountPercent: 10, discountMonths: 3,
    })
    const bytes = new Uint8Array(await res.arrayBuffer())
    // PNG signature.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  }, 60_000)
})
