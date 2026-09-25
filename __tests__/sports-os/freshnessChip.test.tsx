import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import { freshnessLabel, shouldWarnAboutFreshness, type FreshnessMeta } from '@/lib/sports-os/freshness'

/** The server's clock. */
const SERVER_NOW = 1_700_000_000_000

const meta = (over: Partial<FreshnessMeta> = {}): FreshnessMeta => ({
  fetchedAt: SERVER_NOW - 4 * 60_000,
  source: 'cache',
  staleAfterMs: 2 * 60_000,
  ...over,
})

/** Exactly what `app/core/(shell)/[[...screen]]/page.tsx` computes and passes down. */
const serverProps = (m: FreshnessMeta, nowMs = SERVER_NOW) => ({
  meta: m,
  initialLabel: freshnessLabel(m, nowMs),
  initialWarn: shouldWarnAboutFreshness(m, nowMs),
})

beforeEach(() => {
  // Pin the browser clock to the server's, or the post-mount recompute measures the gap between
  // the fixture's 2023 timestamps and the real clock and calls everything stale.
  vi.useFakeTimers()
  vi.setSystemTime(SERVER_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FreshnessChip', () => {
  it('hydrates without a mismatch even when the client clock has moved on', async () => {
    /*
     * 🛑 THE CONTRACT, TESTED DIRECTLY RATHER THAN BY PROXY. The server renders from ITS clock and
     * passes the string down; the client's first render must reproduce it byte for byte. Seeding
     * the component's own clock from Date.now() would break this whenever the two sides straddle a
     * label boundary — and React reports that as a hydration error, so that is what we assert on.
     *
     * ⚠ An earlier version of this test tried to read "first paint" out of testing-library's
     * `render`, which flushes effects synchronously — so it was reading the POST-effect markup and
     * could never have observed the thing it claimed to check.
     */
    const props = serverProps(meta())
    const html = renderToString(<FreshnessChip {...props} />)
    expect(html).toContain('4m ago')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    // An hour later on the client: a component that recomputed on first render would say "1h ago".
    vi.setSystemTime(SERVER_NOW + 60 * 60_000)

    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(String(args[0]))
    })
    await act(async () => {
      hydrateRoot(container, <FreshnessChip {...props} />)
    })
    spy.mockRestore()

    expect(errors.filter((e) => /hydrat|did not match|mismatch/i.test(e))).toEqual([])
    document.body.removeChild(container)
  })

  it('refreshes the label after mount, so a tab left open does not freeze', () => {
    render(<FreshnessChip {...serverProps(meta())} />)
    expect(screen.getByText(/4m ago/)).toBeTruthy()

    act(() => {
      vi.setSystemTime(SERVER_NOW + 2 * 60 * 60_000)
      vi.advanceTimersByTime(31_000)
    })

    // A server-rendered relative timestamp that never ticks is a confident lie about the one thing
    // this component exists to report.
    expect(screen.getByText(/2h ago/)).toBeTruthy()
  })

  it('always warns for last-known, even when the value is young', () => {
    // `last-known` means a refresh FAILED, not "slightly old".
    const m = meta({ source: 'last-known', fetchedAt: SERVER_NOW - 20_000, staleAfterMs: 5 * 60_000 })
    expect(shouldWarnAboutFreshness(m, SERVER_NOW)).toBe(true)

    const { container } = render(<FreshnessChip {...serverProps(m)} />)
    expect(container.querySelector('.af-fresh')?.getAttribute('data-state')).toBe('last-known')
    expect(container.textContent).toContain('Last known')
    expect(container.textContent).toContain('refresh failed')
  })

  it('separates stale from last-known rather than collapsing them', () => {
    // Stale: past TTL, a refresh is expected. Last-known: a refresh already failed. Only one of
    // those is something the reader can act on.
    const stale = meta({ source: 'cache', fetchedAt: SERVER_NOW - 10 * 60_000, staleAfterMs: 60_000 })
    const { container } = render(<FreshnessChip {...serverProps(stale)} />)
    expect(container.querySelector('.af-fresh')?.getAttribute('data-state')).toBe('stale')
    expect(container.textContent).not.toContain('refresh failed')
  })

  it('reads fresh inside the TTL', () => {
    const fresh = meta({ source: 'live', fetchedAt: SERVER_NOW - 1_000, staleAfterMs: 2 * 60_000 })
    const { container } = render(<FreshnessChip {...serverProps(fresh)} />)
    expect(container.querySelector('.af-fresh')?.getAttribute('data-state')).toBe('fresh')
    expect(container.textContent).toContain('Updated')
    expect(container.textContent).toContain('just now')
  })

  it('renders nothing when nothing was ever fetched', () => {
    // A chip reading "never" over a board is noise, not information.
    const none = meta({ source: 'none', fetchedAt: 0 })
    const { container } = render(<FreshnessChip {...serverProps(none)} />)
    expect(container.innerHTML).toBe('')
  })

  it('carries the absolute instant in dateTime for a reader that wants precision', () => {
    const m = meta()
    const { container } = render(<FreshnessChip {...serverProps(m)} />)
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(
      new Date(m.fetchedAt).toISOString(),
    )
  })
})
