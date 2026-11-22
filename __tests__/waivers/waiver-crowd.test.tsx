import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

/*
 * Rostered % and adds this week on the Worth adding rows (lib/waivers/waiverCrowd.ts): read from
 * Postgres, shown only above a population floor, and the population is named — synced Sleeper
 * leagues, not all of Sleeper.
 */

const queryRaw = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }))

import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'
import { clearWaiverCrowdCache, loadWaiverCrowd } from '@/lib/waivers/waiverCrowd'
import { CROWD_MIN_LEAGUES, crowdLine, type WaiverCrowd } from '@/lib/waivers/waiverCrowdLine'

const sqlText = (call: unknown[]) => (call[0] as { strings?: string[]; sql?: string }).strings?.join('?') ?? String((call[0] as { sql?: string }).sql)

beforeEach(() => {
  queryRaw.mockReset()
  clearWaiverCrowdCache()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('crowdLine', () => {
  const crowd: WaiverCrowd = {
    syncedLeagues: 40,
    activeLeagues: 25,
    through: null,
    players: { '1': { rosteredIn: 25, addedIn: 6 }, '2': { rosteredIn: 0, addedIn: 0 } },
  }

  it('turns counts into a rounded share and an add count', () => {
    expect(crowdLine(crowd, '1')).toEqual({ rosteredPct: 63, addedIn: 6, syncedLeagues: 40, activeLeagues: 25 })
  })

  it('shows 0% rostered, but never "+0 adds"', () => {
    expect(crowdLine(crowd, '2')).toEqual({ rosteredPct: 0, addedIn: null, syncedLeagues: 40, activeLeagues: 25 })
  })

  it(`shows nothing below ${CROWD_MIN_LEAGUES} leagues: a share of two is not a fact about the player`, () => {
    expect(crowdLine({ ...crowd, syncedLeagues: 2, activeLeagues: 2 }, '1')).toBeNull()
  })

  it('shows nothing for a player without a Sleeper id or without a row', () => {
    expect(crowdLine(crowd, null)).toBeNull()
    expect(crowdLine(crowd, '99')).toBeNull()
    expect(crowdLine(null, '1')).toBeNull()
  })
})

describe('loadWaiverCrowd', () => {
  it('reads both counts from Postgres, NFL Sleeper leagues only, by the measured transaction rules', async () => {
    queryRaw
      .mockResolvedValueOnce([{ sid: '1', leagues: 12, total: 30 }, { sid: '2', leagues: 3, total: 30 }])
      .mockResolvedValueOnce([
        { sid: '1', leagues: 5, active_leagues: 20, newest: new Date('2026-11-04T10:00:00Z') },
        { sid: '2', leagues: 0, active_leagues: 20, newest: new Date('2026-11-04T10:00:00Z') },
      ])
    const out = await loadWaiverCrowd(['2', '1', '1', 'bad id!'], 2026, new Date('2026-11-05T00:00:00Z'))
    expect(out).toEqual({
      syncedLeagues: 30,
      activeLeagues: 20,
      through: '2026-11-04T10:00:00.000Z',
      players: { '1': { rosteredIn: 12, addedIn: 5 }, '2': { rosteredIn: 3, addedIn: 0 } },
    })
    const [rosterSql, addSql] = queryRaw.mock.calls.map(sqlText)
    // One Sleeper league read once, from the copy whose rosters were written last.
    expect(rosterSql).toContain(`max(r."updatedAt") DESC`)
    expect(rosterSql).toContain(`r."playerData"->'players'`)
    expect(rosterSql).toContain(`l.sport::text = 'NFL'`)
    // The added player is payload.adds and the time payload.createdAt (lib/core-app/trendingAdds.ts).
    expect(addSql).toContain(`t.payload->'adds'`)
    expect(addSql).toContain(`(t.payload->>'createdAt')::timestamptz`)
    expect(addSql).toContain(`lower(l.platform) = 'sleeper'`)
  })

  it('a failed read is null and is not cached as "nobody rosters anyone"', async () => {
    queryRaw.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([])
    expect(await loadWaiverCrowd(['1'], 2026)).toBeNull()
    queryRaw.mockResolvedValueOnce([{ sid: '1', leagues: 1, total: 9 }]).mockResolvedValueOnce([])
    expect((await loadWaiverCrowd(['1'], 2026))?.players['1'].rosteredIn).toBe(1)
  })

  it('reads nothing for no ids', async () => {
    expect(await loadWaiverCrowd([], 2026)).toBeNull()
    expect(queryRaw).not.toHaveBeenCalled()
  })
})

describe('Worth adding rows', () => {
  const board = (crowd: WaiverCrowd | null) => ({
    state: 'ok',
    season: '2026',
    week: 9,
    currentLineupPoints: 121.9,
    candidates: [{ sleeperId: '1', name: 'New York Giants', position: 'DEF', team: 'NYG', projectedPoints: 7.7, gain: 1, displaces: null }],
    notes: [],
    crowd,
  })
  const mockFetch = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })) as never)

  it('show the rostered share and the adds, with the population in the title', async () => {
    mockFetch(board({ syncedLeagues: 40, activeLeagues: 25, through: null, players: { '1': { rosteredIn: 10, addedIn: 6 } } }))
    render(<WaiverLineupBoard leagueId="lg1" />)
    const rostered = await screen.findByText('25% rostered')
    expect(rostered.getAttribute('title')).toMatch(/40 Sleeper leagues synced to AllFantasy/)
    expect(screen.getByText('+6 adds').getAttribute('title')).toMatch(/6 of the 25 synced Sleeper leagues/)
  })

  it('show neither below the population floor', async () => {
    mockFetch(board({ syncedLeagues: 2, activeLeagues: 2, through: null, players: { '1': { rosteredIn: 2, addedIn: 2 } } }))
    render(<WaiverLineupBoard leagueId="lg1" />)
    await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
    expect(screen.queryByText(/% rostered/)).toBeNull()
    expect(screen.queryByText(/adds$/)).toBeNull()
  })
})
