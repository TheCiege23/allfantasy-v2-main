import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { KickerValuePanel } from '@/components/league/KickerValuePanel'

/**
 * The kicker value on My Team, which is the ONLY place most leagues can see it.
 *
 * The Defense Hub renders kickers too, but only loads for leagues that roster defenders — 10
 * of 115 in production, 5 of which start a kicker, against 19 leagues that do. This panel is
 * what the other fourteen get, so its empty states matter as much as its populated one.
 */

const mount = (payload: unknown, ok = true) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })),
  )
  return render(<KickerValuePanel leagueId="L1" />)
}

const VALUE = {
  value: 243,
  replacementRank: 15,
  scarcity: 0.438,
  rankPredictability: 'none' as const,
  basis:
    'Every kicker prices the same here: kicker rank does not persist (year-over-year Spearman ' +
    '-0.455, negative in all six measured season pairs), and the startable population spans ' +
    'only 1.55x. This league starts 1 kicker across 14 teams, so replacement is about K15.',
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('KickerValuePanel', () => {
  it('shows one value with the reason attached', async () => {
    mount(VALUE)

    await waitFor(() => expect(screen.getByTestId('kicker-value-panel')).toBeInTheDocument())
    expect(screen.getByText('243')).toBeInTheDocument()
    expect(screen.getByText(/any kicker/i)).toBeInTheDocument()
    expect(screen.getByText(/replacement about K15/i)).toBeInTheDocument()
    expect(screen.getByText(/does not persist/i)).toBeInTheDocument()
  })

  /**
   * 🛑 NOT AN EMPTY STATE, NOT A ZERO — NOTHING. In a league with no K slot a kicker is not a
   * worthless asset, he is not an asset. Rendering "0" or "no kicker value" would both be
   * claims, and the second would read as a missing feature rather than an inapplicable one.
   */
  it('renders nothing when the league starts no kicker', async () => {
    const { container } = mount({ value: null })

    await waitFor(() => expect(container.firstChild).toBeNull())
    expect(screen.queryByTestId('kicker-value-panel')).not.toBeInTheDocument()
  })

  it('renders nothing rather than breaking My Team when the lookup fails', async () => {
    const { container } = mount({ error: 'boom' }, false)

    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders nothing while the value is still loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<KickerValuePanel leagueId="L1" />)
    expect(container.firstChild).toBeNull()
  })

  /**
   * ⚠ IT MUST RIDE THE EXISTING ENDPOINT. The repo is at Vercel's route ceiling and the
   * standing rule is to fold into an existing route. If this ever starts calling its own
   * endpoint, the deployment fails with too_many_routes while the build still succeeds.
   */
  it('reads from the existing idp/players route rather than a new one', async () => {
    mount(VALUE)
    await waitFor(() => expect(screen.getByTestId('kicker-value-panel')).toBeInTheDocument())

    const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('/api/idp/players')
    expect(url).toContain('view=kicker-value')
    expect(url).toContain('leagueId=L1')
  })
})
