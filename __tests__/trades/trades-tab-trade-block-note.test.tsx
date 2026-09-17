/**
 * The legacy league Trades tab's trade block (2026-09-17): an empty block on a platform AllFantasy
 * cannot read says so, rather than claiming nobody has a player on it. The route supplies the note
 * (pinned in `trades-panel-trade-block.test.ts`); this pins what the tab renders from it.
 * Harness from `__tests__/redraft/trades-tab-native-builder-wiring.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TradesTab } from '@/app/league/[leagueId]/tabs/TradesTab'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-a' } } }),
}))
vi.mock('@/lib/dashboard/open-chimmy-with-prompt', () => ({ openChimmyWithPrompt: vi.fn() }))

const league = {
  id: 'league-2',
  name: 'Draft Junkies',
  sport: 'NFL',
  leagueType: 'dynasty',
  isDynasty: true,
  bestBallMode: false,
  guillotineMode: false,
  keeperPhaseActive: false,
  leagueVariant: null,
} as unknown as UserLeague

const NOTE =
  "Sleeper doesn't share its trade block with outside apps, so this only includes players managers put on the block in AllFantasy."

function panel(body: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/trades/rosters')) return { ok: true, json: async () => ({ rosters: [] }) }
    return { ok: true, json: async () => ({ activeTrades: [], activeCount: 0, source: 'sleeper', ...body }) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TradesTab — trade block note', () => {
  it('an empty block with a note says nobody marked a player HERE, and why', async () => {
    panel({ tradeBlock: [], tradeBlockNote: NOTE })
    render(<TradesTab league={league} teams={[]} />)
    await waitFor(() => expect(screen.getByTestId('trade-block-note')).toHaveTextContent(NOTE))
    expect(screen.getByText('No players marked on the trade block in AllFantasy')).toBeInTheDocument()
    expect(screen.queryByText('No players on the trade block yet')).not.toBeInTheDocument()
  })

  it('a native league (no note) keeps the plain empty state', async () => {
    panel({ tradeBlock: [], tradeBlockNote: null, source: 'native' })
    render(<TradesTab league={league} teams={[]} />)
    await waitFor(() => expect(screen.getByText('No players on the trade block yet')).toBeInTheDocument())
    expect(screen.queryByTestId('trade-block-note')).not.toBeInTheDocument()
  })

  it('listed players show with their team, and the note under them', async () => {
    panel({
      tradeBlock: [{ id: '1:10213', playerId: '10213', name: 'Tre Tucker', position: 'WR', team: 'LV', ownerName: 'Ice Kings' }],
      tradeBlockNote: NOTE,
    })
    render(<TradesTab league={league} teams={[]} />)
    await waitFor(() => expect(screen.getByText('Ice Kings')).toBeInTheDocument())
    expect(screen.getByTestId('trade-block-note')).toHaveTextContent(NOTE)
    expect(screen.queryByText('No players marked on the trade block in AllFantasy')).not.toBeInTheDocument()
  })

  it('an older response without the field still renders the plain empty state', async () => {
    panel({ tradeBlock: [] })
    render(<TradesTab league={league} teams={[]} />)
    await waitFor(() => expect(screen.getByText('No players on the trade block yet')).toBeInTheDocument())
  })
})
