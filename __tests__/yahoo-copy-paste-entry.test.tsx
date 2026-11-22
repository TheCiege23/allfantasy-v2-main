/**
 * The Yahoo tile for an allowlisted account: the guide card and the shared "is copy-paste open for me"
 * check that the tile, the guide and the panel all read. Before this, picking Yahoo said "coming soon"
 * three times while the one working way in sat as a small link at the bottom of the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImportGuide } from '@/components/core-app/import/ImportGuide'

describe('ImportGuide paused card', () => {
  it('still says "Coming soon" when no other way in is offered', () => {
    render(<ImportGuide provider="yahoo" providerLabel="Yahoo" available={false} mark={null} />)
    expect(screen.getByText('Coming soon')).toBeTruthy()
    expect(screen.getByText(/Not open for imports yet/)).toBeTruthy()
  })

  it('shows the copy-paste way in instead when one is offered', () => {
    render(
      <ImportGuide
        provider="yahoo"
        providerLabel="Yahoo"
        available={false}
        mark={null}
        pausedNote={{ title: 'By copy-paste for now', body: 'Copy two pages from your league.' }}
      />,
    )
    expect(screen.getByText('By copy-paste for now')).toBeTruthy()
    expect(screen.getByText('Copy two pages from your league.')).toBeTruthy()
    expect(screen.queryByText('Coming soon')).toBeNull()
    expect(screen.queryByText(/Not open for imports yet/)).toBeNull()
  })
})

describe('fetchYahooCopyPasteEnabled', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) })

  it('asks once and shares an "open" answer', async () => {
    fetchMock.mockImplementation(() => json({ enabled: true }))
    const { fetchYahooCopyPasteEnabled } = await import('@/components/core-app/import/yahooCopyPaste')
    expect(await fetchYahooCopyPasteEnabled()).toBe(true)
    expect(await fetchYahooCopyPasteEnabled()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads a failure as "not open" and asks again next time', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    fetchMock.mockImplementationOnce(() => json({ enabled: true }))
    const { fetchYahooCopyPasteEnabled } = await import('@/components/core-app/import/yahooCopyPaste')
    expect(await fetchYahooCopyPasteEnabled()).toBe(false)
    expect(await fetchYahooCopyPasteEnabled()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a 401 (signed out) is "not open"', async () => {
    fetchMock.mockImplementation(() => json({}, false))
    const { fetchYahooCopyPasteEnabled } = await import('@/components/core-app/import/yahooCopyPaste')
    expect(await fetchYahooCopyPasteEnabled()).toBe(false)
  })

  it('openYahooCopyPaste tells the panel to open', async () => {
    const { openYahooCopyPaste, OPEN_YAHOO_COPY_PASTE_EVENT } = await import('@/components/core-app/import/yahooCopyPaste')
    const heard = vi.fn()
    window.addEventListener(OPEN_YAHOO_COPY_PASTE_EVENT, heard)
    openYahooCopyPaste()
    window.removeEventListener(OPEN_YAHOO_COPY_PASTE_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
