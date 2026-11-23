/**
 * The Best Ball tab and War Room panel after the 2026-11-23 audit: your team first, real players on Rosters,
 * one History grid with season totals, no win-loss record in a points league, no repeated settings line, and a
 * War Room panel that hides the tools a draft-only league turns off. Light mode is guarded at the source: no
 * hard-coded hex colour may sit in a className (they washed out on white).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  leaguePlayerWeeklyScore: { findMany: vi.fn() },
}))
const weekRows = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/bestBallWeekRoster', () => ({ loadBestBallWeekRosterRows: weekRows }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ buildBestBallSlots: () => [{ slot: 'QB', eligible: ['QB'], count: 1 }] }))

const client = vi.hoisted(() => ({
  fetchBestBallWarRoomState: vi.fn(),
  fetchBestBallUpside: vi.fn(), fetchBestBallDraftPlan: vi.fn(), fetchBestBallStacks: vi.fn(), fetchBestBallRisk: vi.fn(),
  fetchBestBallWaivers: vi.fn(), analyzeBestBallWarRoomTrade: vi.fn(), findBestBallWarRoomTrades: vi.fn(), askBestBallWarRoom: vi.fn(),
}))
vi.mock('@/lib/best-ball-war-room/client', () => client)
vi.mock('@/components/subscription/FeatureGate', () => ({ FeatureGate: () => null }))

import { loadNativeBestBallTab } from '@/lib/bestball/nativeBestBallTabLoad'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'
import { BestBallWarRoomPanel } from '@/app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
/** className strings only, so a hex colour in a comment or a data value does not count. */
const classHex = (src: string) => (src.match(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g) ?? []).filter((c) => /#[0-9a-fA-F]{3,8}\b/.test(c))

describe('the native read: which team is yours, and who is on each roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'S1', season: 2026 })
    db.redraftRoster.findMany.mockResolvedValue([
      { id: 'R1', ownerId: 'U-other', managerUserId: null, teamName: 'Team One', ownerName: 'a', wins: 0, losses: 0, ties: 0, pointsFor: 50, pointsAgainst: 0 },
      { id: 'R2', ownerId: 'key-2', managerUserId: 'U-me', teamName: 'My Second', ownerName: 'b', wins: 0, losses: 0, ties: 0, pointsFor: 40, pointsAgainst: 0 },
      { id: 'R3', ownerId: 'U-me', managerUserId: null, teamName: 'My First', ownerName: 'c', wins: 0, losses: 0, ties: 0, pointsFor: 30, pointsAgainst: 0 },
    ])
    db.redraftMatchup.findMany.mockResolvedValue([{ id: 'M1', week: 2, status: 'final', homeRosterId: 'R1', awayRosterId: null, homeScore: 50, awayScore: 0, lineupSnapshots: null }])
    weekRows.mockResolvedValue([
      { rosterId: 'R3', playerId: 'p1', playerName: 'Josh Allen', position: 'QB', team: 'BUF', slotType: 'BN' },
      { rosterId: 'R3', playerId: 'p2', playerName: 'Puka Nacua', position: 'WR', team: 'LAR', slotType: 'IR' },
    ])
    db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([])
  })

  it('names the viewer\'s rosters (owned, or managed as a second team) and lists each roster\'s players', async () => {
    const out = await loadNativeBestBallTab({ leagueId: 'L1', platform: 'manual', sport: 'NFL', settings: {}, requestedWeek: Number.NaN, rankBy: 'points', viewerUserId: 'U-me' })
    expect(out!.body.viewerRosterIds.sort()).toEqual(['R2', 'R3'])
    const mine = out!.body.rosterComposition.find((r) => r.rosterId === 'R3')!
    expect(mine.playerCount).toBe(2)
    expect(mine.players).toEqual([
      { playerId: 'p1', name: 'Josh Allen', position: 'QB', team: 'BUF', reserve: false },
      { playerId: 'p2', name: 'Puka Nacua', position: 'WR', team: 'LAR', reserve: true },
    ])
  })
})

const lineup = (rosterId: string, teamName: string, totalPoints: number) => ({
  rosterId, teamName, totalPoints, winLoss: null, status: 'final',
  starters: [{ playerId: `${rosterId}-qb`, name: `${teamName} QB`, position: 'QB', team: 'KC', points: totalPoints, slot: 'QB' }],
  bench: [],
})
const body = {
  league: {
    id: 'L1', name: 'L', sport: 'NFL', season: 2026,
    summary: 'Underdog-style Best Ball · snake draft · cumulative points scoring · weekly lineups · waivers off, trades off, manual subs off',
    settings: { mode: 'underdog', draftMode: 'snake', contestStructure: 'season_long', matchupFormat: 'cumulative', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 2 },
    profile: { label: 'NFL', scoringPeriod: 'weekly', recommendedRosterSize: 18, lineupSlots: [], notes: [] },
  },
  source: 'native',
  selectedWeek: 2,
  weeksAvailable: [1, 2],
  viewerRosterIds: ['R3'],
  lineups: [lineup('R1', 'Top Dogs', 150), lineup('R2', 'Middle Men', 120), lineup('R3', 'Spike Week Society', 110)],
  rosterComposition: [
    { rosterId: 'R1', teamName: 'Top Dogs', playerCount: 1, players: [{ playerId: 'x', name: 'Ja\'Marr Chase', position: 'WR', team: 'CIN', reserve: false }] },
    { rosterId: 'R3', teamName: 'Spike Week Society', playerCount: 2, players: [{ playerId: 'a', name: 'Josh Allen', position: 'QB', team: 'BUF', reserve: false }, { playerId: 'b', name: 'Puka Nacua', position: 'WR', team: 'LAR', reserve: true }] },
  ],
  standings: [
    { rosterId: 'R1', rank: 1, teamName: 'Top Dogs', wins: 0, losses: 0, ties: 0, pointsFor: 300, pointsAgainst: 0 },
    { rosterId: 'R3', rank: 2, teamName: 'Spike Week Society', wins: 0, losses: 0, ties: 0, pointsFor: 220, pointsAgainst: 0 },
  ],
  history: [
    { rosterId: 'R1', week: 1, totalPoints: 150, status: 'final' }, { rosterId: 'R1', week: 2, totalPoints: 150, status: 'final' },
    { rosterId: 'R3', week: 1, totalPoints: 110, status: 'final' }, { rosterId: 'R3', week: 2, totalPoints: 110, status: 'provisional' },
  ],
}

describe('the Best Ball tab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('short view names, no "Sport:" line and no repeated settings line', async () => {
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await screen.findAllByTestId('bestball-lineup-card')
    expect(['lineup', 'roster', 'contest', 'history'].map((id) => screen.getByTestId(`bestball-sub-${id}`).textContent)).toEqual(['Lineups', 'Rosters', 'Standings', 'History'])
    expect(document.body.textContent).not.toMatch(/Sport:/)
    expect(document.body.textContent).not.toContain(body.league.summary)
  })

  it('Lineups: your team first and open, marked as yours; every other team a ranked row', async () => {
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    const cards = await screen.findAllByTestId('bestball-lineup-card')
    expect(cards).toHaveLength(1)
    expect(within(cards[0]!).getByText('Spike Week Society')).toBeTruthy()
    expect(within(cards[0]!).getByText(/Your team/)).toBeTruthy()
    expect(within(cards[0]!).getByText(/3rd of 3/)).toBeTruthy()
    const rows = screen.getAllByTestId('bestball-lineup-row')
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringMatching(/^1\s*Top Dogs.*150\.00/),
      expect.stringMatching(/^2\s*Middle Men.*120\.00/),
    ])
  })

  it('Rosters: your roster first, with its players', async () => {
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await screen.findAllByTestId('bestball-lineup-card')
    fireEvent.click(screen.getByTestId('bestball-sub-roster'))
    const rosters = screen.getAllByTestId('bestball-roster-card')
    expect(within(rosters[0]!).getByText('Spike Week Society')).toBeTruthy()
    expect(within(rosters[0]!).getByText('Josh Allen')).toBeTruthy()
    expect(within(rosters[0]!).getByText(/IR/)).toBeTruthy()
    // Everyone else is a row you open: 12 open rosters ran ~7,400px on a phone.
    expect(screen.queryByText("Ja'Marr Chase")).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Top Dogs/ }))
    expect(screen.getByText("Ja'Marr Chase")).toBeTruthy()
  })

  it('History: one grid, your row first, with a season total; no week picker', async () => {
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await screen.findAllByTestId('bestball-lineup-card')
    fireEvent.click(screen.getByTestId('bestball-sub-history'))
    const grid = screen.getByTestId('bestball-history-grid')
    const bodyRows = within(grid).getAllByRole('row').slice(1)
    expect(bodyRows[0]!.textContent).toMatch(/Spike Week Society/)
    expect(bodyRows[0]!.textContent).toMatch(/220\.00/)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('Standings: a points league shows no win-loss record, and no week picker', async () => {
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await screen.findAllByTestId('bestball-lineup-card')
    fireEvent.click(screen.getByTestId('bestball-sub-contest'))
    expect(document.body.textContent).not.toMatch(/0-0-0/)
    expect(screen.getByText('Top Dogs')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('no hard-coded hex colour in a className (they wash out in light mode)', () => {
    expect(classHex(read('app/league/[leagueId]/tabs/BestBallTab.tsx'))).toEqual([])
  })
})

const ctx = {
  sport: 'NFL',
  bestBall: { mode: 'underdog', waiversEnabled: false, tradesEnabled: false },
  scoring: { scoringPeriod: 'weekly' },
  roster: { startingSlots: 8, recommendedRosterSize: 18 },
  availability: { playerValues: 'available', weeklyScores: 'available', teamData: 'available' },
  teams: [],
  missingDataFlags: [],
}

describe('the Best Ball War Room panel', () => {
  beforeEach(() => {
    client.fetchBestBallWarRoomState.mockResolvedValue({
      context: ctx,
      construction: { grade: 'A-', rosterSize: 18, byPosition: [{ position: 'TE', count: 1, state: 'thin' }], weaknesses: [] },
      constructionLocked: false,
      depth: { fragilePositions: ['QB', 'TE'] },
    })
  })
  afterEach(() => cleanup())

  it('says what it is in plain words, hides the tools a draft-only league turns off, and asks Chimmy', async () => {
    render(<BestBallWarRoomPanel leagueId="L1" />)
    const panel = await screen.findByTestId('best-ball-war-room-panel')
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('Best Ball War Room')
    expect(screen.queryByTestId('best-ball-war-room-tool-waivers')).toBeNull()
    expect(screen.queryByTestId('best-ball-war-room-tool-trade-analyze')).toBeNull()
    expect(screen.queryByTestId('best-ball-war-room-tool-trade-find')).toBeNull()
    expect(panel.textContent).not.toMatch(/AF Legacy|ADP ✓|auto-start|DEPTH, CEILING/)
    expect(panel.textContent).toMatch(/Ask Chimmy/)
    expect(panel.textContent).toMatch(/8 starters count each week/)
  })

  it('no hard-coded hex colour in a className', () => {
    expect(classHex(read('app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel.tsx'))).toEqual([])
  })
})
