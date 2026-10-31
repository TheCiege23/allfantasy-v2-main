import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * 2026-10-26: an Android user in a live NBA draft could not find the board from Draft HQ.
 * Both Draft HQ screens now carry a direct link into the room, via the `/league/[id]/draft`
 * resolver.
 */

import DraftHq, { draftRoomCtaLabel } from '@/components/core-app/screens/DraftHq'
import DraftHQ, { type DraftHQData } from '@/components/draft-hq/DraftHQ'
import type { DraftHqData } from '@/lib/core-app/draftHq'

afterEach(cleanup)

const missing = (reason: string) => ({ available: false as const, reason })

function coreData(status: string): DraftHqData {
  return {
    league: { id: 'nba-1', name: 'Hoops', platform: 'allfantasy', format: 'redraft' },
    session: {
      available: true,
      data: { status, draftType: 'snake', rounds: 13, teamCount: 10, yourSlot: 4 },
    },
    pickSlots: missing('picks'),
    madePicks: missing('made'),
    board: missing('board'),
    grades: missing('grades'),
    lottery: missing('lottery'),
    queue: missing('queue'),
    keepers: missing('keepers'),
  } as DraftHqData
}

describe('core Draft HQ — the way into the draft room', () => {
  it('links a live draft straight to the room with "Join live draft"', () => {
    render(<DraftHq data={coreData('in_progress')} />)
    const link = screen.getByTestId('draft-hq-enter-room')
    expect(link.getAttribute('href')).toBe('/league/nba-1/draft')
    expect(link.textContent).toBe('Join live draft')
    expect(link.getAttribute('data-live')).toBe('true')
  })

  it('labels each status', () => {
    expect(draftRoomCtaLabel('pre_draft')).toBe('Enter draft room')
    expect(draftRoomCtaLabel('paused')).toBe('Join live draft')
    expect(draftRoomCtaLabel('completed')).toBe('Open draft board')
  })

  it('shows no room link when there is no draft session', () => {
    render(<DraftHq data={{ ...coreData('pre_draft'), session: missing('none') } as DraftHqData} />)
    expect(screen.queryByTestId('draft-hq-enter-room')).toBeNull()
  })
})

describe('league Draft HQ — the way into the draft room', () => {
  it('links to the draft room resolver', () => {
    const data: DraftHQData = {
      leagueId: 'nba-1',
      leagueName: 'Hoops',
      platform: 'allfantasy',
      settings: { leagueType: 'redraft', teamCount: 10, orderMode: 'manual', lotteryPickCount: null },
      lottery: null,
      queue: [],
      lastMock: null,
      pickInventory: [],
      positionalNeed: null,
      queueConfidence: { status: 'unavailable', reason: 'no_queue' },
      viewerHasRoster: true,
    }
    render(<DraftHQ data={data} />)
    expect(screen.getByTestId('draft-hq-enter-room').getAttribute('href')).toBe('/league/nba-1/draft')
  })
})
