import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ManagerPresence, PresenceManager } from '@/lib/core-app/managerPresence'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import { TradeWindows } from '@/components/core-app/player-finder/TradeWindows'

/*
 * The cross-league card: every owner, most reachable first, each row naming
 * its league and linking to that league's Trade Center.
 */

const NOW = '2026-10-24T14:30:00.000Z' // Saturday 10:30 ET

function owner(over: Partial<PresenceManager> = {}): PresenceManager {
  return { role: 'owner', teamName: 'T', ownerName: 'someone', avatarUrl: null, externalId: '1', record: '4-2', rank: 3, need: null, startsHim: true, window: null, lastMove: null, moves: 0, ...over }
}
function presence(leagueId: string, leagueName: string, platform: string, m: PresenceManager, over: Partial<ManagerPresence> = {}): ManagerPresence {
  return { leagueId, leagueName, platform, platformLeagueId: '1', season: 2026, timeZone: 'America/New_York', zone: 'ET', player: { sleeperId: '10236', position: 'TE' }, holder: 'other', managers: [m], activityIngested: true, newestMove: null, unattributed: 0, ...over }
}

const GANG = presence('L-gang', 'Gridiron Gang', 'espn', owner({ ownerName: 'tashaR', window: { weekday: 0, startHour: 10, endHour: 12, daypart: 'morning', precision: 'window', share: 0.8, sample: 12, zone: 'ET' }, lastMove: { at: '2026-10-20T18:00:00.000Z', kind: 'trade' }, moves: 13 }))
const PIRATES = presence('L-pirates', 'Pirate League', 'sleeper', owner({ ownerName: 'mikeD', startsHim: false, window: { weekday: 6, startHour: 10, endHour: 12, daypart: 'morning', precision: 'window', share: 0.6, sample: 9, zone: 'ET' }, lastMove: { at: '2026-10-24T13:00:00.000Z', kind: 'waiver' }, moves: 7 }))

describe('TradeWindows', () => {
  it('lists every owner most reachable first, names the league on each row, and links each to its Trade Center', () => {
    render(<TradeWindows presences={[GANG, PIRATES]} playerName="Dalton Kincaid" pkg={null} nowIso={NOW} />)
    const card = screen.getByRole('region', { name: 'Trade windows · who’s reachable' })
    expect(card).toHaveAttribute('data-live', 'true') // mikeD moved 90 minutes ago
    expect(within(card).getByText('1 of 2 owners are in their window right now.')).toBeInTheDocument()

    const rows = within(card).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-timing', 'now')
    expect(within(rows[0]).getByText('Pirate League · Sleeper')).toBeInTheDocument()
    expect(within(rows[0]).getByText('@mikeD usually moves Sat 10a–12p ET')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/They have Kincaid on the bench in Pirate League\. Ask what it takes\. Pitch now — this is their window\./)).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: 'Grade it in Pirate League →' })).toHaveAttribute('href', '/core/trades?league=L-pirates')

    expect(rows[1]).toHaveAttribute('data-timing', 'later')
    expect(within(rows[1]).getByText('Gridiron Gang · ESPN')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('link', { name: 'Grade it in Gridiron Gang →' })).toHaveAttribute('href', '/core/trades?league=L-gang')

    expect(within(card).getByRole('button', { name: 'Copy the pitch to @mikeD' })).toBeEnabled()
  })

  it('says how many leagues could not be read, and renders nothing when there is nobody to pitch', () => {
    render(<TradeWindows presences={[GANG]} playerName="Dalton Kincaid" pkg={null} nowIso={NOW} unread={2} />)
    expect(screen.getByText('2 more leagues where someone else has him could not be read for a window.')).toBeInTheDocument()
    expect(screen.getByText('1 owner across your leagues, soonest window first.')).toBeInTheDocument()

    const { container } = render(<TradeWindows presences={[{ ...GANG, holder: 'yours', managers: [] }]} playerName="Dalton Kincaid" pkg={null} nowIso={NOW} />)
    expect(container.querySelector('.af-pf-tw--multi')).toBeNull()
  })
})
