import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuillotineChopPreview } from '@/components/guillotine/GuillotineChopPreview'
import { buildChopPreview } from '@/lib/guillotine/chopPreview'
import { DEFAULT_ADVANCED } from '@/lib/guillotine/chopSchedule'

const preview = buildChopPreview({
  week: 2, weekState: 'live', eliminationStartWeek: 1, eliminationEndWeek: 20, teamsPerChop: 1, advanced: DEFAULT_ADVANCED,
  endgame: { format: 'last_team_standing', threshold: 1 }, tiebreakerOrder: ['season_points'], dangerMarginPoints: 10,
  faabOnChop: 'split', rosterReleaseTiming: 'next_waiver_run', previousWeek: [], draftSlotByRoster: new Map(),
  blockers: ['Team Z can’t be matched to its league roster, so the chop will refuse to run until it is fixed.'],
  teams: [
    { rosterId: 'a', name: 'Hoop Dreams', periodPoints: 150, seasonPointsCumul: 150, faab: 50, playerCount: 9 },
    { rosterId: 'b', name: 'Bench Mob', periodPoints: 101, seasonPointsCumul: 101, faab: 50, playerCount: 9 },
    { rosterId: 'c', name: 'Ice Cold', periodPoints: 96, seasonPointsCumul: 96, faab: 40, playerCount: 8 },
  ],
})

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('GuillotineChopPreview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks the server for the preview and shows who goes, the danger zone, FAAB, waivers and the chat post', async () => {
    const fetchMock = mockFetch(200, preview)
    render(<GuillotineChopPreview leagueId="L1" />)
    fireEvent.click(screen.getByTestId('guillotine-chop-preview-open'))
    await waitFor(() => screen.getByTestId('guillotine-chop-preview-body'))
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/L1/guillotine/summary?view=preview', expect.anything())
    expect(screen.getByTestId('guillotine-chop-preview-headline').textContent).toBe('If week 2 ended now, Ice Cold would be chopped.')
    expect(screen.getByTestId('guillotine-chop-preview-row-c').getAttribute('data-status')).toBe('chopped')
    expect(screen.getByTestId('guillotine-chop-preview-row-b').textContent).toContain('Danger zone (+5.0)')
    expect(screen.getByTestId('guillotine-chop-preview-row-b').textContent).toContain('FAAB +$20')
    expect(screen.getByTestId('guillotine-chop-preview-faab').textContent).toBe('$40 is shared by the 2 survivors.')
    expect(screen.getByText(/8 players go to waivers/)).toBeTruthy()
    expect(screen.getByTestId('guillotine-chop-preview-announcement').textContent).toBe('Week 2 — Ice Cold has been chopped. Their roster has been released to waivers.')
    expect(screen.getByTestId('guillotine-chop-preview-blockers').textContent).toContain('Team Z')
  })

  it('a free commissioner gets the AF Commissioner upgrade line', async () => {
    mockFetch(402, { error: 'The chop preview is part of AF Commissioner.', upgradePath: '/commissioner-upgrade' })
    render(<GuillotineChopPreview leagueId="L1" />)
    fireEvent.click(screen.getByTestId('guillotine-chop-preview-open'))
    const locked = await screen.findByTestId('guillotine-chop-preview-locked')
    expect(locked.textContent).toContain('part of AF Commissioner')
    expect(locked.querySelector('a')!.getAttribute('href')).toBe('/commissioner-upgrade')
    expect(screen.queryByTestId('guillotine-chop-preview-body')).toBeNull()
  })
})
