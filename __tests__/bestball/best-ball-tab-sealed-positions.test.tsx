/**
 * A sealed best ball week's lineup card is read at the positions its players were SCORED at.
 *
 * Scoring stores each scored player's position at the seal (`bestBallRules.sealedPositions`,
 * lib/bestball/resultRuleStamp.ts) and every rescore of that week seats and scores him there. The Best
 * Ball tab read today's position, so an RB re-listed as a TE after week 3 was sealed was told "No lineup
 * slot takes a TE" for a week in which he was seated and scored as an RB.
 *
 * Also pins the answer to "does the ORDER of a sealed week's seats matter?" — it does not:
 * `computeOptimalLineup` picks the same players and the same total whatever the seat array order or
 * `slotOrder`, so `sealedSeatsNote` correctly ignores order.
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
// The league's current seats are the ones week 3 was sealed with: only the POSITIONS moved.
vi.mock('@/lib/redraft/scoringEngine', () => ({
  buildBestBallSlots: () => [
    { slot: 'QB', eligible: ['QB'], count: 1 },
    { slot: 'RB', eligible: ['RB'], count: 1 },
  ],
}))

import { buildNativeLineupCard, lineupPositionsForWeek, lineupSlotsForWeek } from '@/lib/bestball/nativeBestBallTab'
import { loadNativeBestBallTab } from '@/lib/bestball/nativeBestBallTabLoad'
import { computeOptimalLineup } from '@/lib/lineup-optimizer/optimalLineup'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'

const SLOTS = [
  { slot: 'QB', eligible: ['QB'], count: 1 },
  { slot: 'RB', eligible: ['RB'], count: 1 },
]
const STARTERS = [
  { slot: 'QB', playerId: 'qb1', playerName: 'Quinn Back', points: 22 },
  { slot: 'RB', playerId: 'rb1', playerName: 'Rex Back', points: 12.5 },
]
// At the seal rb1 and rb2 were RBs. qb2 had no stat row then, so he is not in the map.
const SEALED_POSITIONS = { qb1: 'QB', rb1: 'RB', rb2: 'RB' }
const stamp = {
  v: 1,
  algorithm: 'x',
  slots: SLOTS,
  scoringFingerprint: null,
  sealedAt: '2026-09-29T12:00:00.000Z',
  sealedScoringFingerprint: null,
  sealedPositions: SEALED_POSITIONS,
}
const { sealedPositions: _omit, ...stampWithoutPositions } = stamp
const legacyStamp = { ...stamp, sealedAt: undefined, legacy: true }

// Today: rb1 is listed WR, rb2 is listed TE (no seat takes either), qb2 is a QB.
const TODAY_ROWS = [
  { rosterId: 'R1', playerId: 'qb1', playerName: 'Quinn Back', position: 'QB', team: 'KC', slotType: 'QB' },
  { rosterId: 'R1', playerId: 'rb1', playerName: 'Rex Back', position: 'WR', team: 'KC', slotType: 'RB' },
  { rosterId: 'R1', playerId: 'rb2', playerName: 'Ron Bench', position: 'TE', team: 'KC', slotType: 'BN' },
  { rosterId: 'R1', playerId: 'qb2', playerName: 'Quiet Backup', position: 'QB', team: 'KC', slotType: 'BN' },
]

function arrange(bestBallRules: unknown) {
  vi.clearAllMocks()
  db.redraftSeason.findFirst.mockResolvedValue({ id: 'S1', season: 2026 })
  db.redraftRoster.findMany.mockResolvedValue([
    { id: 'R1', teamName: 'Team One', ownerName: 'a', wins: 1, losses: 0, ties: 0, pointsFor: 34.5, pointsAgainst: 20 },
  ])
  db.redraftMatchup.findMany.mockResolvedValue([
    {
      id: 'M1', week: 3, status: 'final', homeRosterId: 'R1', awayRosterId: null, homeScore: 34.5, awayScore: 0,
      lineupSnapshots: {
        redraftScoring: {
          ...(bestBallRules ? { bestBallRules } : {}),
          home: { points: 34.5, allFinal: true, bestBall: { assignments: STARTERS } },
        },
      },
    },
  ])
  weekRows.mockResolvedValue(TODAY_ROWS)
  db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([
    { playerId: 'rb2', points: 9 },
    { playerId: 'qb2', points: 4 },
  ])
}
const load = async () =>
  (await loadNativeBestBallTab({ leagueId: 'L1', platform: 'manual', sport: 'NFL', settings: {}, requestedWeek: 3, rankBy: 'record' }))!.body
    .lineups[0]!

describe('which positions a week is read at', () => {
  it('a sealed week with stored positions: those positions', () => {
    expect(lineupPositionsForWeek({ redraftScoring: { bestBallRules: stamp } })).toEqual(SEALED_POSITIONS)
  })
  it('a sealed week without stored positions, a legacy, unsealed or unstamped week: none', () => {
    for (const snap of [
      { redraftScoring: { bestBallRules: stampWithoutPositions } },
      { redraftScoring: { bestBallRules: legacyStamp } },
      { redraftScoring: { bestBallRules: { ...stamp, sealedAt: undefined } } },
      { redraftScoring: {} },
      null,
    ]) {
      expect(lineupPositionsForWeek(snap)).toBeNull()
    }
  })
})

describe('the lineup card for a week sealed before two players changed position', () => {
  beforeEach(() => arrange(stamp))

  it('explains the bench at the position he was scored at, not today\'s', async () => {
    const card = await load()
    const rb2 = card.bench.find((b) => b.playerId === 'rb2')!
    expect(rb2.reason).toBe('Scored 9.00; Rex Back scored 12.50 at RB, so Rex Back counted.')
    expect(rb2.position).toBe('RB')
    expect(rb2.positionNow).toBe('TE')
  })

  it('shows a starter at his stored position, with today\'s beside it', async () => {
    const card = await load()
    const rb1 = card.starters.find((s) => s.playerId === 'rb1')!
    expect(rb1.position).toBe('RB')
    expect(rb1.positionNow).toBe('WR')
    const qb1 = card.starters.find((s) => s.playerId === 'qb1')!
    expect(qb1.position).toBe('QB')
    expect(qb1.positionNow).toBeUndefined()
  })

  it('a player absent from the stored map is at his current position, as scoring treats him', async () => {
    const card = await load()
    const qb2 = card.bench.find((b) => b.playerId === 'qb2')!
    expect(qb2.position).toBe('QB')
    expect(qb2.positionNow).toBeUndefined()
    expect(qb2.reason).toBe('Scored 4.00; Quinn Back scored 22.00 at QB, so Quinn Back counted.')
  })

  it('a stamp sealed before positions were recorded keeps today\'s positions', async () => {
    arrange(stampWithoutPositions)
    const card = await load()
    const rb2 = card.bench.find((b) => b.playerId === 'rb2')!
    expect(rb2.reason).toBe('No lineup slot takes a TE.')
    expect(rb2.position).toBe('TE')
    expect(rb2.positionNow).toBeUndefined()
  })

  it('a legacy-stamped or unstamped week keeps today\'s positions', async () => {
    for (const rules of [legacyStamp, null]) {
      arrange(rules)
      const card = await load()
      expect(card.bench.find((b) => b.playerId === 'rb2')?.reason).toBe('No lineup slot takes a TE.')
      expect(card.starters.find((s) => s.playerId === 'rb1')?.position).toBe('WR')
    }
  })
})

describe('daily best ball card', () => {
  it('shows each player at his stored position', () => {
    const card = buildNativeLineupCard({
      rosterId: 'R1',
      teamName: 'Team One',
      side: { points: 30, allFinal: true, bestBall: { period: 'daily', counted: [{ playerId: 'rb1', playerName: 'Rex Back', points: 30, days: 3 }] } },
      matchupFinal: true,
      opponentPoints: null,
      weekRoster: TODAY_ROWS.map(({ rosterId: _r, ...p }) => p),
      pointsByPlayer: new Map([['rb2', 9]]),
      slots: SLOTS,
      sealedPositions: SEALED_POSITIONS,
    })
    expect(card.starters[0]).toMatchObject({ playerId: 'rb1', position: 'RB', positionNow: 'WR' })
    expect(card.bench.find((b) => b.playerId === 'rb2')).toMatchObject({ position: 'RB', positionNow: 'TE' })
  })
})

describe('seat order does not change a best ball result, so the sealed-seats note ignores it', () => {
  const players = [
    { playerId: 'qa', positions: ['QB'], points: 30 },
    { playerId: 'rb', positions: ['RB'], points: 25 },
    { playerId: 'qc', positions: ['QB'], points: 5 },
    { playerId: 'wr', positions: ['WR'], points: 18 },
    { playerId: 'te', positions: ['TE'], points: 18 },
  ]
  const seats = [
    { slot: 'SUPER_FLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1 },
    { slot: 'QB', eligible: ['QB'], count: 1 },
    { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 2 },
  ]
  const chosen = (slots: typeof seats) => {
    const r = computeOptimalLineup({ players, slots })
    return { total: r.total, ids: r.assignments.map((a) => a.playerId).sort(), unused: r.unusedPlayerIds }
  }

  it('the same players and total for every seat order and slotOrder', () => {
    const base = chosen(seats)
    expect(base.total).toBe(91)
    const orders = [
      [...seats].reverse(),
      [seats[1]!, seats[0]!, seats[2]!],
      seats.map((s, i) => ({ ...s, slotOrder: 10 - i })),
      seats.map((s, i) => ({ ...s, slotOrder: i })),
    ]
    for (const order of orders) expect(chosen(order)).toEqual(base)
  })

  it('a sealed week whose seats differ from today\'s only in order gets no note', () => {
    const sealed = { ...stamp, slots: seats.map((s, i) => ({ ...s, slotOrder: i })) }
    const current = [...seats].reverse().map((s) => ({ slot: s.slot, eligible: [...s.eligible].reverse(), count: s.count }))
    expect(lineupSlotsForWeek({ redraftScoring: { bestBallRules: sealed } }, current).sealedSeatsNote).toBeUndefined()
  })
})

describe('the tab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows today\'s position beside the one he was scored at', async () => {
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
              rosterId: 'R1', teamName: 'Team One', totalPoints: 34.5, winLoss: null, status: 'final',
              starters: [{ playerId: 'rb1', name: 'Rex Back', position: 'RB', positionNow: 'WR', team: 'KC', points: 12.5, slot: 'RB' }],
              bench: [{ playerId: 'rb2', name: 'Ron Bench', position: 'RB', positionNow: 'TE', team: 'KC', points: 9, reason: 'x' }],
              unfilledSlots: [], awaitingStats: 0,
            },
          ],
          rosterComposition: [],
          standings: [],
          history: [],
        }),
      })),
    )
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await waitFor(() => expect(screen.getAllByTestId('bestball-position-now').map((n) => n.textContent)).toEqual([' (now WR)', ' (now TE)']))
  })
})
