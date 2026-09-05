import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TradeWindow } from '@/components/core-app/player-finder/TradeWindow'
import type { ManagerPresence } from '@/lib/core-app/managerPresence'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

/*
 * The trade-window card: one line per manager, the pulse only for a move in
 * the last day, Copy the pitch onto the clipboard, Grade it to the visual or
 * the Trade Center.
 */

const PRESENCE: ManagerPresence = {
  leagueId: 'L-gang',
  leagueName: 'Gridiron Gang',
  platform: 'sleeper',
  platformLeagueId: '123456',
  season: 2026,
  timeZone: 'America/New_York',
  zone: 'ET',
  player: { sleeperId: '10236', position: 'TE' },
  holder: 'other',
  managers: [
    {
      role: 'owner',
      teamName: "Tasha's Titans",
      ownerName: 'tashaR',
      avatarUrl: null,
      externalId: '1',
      record: '4-2',
      rank: 3,
      need: null,
      startsHim: true,
      window: { weekday: 0, startHour: 10, endHour: 12, daypart: 'morning', precision: 'window', share: 0.8, sample: 12, zone: 'ET' },
      lastMove: { at: '2026-10-25T13:00:00.000Z', kind: 'waiver' },
      moves: 13,
    },
  ],
  activityIngested: true,
  newestMove: '2026-10-25T13:00:00.000Z',
  unattributed: 0,
}

const NOW = '2026-10-25T14:30:00.000Z' // Sun 10:30a ET — inside her window, an hour after her last move
const PKG = { give: ['Tony Pollard'], fairness: 'balanced' }

const writeText = vi.fn()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('TradeWindow', () => {
  it('names the manager, their window and the pitch, pulses for a move today, and copies the pitch', async () => {
    render(<TradeWindow state={{ available: true, data: PRESENCE }} playerName="Dalton Kincaid" pkg={PKG} gradeHref="#af-pf-tv-h" tradeCenterHref="/core/trades?league=L-gang" nowIso={NOW} />)

    const card = screen.getByRole('region', { name: 'Trade window · when they move' })
    expect(card).toHaveAttribute('data-live', 'true')
    expect(screen.getByText('@tashaR usually moves Sun 10a–12p ET')).toBeInTheDocument()
    expect(screen.getByText(/They start Kincaid in Gridiron Gang\. Send Tony Pollard for Kincaid — values are balanced\. Pitch now/)).toBeInTheDocument()
    expect(card.querySelector('.af-pf-tw-row')).toHaveAttribute('data-timing', 'now')
    expect(screen.getByRole('button', { name: 'Trade window' })).toBeInTheDocument() // the help dot
    expect(screen.getByRole('link', { name: 'Grade it' })).toHaveAttribute('href', '#af-pf-tv-h')

    fireEvent.click(screen.getByRole('button', { name: 'Copy the pitch' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Hey tashaR — would you move Dalton Kincaid for Tony Pollard\?/))
  })

  it('is quiet when nobody moved today, and grades in the Trade Center without a visual', () => {
    const quiet = { ...PRESENCE, managers: [{ ...PRESENCE.managers[0], lastMove: { at: '2026-10-20T13:00:00.000Z', kind: 'trade' as const } }] }
    render(<TradeWindow state={{ available: true, data: quiet }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/core/trades?league=L-gang" nowIso={NOW} />)
    expect(screen.getByRole('region', { name: 'Trade window · when they move' })).toHaveAttribute('data-live', 'false')
    expect(screen.getByRole('link', { name: 'Grade it' })).toHaveAttribute('href', '/core/trades?league=L-gang')
    expect(screen.getByText(/Ask what it takes\./)).toBeInTheDocument()
  })

  it('says when a platform’s moves are not ingested, and when moves could not be named', () => {
    const espn = { ...PRESENCE, platform: 'espn', activityIngested: false, managers: [{ ...PRESENCE.managers[0], window: null, lastMove: null, moves: 0 }] }
    const { rerender } = render(<TradeWindow state={{ available: true, data: espn }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/core/trades" nowIso={NOW} />)
    expect(screen.getByText('@tashaR — no ESPN moves ingested yet')).toBeInTheDocument()
    expect(screen.getByText(/No moves are ingested for this league yet/)).toBeInTheDocument()

    rerender(<TradeWindow state={{ available: true, data: { ...PRESENCE, unattributed: 3 } }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/core/trades" nowIso={NOW} />)
    expect(screen.getByText('3 moves in this league could not be put to a name.')).toBeInTheDocument()
  })

  it('renders the reason, and nothing invented, when there is no one to pitch', () => {
    render(<TradeWindow state={{ available: false, reason: 'nobody has him here — he is a free agent, so there is nobody to pitch; claim him' }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/core/trades" nowIso={NOW} />)
    expect(screen.getByText(/nobody has him here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy the pitch' })).not.toBeInTheDocument()
  })
})
