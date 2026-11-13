/**
 * A sealed best ball week's lineup card is read against the seats it was SCORED on.
 *
 * Scoring freezes a final week's slots in `lineupSnapshots.redraftScoring.bestBallRules`
 * (lib/bestball/resultRuleStamp.ts), but the native Best Ball tab read every week against the league's
 * current seats. After a commissioner dropped the FLEX seat, a sealed week's FLEX starter matched no
 * current slot and a benched RB was told "No lineup slot takes a RB" — false for that week. Legacy and
 * unstamped weeks keep reading the current seats, as scoring does for them.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  leaguePlayerWeeklyScore: { findMany: vi.fn() },
}))
const weekRows = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/bestBallWeekRoster', () => ({ loadBestBallWeekRosterRows: weekRows }))
// The league's CURRENT seats: the FLEX seat has been removed since week 3 was sealed.
vi.mock('@/lib/redraft/scoringEngine', () => ({
  buildBestBallSlots: () => [
    { slot: 'QB', eligible: ['QB'], count: 1 },
    { slot: 'WR', eligible: ['WR'], count: 1 },
  ],
}))

import { lineupSlotsForWeek } from '@/lib/bestball/nativeBestBallTab'
import { loadNativeBestBallTab } from '@/lib/bestball/nativeBestBallTabLoad'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'

const SEALED_SLOTS = [
  { slot: 'QB', eligible: ['QB'], count: 1 },
  { slot: 'WR', eligible: ['WR'], count: 1 },
  { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 },
]
const STARTERS = [
  { slot: 'QB', playerId: 'qb1', playerName: 'Quinn Back', points: 22 },
  { slot: 'WR', playerId: 'wr1', playerName: 'Wade Rec', points: 18 },
  { slot: 'FLEX', playerId: 'rb1', playerName: 'Rex Back', points: 12.5 },
]
const sealedStamp = { v: 1, algorithm: 'x', slots: SEALED_SLOTS, scoringFingerprint: null, sealedAt: '2026-09-29T12:00:00.000Z', sealedScoringFingerprint: null }
const legacyStamp = { v: 1, algorithm: 'x', slots: SEALED_SLOTS, scoringFingerprint: null, legacy: true }

function arrange(bestBallRules: unknown) {
  vi.clearAllMocks()
  db.redraftSeason.findFirst.mockResolvedValue({ id: 'S1', season: 2026 })
  db.redraftRoster.findMany.mockResolvedValue([
    { id: 'R1', teamName: 'Team One', ownerName: 'a', wins: 1, losses: 0, ties: 0, pointsFor: 52.5, pointsAgainst: 40 },
  ])
  db.redraftMatchup.findMany.mockResolvedValue([
    {
      id: 'M1', week: 3, status: 'final', homeRosterId: 'R1', awayRosterId: null, homeScore: 52.5, awayScore: 0,
      lineupSnapshots: {
        redraftScoring: {
          ...(bestBallRules ? { bestBallRules } : {}),
          home: { points: 52.5, allFinal: true, bestBall: { assignments: STARTERS } },
        },
      },
    },
  ])
  weekRows.mockResolvedValue([
    { rosterId: 'R1', playerId: 'qb1', playerName: 'Quinn Back', position: 'QB', team: 'KC', slotType: 'QB' },
    { rosterId: 'R1', playerId: 'wr1', playerName: 'Wade Rec', position: 'WR', team: 'KC', slotType: 'WR' },
    { rosterId: 'R1', playerId: 'rb1', playerName: 'Rex Back', position: 'RB', team: 'KC', slotType: 'FLEX' },
    { rosterId: 'R1', playerId: 'rb2', playerName: 'Ron Bench', position: 'RB', team: 'KC', slotType: 'BN' },
  ])
  db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([{ playerId: 'rb2', points: 9 }])
}
const load = async () =>
  (await loadNativeBestBallTab({ leagueId: 'L1', platform: 'manual', sport: 'NFL', settings: {}, requestedWeek: 3, rankBy: 'record' }))!.body
    .lineups[0]!

describe('which seats a week is read against', () => {
  const current = [
    { slot: 'QB', eligible: ['QB'], count: 1 },
    { slot: 'WR', eligible: ['WR'], count: 1 },
  ]
  it('a sealed week: its stored seats, with a note when they differ from today', () => {
    const out = lineupSlotsForWeek({ redraftScoring: { bestBallRules: sealedStamp } }, current)
    expect(out.slots.map((s) => s.slot)).toEqual(['QB', 'WR', 'FLEX'])
    expect(out.sealedSeatsNote).toBe("Scored on the seats this week was sealed with (QB, WR, FLEX); the league's seats have changed since.")
  })
  it('a sealed week whose seats match today: stored seats, no note', () => {
    expect(lineupSlotsForWeek({ redraftScoring: { bestBallRules: sealedStamp } }, SEALED_SLOTS).sealedSeatsNote).toBeUndefined()
  })
  it('a legacy, unsealed or unstamped week: today\'s seats, no note', () => {
    for (const snap of [
      { redraftScoring: { bestBallRules: legacyStamp } },
      { redraftScoring: { bestBallRules: { ...sealedStamp, sealedAt: undefined } } },
      { redraftScoring: {} },
      null,
    ]) {
      const out = lineupSlotsForWeek(snap, current)
      expect(out.slots.map((s) => s.slot)).toEqual(['QB', 'WR'])
      expect(out.sealedSeatsNote).toBeUndefined()
    }
  })
})

describe('the lineup card for a week sealed before the FLEX seat was removed', () => {
  beforeEach(() => arrange(sealedStamp))

  it('explains the bench against the FLEX seat the week was scored with', async () => {
    const card = await load()
    expect(card.starters.find((s) => s.playerId === 'rb1')?.slot).toBe('FLEX')
    expect(card.bench.find((b) => b.playerId === 'rb2')?.reason).toBe('Scored 9.00; Rex Back scored 12.50 at FLEX, so Rex Back counted.')
    expect(card.sealedSeatsNote).toMatch(/sealed with \(QB, WR, FLEX\)/)
  })

  it('a legacy-stamped week keeps today\'s behaviour (current seats, no note)', async () => {
    arrange(legacyStamp)
    const card = await load()
    expect(card.bench.find((b) => b.playerId === 'rb2')?.reason).toBe('No lineup slot takes a RB.')
    expect(card.sealedSeatsNote).toBeUndefined()
  })

  it('an unstamped week keeps today\'s behaviour too', async () => {
    arrange(null)
    const card = await load()
    expect(card.bench.find((b) => b.playerId === 'rb2')?.reason).toBe('No lineup slot takes a RB.')
    expect(card.sealedSeatsNote).toBeUndefined()
  })
})

describe('the tab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the sealed-seats note on that week\'s card', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          league: { id: 'L1', name: 'L', sport: 'NFL', season: 2026, summary: 'Best Ball', settings: { mode: 'standard', draftMode: 'snake', contestStructure: 'season', matchupFormat: 'h2h', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 0 }, profile: { label: 'NFL', scoringPeriod: 'weekly', recommendedRosterSize: 18, lineupSlots: [], notes: [] } },
          source: 'native',
          selectedWeek: 3,
          weeksAvailable: [3],
          draftNotice: null,
          lineups: [
            {
              rosterId: 'R1', teamName: 'Team One', totalPoints: 52.5, winLoss: null, status: 'final',
              starters: [{ playerId: 'rb1', name: 'Rex Back', position: 'RB', team: 'KC', points: 12.5, slot: 'FLEX' }],
              bench: [], unfilledSlots: [], awaitingStats: 0,
              sealedSeatsNote: "Scored on the seats this week was sealed with (QB, WR, FLEX); the league's seats have changed since.",
            },
          ],
          rosterComposition: [],
          standings: [],
          history: [],
        }),
      })),
    )
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await waitFor(() => expect(screen.getByTestId('bestball-lineup-sealed-seats').textContent).toMatch(/sealed with \(QB, WR, FLEX\)/))
  })
})
