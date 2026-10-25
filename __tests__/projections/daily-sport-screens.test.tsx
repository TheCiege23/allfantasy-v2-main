/**
 * The two screens render the daily-sport AF projection and position rank the routes stamp on a row
 * (lib/projections/dailySportOutlook.ts), and name the projection's basis.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'daily' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))

import WaiverPlayerRow from '@/components/waiver-wire/WaiverPlayerRow'
import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { AF_FORM_PROJECTION_LABEL, AF_FORM_PROJECTION_SOURCE } from '@/lib/projections/dailySportFormLabels'

afterEach(() => vi.unstubAllGlobals())

const wire = (id: string, name: string, position: string, projectedPoints: number | null, extra: Record<string, unknown> = {}) => ({
  id, name, position, team: 'Denver Nuggets', sport: 'NBA', headshotUrl: null, imageUrl: null, teamLogoUrl: null, injuryStatus: null,
  fantasyPointsPerGame: null, projectedPoints, adp: null, aiAdp: null, aiAdpSampleSize: null, collegeClass: '', collegeClassLabel: null,
  soccerLeague: null, nflRookieIsRookie: null, nflRookieSource: null, lowConfidence: false, profileSource: null, statsSource: null,
  projectionsSource: null, normalizedStats: {}, normalizedProjections: {}, product: { unified: {}, yearsExp: null },
  ...extra,
})
const af = { projectionsSource: AF_FORM_PROJECTION_SOURCE }

describe('waiver row', () => {
  it('shows the AF projection, its label and the position rank', () => {
    const row = adaptWaiverWirePlayer(wire('p1', 'Nikola Jokic', 'C', 165.4, { ...af, positionRankLabel: 'C1' }) as never)
    expect(row.displayProjection).toBe(165.4)
    expect(row.displayPositionRank).toBe('C1')
    expect(row.projectionSourceLabel).toBe(AF_FORM_PROJECTION_LABEL)
    render(
      <WaiverPlayerRow
        player={{ id: 'p1', name: row.name, position: row.position, team: row.team, projectedPoints: row.displayProjection, positionRank: row.displayPositionRank, projectionSourceLabel: row.projectionSourceLabel }}
        sport="NBA"
        onAddClick={() => {}}
      />,
    )
    expect(screen.getByTestId('waiver-player-projection-p1').textContent).toContain('165.4')
    expect(screen.getByTestId('waiver-player-position-rank-p1').textContent).toContain('C1')
    expect(screen.getByText(AF_FORM_PROJECTION_LABEL)).toBeTruthy()
  })

  it('without a position rank the overall rank shows, as before (NFL unchanged)', () => {
    render(<WaiverPlayerRow player={{ id: 'p2', name: 'Brock Bowers', position: 'TE', team: 'LV', rank: 12 }} sport="NFL" onAddClick={() => {}} />)
    expect(screen.queryByTestId('waiver-player-position-rank-p2')).toBeNull()
    expect(screen.getByText('#12')).toBeTruthy()
  })
})

describe('lineup screen', () => {
  it('shows each player\'s AF projection and position rank, and says what the projection is', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/league/roster')) {
          return new Response(
            JSON.stringify({
              rosterId: 'ros1', leagueWeek: 1, canEditLineup: true,
              starterSlots: [{ index: 0, label: 'C', allowedPositions: ['C'], isFlexible: false }],
              roster: { lineup_sections: { starters: [{ id: '907' }], bench: [{ id: '74' }], ir: [], taxi: [], devy: [] } },
              unifiedRoster: [
                wire('907', 'Nikola Jokic', 'C', 165.4, { ...af, positionRankLabel: 'C1' }),
                wire('74', 'Bobby Portis', 'C', 0, { ...af, positionRankLabel: 'C34', injuryStatus: 'Out' }),
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )
    const league = { id: 'lg1', name: 'Hoops', sport: 'NBA', season: 2026, platform: 'allfantasy', settings: {} } as unknown as UserLeague
    const team = { id: 't', teamName: 'Mine', wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 1 } as never
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByText('Nikola Jokic')).toBeTruthy()
    expect(screen.getByTestId('lineup-position-rank-907').textContent).toContain('C1')
    expect(screen.getByTestId('lineup-position-rank-74').textContent).toContain('C34')
    expect(screen.getByText('165.4')).toBeTruthy()
    expect(screen.getByText('Proj 165.4')).toBeTruthy()
    expect(screen.getByTestId('lineup-af-projection-note').textContent).toMatch(/AF projection from recent form/)
  })
})
