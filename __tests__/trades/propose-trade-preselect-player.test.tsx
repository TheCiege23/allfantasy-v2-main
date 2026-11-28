/**
 * The Players screen's Trade button opens the builder on that player (owner ask, 2026-11-22). It
 * knows the player and may not know his team's roster id, so the team is found from the rosters.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/AppModal', () => ({ AppModal: ({ open, title, children, footer }: { open: boolean; title?: string; children: React.ReactNode; footer?: React.ReactNode }) => open ? <div><h2>{title}</h2>{children}{footer}</div> : null }))

import { ProposeTradeModal } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'

const rosters = [
  { rosterId: 'r1', platformUserId: 'u1', ownerName: 'Me', wins: 0, losses: 0, canReceiveProposal: true, players: [{ id: 'p1', name: 'Alpha', position: 'RB' }], picks: [], faabRemaining: 100 },
  { rosterId: 'r2', platformUserId: 'u2', ownerName: 'Rival', wins: 0, losses: 0, canReceiveProposal: true, players: [{ id: 'p2', name: 'Beta', position: 'WR' }], picks: [], faabRemaining: 100 },
  { rosterId: 'r3', platformUserId: 'u3', ownerName: 'Third', wins: 0, losses: 0, canReceiveProposal: true, players: [{ id: 'p3', name: 'Gamma', position: 'TE' }], picks: [], faabRemaining: 100 },
]

function open(props: { initialGetPlayerId?: string | null; initialPartnerRosterId?: string | null }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.endsWith('/rosters') ? { rosters, viewerRosterId: 'r1', viewerTeamRosterId: 'r1' } : { grade: { graded: false, reason: 'Unavailable' } }),
  })))
  render(<ProposeTradeModal open leagueId="league1" teams={[]} platform="allfantasy" onClose={vi.fn()} onSubmitted={vi.fn()} {...props} />)
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('trade builder opened on a player', () => {
  it('finds the team that holds him and ticks him, with no roster id given', async () => {
    open({ initialGetPlayerId: 'p3' })
    const gamma = await screen.findByRole('button', { name: /^Gamma/ }, { timeout: 30000 })
    expect(gamma.getAttribute('aria-pressed')).toBe('true')
    // It skips the partner step: the builder opens on both rosters, Third's beside yours.
    expect(screen.getByTestId('propose-trade-step-assets')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Third roster' })).toBeTruthy()
  })

  it("does not pick the viewer's own team for a player the viewer holds", async () => {
    open({ initialGetPlayerId: 'p1' })
    await screen.findByTestId('propose-trade-step-partner')
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('falls back to the player when the roster id given matches no team', async () => {
    open({ initialGetPlayerId: 'p2', initialPartnerRosterId: 'gone' })
    const beta = await screen.findByRole('button', { name: /^Beta/ })
    expect(beta.getAttribute('aria-pressed')).toBe('true')
  })
})
