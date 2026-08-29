import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import type { DefenseHubPayload } from '@/lib/idp-projections/defenseHub'

/**
 * The kicker section of the Defense Hub.
 *
 * 🛑 THE INVARIANT THESE PROTECT IS "DO NOT RANK KICKERS". Measured over 4,482 kicker games
 * (2019-2025), kicker rank does not persist — negative in all six year-over-year pairs, mean
 * -0.455, and ~0 within a season. So every kicker in a league carries the SAME value. The
 * natural "improvement" is to sort them or add a Proj/VORP column; both would assert an
 * ordering the data refuses, and both would fail here.
 */

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const basePayload = (over: Partial<DefenseHubPayload> = {}): DefenseHubPayload => ({
  state: 'ok',
  projectedFor: { season: 2025, week: 11 },
  coverage: { defenders: 2, projected: 2, priced: 2 },
  defenders: [],
  kickers: [],
  kickerValue: null,
  snaps: [],
  roles: [],
  tendencies: [],
  notes: [],
  ...over,
})

const KICKER_VALUE = {
  value: 243,
  replacementRank: 15,
  scarcity: 0.438,
  rankPredictability: 'none' as const,
  basis:
    'Every kicker prices the same here: kicker rank does not persist (year-over-year Spearman ' +
    '-0.455, negative in all six measured season pairs), and the startable population spans ' +
    'only 1.55x. This league starts 1 kicker across 14 teams, so replacement is about K15.',
}

const mountWith = (payload: DefenseHubPayload) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  )
  return render(<DefenseHubClient leagueId="L1" />)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('Defense Hub kicker section', () => {
  it('shows the league value once and lists the rostered kickers', async () => {
    mountWith(
      basePayload({
        kickerValue: KICKER_VALUE,
        kickers: [
          { sleeperId: 'k1', name: 'Nick Folk', team: 'TEN' },
          { sleeperId: 'k2', name: 'Blake Grupe', team: 'NO' },
        ],
      }),
    )

    await waitFor(() => expect(screen.getByText('Your kickers')).toBeInTheDocument())
    expect(screen.getByText('Nick Folk')).toBeInTheDocument()
    expect(screen.getByText('Blake Grupe')).toBeInTheDocument()

    /*
     * 🛑 THE VALUE APPEARS EXACTLY ONCE. Repeating an identical number down a per-player column
     * reads as a rendering bug rather than as a flat position, which is the opposite of the
     * point. Stated once, with the reason beside it, it reads as the finding it is.
     */
    expect(screen.getAllByText('243')).toHaveLength(1)
  })

  it('gives the manager the reason, not just a number', async () => {
    mountWith(
      basePayload({ kickerValue: KICKER_VALUE, kickers: [{ sleeperId: 'k1', name: 'Nick Folk', team: 'TEN' }] }),
    )

    await waitFor(() => expect(screen.getByText('Your kickers')).toBeInTheDocument())
    expect(screen.getByText(/does not persist/i)).toBeInTheDocument()
    expect(screen.getByText(/replacement about K15/i)).toBeInTheDocument()
  })

  /**
   * A league with no K slot gets `kickerValue: null` from the loader. Rendering a price there
   * would invent a market for a player nobody in that league can field.
   */
  it('renders nothing when the league starts no kicker', async () => {
    mountWith(basePayload({ kickerValue: null, kickers: [{ sleeperId: 'k1', name: 'Nick Folk', team: 'TEN' }] }))

    await waitFor(() => expect(screen.getByText('Defense Hub')).toBeInTheDocument())
    expect(screen.queryByText('Your kickers')).not.toBeInTheDocument()
    expect(screen.queryByText('Nick Folk')).not.toBeInTheDocument()
  })

  it('renders nothing when the manager rosters no kicker', async () => {
    mountWith(basePayload({ kickerValue: KICKER_VALUE, kickers: [] }))

    await waitFor(() => expect(screen.getByText('Defense Hub')).toBeInTheDocument())
    expect(screen.queryByText('Your kickers')).not.toBeInTheDocument()
  })

  /**
   * 🛑 NO PER-KICKER PERFORMANCE COLUMNS. Proj / VORP / Pos rank exist for defenders because
   * value over replacement genuinely orders them. Beside kickers they would invite a
   * comparison nothing supports. This asserts the kicker card carries none of them.
   */
  it('does not show projection, VORP or rank columns for kickers', async () => {
    const { container } = mountWith(
      basePayload({
        kickerValue: KICKER_VALUE,
        kickers: [
          { sleeperId: 'k1', name: 'Nick Folk', team: 'TEN' },
          { sleeperId: 'k2', name: 'Blake Grupe', team: 'NO' },
        ],
      }),
    )

    await waitFor(() => expect(screen.getByText('Your kickers')).toBeInTheDocument())
    const section = [...container.querySelectorAll('section')].find((s) =>
      s.textContent?.includes('Your kickers'),
    )
    expect(section).toBeTruthy()
    for (const banned of ['VORP', 'Pos rank', 'Proj']) {
      expect(section!.textContent).not.toContain(banned)
    }
  })
})
