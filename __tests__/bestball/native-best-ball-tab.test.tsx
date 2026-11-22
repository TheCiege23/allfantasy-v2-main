/**
 * The Best Ball tab for a league AllFantasy hosts reads what native scoring writes (the matchup
 * snapshot's started lineup and `league_player_weekly_scores`), labels a week provisional until it is
 * final, and says in one sentence why each other player did not count. It used to read the legacy
 * `teamWeekResult` / `weeklyScore` tables, which native scoring never writes, and showed nothing.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  leaguePlayerWeeklyScore: { findMany: vi.fn() },
  league: { findUnique: vi.fn() },
  teamWeekResult: { findMany: vi.fn(async () => []) },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'U1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
const weekRows = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/bestBallWeekRoster', () => ({ loadBestBallWeekRosterRows: weekRows }))
vi.mock('@/lib/redraft/scoringEngine', () => ({
  buildBestBallSlots: () => [
    { slot: 'QB', eligible: ['QB'], count: 1 },
    { slot: 'WR', eligible: ['WR'], count: 1 },
    { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 },
  ],
}))

import { benchReason, buildNativeLineupCard, snapshotSide } from '@/lib/bestball/nativeBestBallTab'
import { loadNativeBestBallTab } from '@/lib/bestball/nativeBestBallTabLoad'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'
import { GET as bestBallGET } from '@/app/api/leagues/[leagueId]/bestball/handler'

const SLOTS = [
  { slot: 'QB', eligible: ['QB'] },
  { slot: 'WR', eligible: ['WR'] },
  { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
]
const STARTERS = [
  { slot: 'QB', playerId: 'qb1', playerName: 'Quinn Back', points: 22 },
  { slot: 'WR', playerId: 'wr1', playerName: 'Wade Rec', points: 18 },
  { slot: 'FLEX', playerId: 'rb1', playerName: 'Rex Back', points: 12.5 },
]
const p = (playerId: string, position: string, slotType = 'BN') => ({ playerId, playerName: playerId.toUpperCase(), position, team: 'KC', slotType })

describe('why a player did not count', () => {
  it('names the starter he lost to, in the weakest slot he could have filled', () => {
    expect(benchReason(p('wr2', 'WR'), 9, STARTERS, SLOTS, new Set())).toBe('Scored 9.00; Rex Back scored 12.50 at FLEX, so Rex Back counted.')
  })
  it('says when no slot takes his position', () => {
    expect(benchReason(p('k1', 'K'), 11, STARTERS, SLOTS, new Set())).toBe('No lineup slot takes a K.')
  })
  it('says IR and reserve players cannot count, and players without stats are pending', () => {
    expect(benchReason(p('ir1', 'WR', 'IR'), 30, STARTERS, SLOTS, new Set())).toBe('On IR / reserve this week, so he cannot count.')
    expect(benchReason(p('wr3', 'WR'), null, STARTERS, SLOTS, new Set())).toBe('No stats yet for this week.')
    expect(benchReason(p('wr4', 'WR'), 5, STARTERS, SLOTS, new Set(['wr4']))).toBe('No stats yet for this week.')
  })
  it('explains a tie, and never contradicts the lineup when his stats arrived late', () => {
    expect(benchReason(p('te1', 'TE'), 12.5, STARTERS, SLOTS, new Set())).toMatch(/^Tied with Rex Back \(12\.50\) for FLEX/)
    expect(benchReason(p('te2', 'TE'), 20, STARTERS, SLOTS, new Set())).toMatch(/after the lineup was last updated/)
  })
})

describe('a lineup card', () => {
  const card = (over: Partial<Parameters<typeof buildNativeLineupCard>[0]> = {}) =>
    buildNativeLineupCard({
      rosterId: 'R1',
      teamName: 'Team One',
      side: { points: 52.5, allFinal: true, missingPlayerIds: [], bestBall: { assignments: STARTERS, unfilledSlots: [] } },
      matchupFinal: true,
      opponentPoints: 40,
      weekRoster: [p('qb1', 'QB'), p('wr1', 'WR'), p('rb1', 'RB'), p('wr2', 'WR'), p('k1', 'K')],
      pointsByPlayer: new Map([['wr2', 9], ['k1', 11]]),
      slots: SLOTS,
      ...over,
    })

  it('is final with a result once the matchup is final', () => {
    expect(card()).toMatchObject({ status: 'final', winLoss: 'W', totalPoints: 52.5 })
    expect(card().starters.map((s) => s.slot)).toEqual(['QB', 'WR', 'FLEX'])
    expect(card().bench.map((b) => b.playerId)).toEqual(['k1', 'wr2'])
  })

  it('is provisional, with no result, while the week is still open or a stat is missing', () => {
    expect(card({ matchupFinal: false })).toMatchObject({ status: 'provisional', winLoss: null })
    const missing = card({ side: { points: 52.5, allFinal: false, missingPlayerIds: ['wr2'], bestBall: { assignments: STARTERS } } })
    expect(missing).toMatchObject({ status: 'provisional', awaitingStats: 1 })
  })

  it('reports a slot nobody could fill', () => {
    expect(card({ side: { points: 40, allFinal: true, bestBall: { assignments: STARTERS.slice(0, 2), unfilledSlots: [{ slot: 'FLEX', seat: 1 }] } } }).unfilledSlots).toEqual(['FLEX'])
  })

  it('reads the snapshot side defensively', () => {
    expect(snapshotSide(null, 'home')).toBeNull()
    expect(snapshotSide({ redraftScoring: { away: { points: 3 } } }, 'away')).toEqual({ points: 3 })
  })
})

function arrangeNative() {
  vi.clearAllMocks()
  db.redraftSeason.findFirst.mockResolvedValue({ id: 'S1', season: 2026 })
  db.redraftRoster.findMany.mockResolvedValue([
    { id: 'R1', teamName: 'Team One', ownerName: 'a', wins: 1, losses: 0, ties: 0, pointsFor: 52.5, pointsAgainst: 40 },
    { id: 'R2', teamName: null, ownerName: 'Owner Two', wins: 0, losses: 1, ties: 0, pointsFor: 40, pointsAgainst: 52.5 },
  ])
  db.redraftMatchup.findMany.mockResolvedValue([
    {
      id: 'M1', week: 3, status: 'final', homeRosterId: 'R1', awayRosterId: 'R2', homeScore: 52.5, awayScore: 40,
      lineupSnapshots: { redraftScoring: { home: { points: 52.5, allFinal: true, bestBall: { assignments: STARTERS } }, away: { points: 40, allFinal: true, bestBall: { assignments: [] } } } },
    },
  ])
  weekRows.mockResolvedValue([
    { rosterId: 'R1', playerId: 'qb1', playerName: 'Quinn Back', position: 'QB', team: 'KC', slotType: 'QB' },
    { rosterId: 'R1', playerId: 'wr2', playerName: 'Bench Wideout', position: 'WR', team: 'KC', slotType: 'BN' },
  ])
  db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([{ playerId: 'wr2', points: 9 }])
}

describe('loading the tab for a hosted league', () => {
  beforeEach(() => arrangeNative())

  const load = (platform: string | null = 'manual') =>
    loadNativeBestBallTab({ leagueId: 'L1', platform, sport: 'NFL', settings: {}, requestedWeek: Number.NaN, rankBy: 'record' })

  it('builds the cards from the matchup snapshot and the week roster', async () => {
    const out = await load()
    expect(out?.body.weeksAvailable).toEqual([3])
    expect(out?.body.selectedWeek).toBe(3)
    const r1 = out!.body.lineups.find((l) => l.rosterId === 'R1')!
    expect(r1).toMatchObject({ teamName: 'Team One', status: 'final', winLoss: 'W' })
    expect(r1.bench[0]).toMatchObject({ playerId: 'wr2', points: 9 })
    expect(out!.body.standings.map((s) => s.teamName)).toEqual(['Team One', 'Owner Two'])
    expect(weekRows).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ week: 3, platform: 'manual' }))
  })

  it('an imported league, or a league with no native season, keeps the legacy reads', async () => {
    expect(await load('sleeper')).toBeNull()
    db.redraftSeason.findFirst.mockResolvedValue(null)
    expect(await load()).toBeNull()
  })
})

describe('the API route', () => {
  beforeEach(() => arrangeNative())
  it('serves a hosted league from native scoring and never reads the legacy tables', async () => {
    db.league.findUnique.mockResolvedValue({
      id: 'L1', name: 'L', sport: 'NFL', season: 2026, bestBallMode: true, settings: {}, bbMatchupFormat: 'h2h', bbScoringPeriod: 'weekly',
      platform: 'manual', rosters: [], teams: [],
    })
    const req = { nextUrl: new URL('http://localhost/api/leagues/L1/bestball?week=3') } as never
    const res = await bestBallGET(req, { params: Promise.resolve({ leagueId: 'L1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.source).toBe('native')
    expect(body.lineups.find((l: { rosterId: string }) => l.rosterId === 'R1')).toMatchObject({ status: 'final', winLoss: 'W' })
    expect(db.teamWeekResult.findMany).not.toHaveBeenCalled()
  })

  it("states the league's own starter seats in its profile, not the sport default (finding #22)", async () => {
    db.league.findUnique.mockResolvedValue({
      id: 'L1', name: 'L', sport: 'NFL', season: 2026, bestBallMode: true, bbMatchupFormat: 'h2h', bbScoringPeriod: 'weekly',
      settings: { roster: { config: { sections: [{ key: 'primary', slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, BN: 8 } }] } } },
      platform: 'manual', rosters: [], teams: [],
    })
    const req = { nextUrl: new URL('http://localhost/api/leagues/L1/bestball?week=3') } as never
    const body = await (await bestBallGET(req, { params: Promise.resolve({ leagueId: 'L1' }) })).json()
    const slots = body.league.profile.lineupSlots as Array<{ code: string; count: number }>
    expect(slots.reduce((n, s) => n + s.count, 0)).toBe(10)
    expect(slots.map((s) => s.code)).toContain('SUPERFLEX')
  })
})

describe('the tab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the provisional label, the explainer and why a player did not count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          league: { id: 'L1', name: 'L', sport: 'NFL', season: 2026, summary: 'Best Ball', settings: { mode: 'standard', draftMode: 'snake', contestStructure: 'season', matchupFormat: 'h2h', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 0 }, profile: { label: 'NFL', scoringPeriod: 'weekly', recommendedRosterSize: 18, lineupSlots: [], notes: [] } },
          source: 'native',
          selectedWeek: 3,
          weeksAvailable: [3],
          lineups: [
            {
              rosterId: 'R1', teamName: 'Team One', totalPoints: 52.5, winLoss: null, status: 'provisional', awaitingStats: 1, unfilledSlots: ['TE'],
              starters: [{ playerId: 'qb1', name: 'Quinn Back', position: 'QB', team: 'KC', points: 22, slot: 'QB' }],
              bench: [{ playerId: 'wr2', name: 'Bench Wideout', position: 'WR', team: 'KC', points: 9, reason: 'Scored 9; Wade Rec scored 18 at WR, so Wade Rec counted.' }],
            },
          ],
          rosterComposition: [],
          standings: [],
          history: [],
        }),
      })),
    )
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await waitFor(() => expect(screen.getByTestId('bestball-lineup-status').textContent).toBe('Provisional'))
    expect(screen.getByTestId('bestball-lineup-explainer').textContent).toMatch(/counts automatically/)
    expect(screen.getByText(/Waiting on stats for 1 player/)).toBeTruthy()
    expect(screen.getByText('No eligible player on the roster')).toBeTruthy()
    fireEvent.click(screen.getByText(/Didn.t count \(1\)/))
    expect(screen.getByText('Scored 9; Wade Rec scored 18 at WR, so Wade Rec counted.')).toBeTruthy()
  })
})
