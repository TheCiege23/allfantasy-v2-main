import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DraftTeamStrip } from '@/components/app/draft-room/DraftTeamStrip'
import { isPlaceholderSeatName, OPEN_SEAT_LABEL, seatDisplayName } from '@/lib/draft-room/seatLabel'

/**
 * Empty imported seats read "Unknown" on the draft board (2026-11-17): the KBI Tournament Waiting
 * List had 11 of 12 seats that way, the KBI Championship 2 of 8. Each one is an empty Sleeper team
 * (orphan roster, no owner), which the import names "Unknown". The board now calls it an open seat.
 */

describe('seat names', () => {
  it('treats blank and "Unknown" names as an empty seat', () => {
    for (const n of [null, undefined, '', '  ', 'Unknown', 'unknown', 'Unknown team', 'Unknown Manager']) {
      expect(isPlaceholderSeatName(n), String(n)).toBe(true)
    }
  })

  it('keeps every real name, including ones that merely contain the word', () => {
    for (const n of ['kingbuffalo', 'Team 4', 'Unknown Soldiers FC', 'The Unknowns']) {
      expect(isPlaceholderSeatName(n), n).toBe(false)
    }
  })

  it('takes the first real name, else "Open seat"', () => {
    expect(seatDisplayName('Unknown', 'CEH125633')).toBe('CEH125633')
    expect(seatDisplayName(' GOLDFINGER 3.0 ', 'AMAJZNER')).toBe('GOLDFINGER 3.0')
    expect(seatDisplayName('Unknown', 'Unknown', '')).toBe(OPEN_SEAT_LABEL)
  })
})

describe('the draft team strip', () => {
  it('labels an empty imported seat "Open seat" and leaves real managers alone', () => {
    render(
      <DraftTeamStrip
        teamCount={2}
        slotOrder={[
          { slot: 1, rosterId: 'r1', displayName: 'kingbuffalo' },
          { slot: 2, rosterId: 'r2', displayName: 'Unknown' },
        ]}
        teamMetaByRoster={{
          r1: { rosterId: 'r1', teamName: 'kingbuffalo' },
          r2: { rosterId: 'r2', teamName: 'Unknown', ownerName: 'Unknown', isOrphan: true },
        }}
      />,
    )
    expect(screen.getAllByText('kingbuffalo').length).toBeGreaterThan(0)
    expect(screen.getAllByText(OPEN_SEAT_LABEL).length).toBeGreaterThan(0)
    expect(screen.queryByText('Unknown')).toBeNull()
    // The empty seat's avatar is a plain icon, not the initials of "Open seat"; a real manager keeps theirs.
    expect(screen.getAllByTestId('draft-strip-open-seat-icon')).toHaveLength(1)
    expect(screen.queryByText('OS')).toBeNull()
    expect(screen.getByText('K')).toBeTruthy()
  })
})
