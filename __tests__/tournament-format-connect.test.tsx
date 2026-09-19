import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import FormatHub from '@/components/core-app/screens/FormatHub'
import type { FormatHubData } from '@/lib/core-app/formatHubs'
afterEach(cleanup)
it('connects previously imported tournament leagues from both the hub and connect panel', () => {
 const data: FormatHubData = { format: 'tournament', counts: { zombie: 0, tournament: 0, survivor: 0, c2c: 0, guillotine: 0, efl: 0 }, leagues: [], totalLeagues: 0, stats: [], trades: { pending: [], completed: [] }, mentions: [], broadcastLeagueIds: [], partial: false }
 render(<FormatHub data={data} />)
 expect(screen.getByRole('link', { name: 'Connect imported leagues' })).toHaveAttribute('href', '/tournament-hub/new')
 expect(screen.getByRole('link', { name: 'Your tournaments and weekly reports' })).toHaveAttribute('href', '/tournament-hub')
 fireEvent.click(screen.getAllByRole('button', { name: '+ Connect imported leagues' })[0])
 expect(screen.getByRole('link', { name: 'Connect leagues' })).toHaveAttribute('href', '/tournament-hub/new')
})