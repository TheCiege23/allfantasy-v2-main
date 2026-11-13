/**
 * The Best Ball tab's "the draft has not finished" notice, for the CURRENT season.
 *
 * It used to show only when a hosted league had no native season at all. A renewed league whose new
 * season's draft is still open has last season's native season, so the tab loaded that and showed last
 * season's lineups with nothing saying this season has not been scored. The notice now shows whenever the
 * league's current season has no native season yet, and names the season the cards below belong to.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  draftSession: { findFirst: vi.fn() },
  teamWeekResult: { findMany: vi.fn(async () => []) },
  weeklyScore: { findMany: vi.fn(async () => []) },
  fantasyStanding: { findMany: vi.fn(async () => []) },
  sportsPlayer: { findMany: vi.fn(async () => []) },
}))
const nativeLoad = vi.hoisted(() => ({ loadNativeBestBallTab: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'U1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralSettingsLockReason: vi.fn(async () => null) }))
vi.mock('@/lib/bestball/nativeBestBallTabLoad', () => nativeLoad)

import { currentSeasonAwaitsDraft, draftPendingNotice } from '@/lib/bestball/nativeBestBallTab'
import { GET as bestBallGET } from '@/app/api/leagues/[leagueId]/bestball/handler'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'

const leagueRow = (over: Record<string, unknown> = {}) => ({
  id: 'L1', name: 'L', sport: 'NFL', season: 2027, leagueSize: 12, bestBallMode: true, settings: {}, bbMatchupFormat: 'h2h',
  bbScoringPeriod: 'weekly', platform: 'manual', rosters: [], teams: [], ...over,
})
const card = { rosterId: 'R1', teamName: 'Team A', totalPoints: 101.5, winLoss: null, status: 'final', starters: [], bench: [] }
const nativeSeason = (season: number) => ({
  season,
  body: { selectedWeek: 17, weeksAvailable: [16, 17], lineups: [card], rosterComposition: [], standings: [], history: [] },
})
const get = async () => {
  const req = { nextUrl: new URL('http://localhost/api/leagues/L1/bestball') } as never
  const res = await bestBallGET(req, { params: Promise.resolve({ leagueId: 'L1' }) })
  return res.json()
}

describe('which season the notice is about', () => {
  it('awaits a draft only when the current season has no native season', () => {
    expect(currentSeasonAwaitsDraft(2027, null)).toBe(true)
    expect(currentSeasonAwaitsDraft(2027, 2026)).toBe(true)
    expect(currentSeasonAwaitsDraft(2027, 2027)).toBe(false)
    expect(currentSeasonAwaitsDraft(null, 2026)).toBe(false)
  })

  it('names the older season the lineups below belong to', () => {
    expect(draftPendingNotice('in_progress', 2026)).toBe(
      'The draft is still running. Best ball scores begin after the draft finishes, because no team has a roster until then. The lineups below are from the 2026 season.',
    )
    expect(draftPendingNotice('completed', 2026)).toBeNull()
  })
})

describe('GET /api/leagues/:id/bestball for a renewed league mid-draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
  })

  it("says the current season's draft is open while showing last season's native data", async () => {
    db.league.findUnique.mockResolvedValue(leagueRow({ season: 2027 }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(nativeSeason(2026))
    const body = await get()
    expect(body.source).toBe('native')
    expect(body.league.season).toBe(2026)
    expect(body.lineups).toHaveLength(1)
    expect(body.draftNotice).toMatch(/^The draft is still running\..*from the 2026 season\.$/)
  })

  it('says nothing once the current season has its own native season (its draft finished)', async () => {
    db.league.findUnique.mockResolvedValue(leagueRow({ season: 2027 }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(nativeSeason(2027))
    const body = await get()
    expect(body.draftNotice).toBeNull()
    expect(db.draftSession.findFirst).not.toHaveBeenCalled()
  })

  it('says nothing when the newer draft is completed (season row not written yet), or for an imported league', async () => {
    db.draftSession.findFirst.mockResolvedValue({ status: 'completed' })
    db.league.findUnique.mockResolvedValue(leagueRow({ season: 2027 }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(nativeSeason(2026))
    expect((await get()).draftNotice).toBeNull()

    db.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
    db.league.findUnique.mockResolvedValue(leagueRow({ season: 2027, platform: 'sleeper' }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(null)
    expect((await get()).draftNotice).toBeNull()
  })

  it('still says so for a hosted league with no native season at all', async () => {
    db.league.findUnique.mockResolvedValue(leagueRow({ season: 2026 }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(null)
    expect((await get()).draftNotice).toBe(draftPendingNotice('in_progress'))
  })
})

describe('the tab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows the notice above last season's lineup cards, not only when the tab is empty", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          league: { id: 'L1', name: 'L', sport: 'NFL', season: 2026, summary: 'Best Ball', settings: { mode: 'standard', draftMode: 'snake', contestStructure: 'season', matchupFormat: 'h2h', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 0 }, profile: { label: 'NFL', scoringPeriod: 'weekly', recommendedRosterSize: 18, lineupSlots: [], notes: [] } },
          source: 'native',
          selectedWeek: 17,
          weeksAvailable: [16, 17],
          draftNotice: draftPendingNotice('in_progress', 2026),
          lineups: [card],
          rosterComposition: [],
          standings: [],
          history: [],
        }),
      })),
    )
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await waitFor(() => expect(screen.getByTestId('bestball-draft-pending').textContent).toMatch(/from the 2026 season/))
    expect(screen.getAllByTestId('bestball-lineup-card')).toHaveLength(1)
  })
})
