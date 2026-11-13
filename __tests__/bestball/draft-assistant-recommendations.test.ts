/**
 * Best ball live-draft recommendations (lib/bestball/ai/draftAssistant.ts).
 *
 * The assistant used to return the first three players the client sent, in the order sent. These
 * tests pin the replacement: ranking by ADP (never input order), weighting by roster need from the
 * template's depth targets, and a structural pick at an empty position.
 */
import { describe, expect, it } from 'vitest'
import type { BestBallSportTemplate } from '@prisma/client'
import { getLiveDraftRecommendation, type DraftPlayer, type DraftedPlayer } from '@/lib/bestball/ai/draftAssistant'

const NFL: BestBallSportTemplate = {
  id: 't1',
  sport: 'NFL',
  variant: 'standard',
  rosterSize: 18,
  startCount: 9,
  lineupSlots: [],
  scoringPeriod: 'weekly',
  scoringWeeks: 18,
  tiebreaker: 'points_for',
  lockRule: 'game_start',
  depthRequirements: { QB: 2, RB: 4, WR: 5, TE: 2, K: 1 },
  createdAt: new Date(0),
}
const NFL_TOURNAMENT: BestBallSportTemplate = { ...NFL, variant: 'tournament', depthRequirements: { QB: 3, RB: 5, WR: 6, TE: 2 } }

const BOARD: DraftPlayer[] = [
  { playerId: 'wr1', name: 'Wide One', pos: 'WR', adp: 10, team: 'MIA' },
  { playerId: 'rb1', name: 'Run One', pos: 'RB', adp: 11, team: 'SF' },
  { playerId: 'wr2', name: 'Wide Two', pos: 'WR', adp: 14, team: 'KC' },
  { playerId: 'te1', name: 'Tight One', pos: 'TE', adp: 18, team: 'KC' },
  { playerId: 'qb1', name: 'Quarter One', pos: 'QB', adp: 20, team: 'BUF' },
  { playerId: 'rb2', name: 'Run Two', pos: 'RB', adp: 22, team: 'DET' },
  { playerId: 'qb2', name: 'Quarter Two', pos: 'QB', adp: 30, team: 'KC' },
  { playerId: 'k1', name: 'Kicker One', pos: 'K', adp: 150, team: 'BAL' },
]

/** Fisher-Yates with a fixed seed, so the "shuffle" is reproducible. */
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

const rec = (roster: DraftedPlayer[], board: DraftPlayer[], pick = 12, tpl = NFL, variant = 'standard') =>
  getLiveDraftRecommendation(roster, board, 'NFL', variant, 3, pick, tpl)

const ids = (r: Awaited<ReturnType<typeof rec>>) => [r.bestPick?.playerId, r.safePick?.playerId, r.upsidePick?.playerId, r.structuralPick?.playerId, r.leveragePick?.playerId]

describe('best ball draft assistant — ordering', () => {
  it('ranks by ADP, not by the order players arrive in (shuffled input gives the same answer)', async () => {
    const roster: DraftedPlayer[] = [{ playerId: 'x1', name: 'Mine', pos: 'RB' }]
    const baseline = ids(await rec(roster, BOARD))
    for (const seed of [1, 7, 42, 99, 1234]) {
      expect(ids(await rec(roster, shuffled(BOARD, seed)))).toEqual(baseline)
    }
  })

  it('a board sent worst-first still recommends the best-ADP player, not the first one sent', async () => {
    const reversed = [...BOARD].reverse()
    const r = await rec([{ playerId: 'x1', name: 'Mine', pos: 'QB' }, { playerId: 'x2', name: 'Mine2', pos: 'TE' }], reversed)
    expect(reversed[0]!.playerId).toBe('k1')
    expect(r.bestPick?.playerId).toBe('wr1')
  })

  it('upside is the biggest fall past ADP and says how far he fell', async () => {
    const r = await rec([], BOARD, 40)
    expect(r.upsidePick).not.toBeNull()
    expect(r.upsidePick!.reasoning).toMatch(/pick 40/)
    expect(r.upsidePick!.reasoning).toMatch(/later than drafters usually take him/)
  })
})

describe('best ball draft assistant — roster need', () => {
  it('the best pick changes with roster need', async () => {
    // Already deep at WR: the WR at ADP 10 loses to the RB at ADP 11.
    const deepWr: DraftedPlayer[] = Array.from({ length: 5 }, (_, i) => ({ playerId: `w${i}`, name: `W${i}`, pos: 'WR' }))
    const withWr = await rec(deepWr, BOARD)
    // Already deep at RB: the WR wins.
    const deepRb: DraftedPlayer[] = Array.from({ length: 4 }, (_, i) => ({ playerId: `r${i}`, name: `R${i}`, pos: 'RB' }))
    const withRb = await rec(deepRb, BOARD)
    expect(withWr.bestPick?.position).not.toBe('WR')
    expect(withRb.bestPick?.position).not.toBe('RB')
    expect(withWr.bestPick?.playerId).not.toBe(withRb.bestPick?.playerId)
  })

  it('a critical gap late (no QB, two spots left) yields a structural QB pick, and the best pick is forced to it', async () => {
    const roster: DraftedPlayer[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ playerId: `r${i}`, name: `R${i}`, pos: 'RB' })),
      ...Array.from({ length: 7 }, (_, i) => ({ playerId: `w${i}`, name: `W${i}`, pos: 'WR' })),
      { playerId: 't0', name: 'T0', pos: 'TE' },
      { playerId: 't1', name: 'T1', pos: 'TE' },
      { playerId: 'k0', name: 'K0', pos: 'K' },
    ]
    // 16 rostered of 18: two spots left, one empty position (QB).
    const r = await rec(roster, BOARD, 190)
    expect(r.structuralPick?.position).toBe('QB')
    expect(r.structuralPick?.playerId).toBe('qb1')
    expect(r.structuralPick!.reasoning).toMatch(/no QB yet/)
    expect(r.rosterAlert).toMatch(/No QB on roster/)
    // Only 2 spots for 1 empty position is not yet forced…
    expect(r.bestPick?.playerId).toBe('qb1')
  })

  it('with one spot left and no QB, best pick must be the QB even though a WR has better ADP', async () => {
    const roster: DraftedPlayer[] = [
      ...Array.from({ length: 7 }, (_, i) => ({ playerId: `r${i}`, name: `R${i}`, pos: 'RB' })),
      ...Array.from({ length: 7 }, (_, i) => ({ playerId: `w${i}`, name: `W${i}`, pos: 'WR' })),
      { playerId: 't0', name: 'T0', pos: 'TE' },
      { playerId: 't1', name: 'T1', pos: 'TE' },
      { playerId: 'k0', name: 'K0', pos: 'K' },
    ]
    const board: DraftPlayer[] = [
      { playerId: 'wr9', name: 'Wide Nine', pos: 'WR', adp: 5 },
      { playerId: 'qb9', name: 'Quarter Nine', pos: 'QB', adp: 200 },
    ]
    const r = await rec(roster, board, 210)
    expect(r.bestPick?.playerId).toBe('qb9')
    expect(r.bestPick!.reasoning).toMatch(/has to be a QB/)
  })

  it('no structural pick when every position has someone', async () => {
    const roster: DraftedPlayer[] = ['QB', 'RB', 'WR', 'TE', 'K'].map((pos, i) => ({ playerId: `p${i}`, name: `P${i}`, pos }))
    const r = await rec(roster, BOARD)
    expect(r.structuralPick).toBeNull()
  })

  it('safe pick is the top player at the thinnest position', async () => {
    // Have WR/RB depth, one TE of two, zero QB: QB is thinnest (0 of 2).
    const roster: DraftedPlayer[] = [
      ...Array.from({ length: 4 }, (_, i) => ({ playerId: `r${i}`, name: `R${i}`, pos: 'RB' })),
      ...Array.from({ length: 5 }, (_, i) => ({ playerId: `w${i}`, name: `W${i}`, pos: 'WR' })),
      { playerId: 't0', name: 'T0', pos: 'TE' },
      { playerId: 'k0', name: 'K0', pos: 'K' },
    ]
    const r = await rec(roster, BOARD)
    // Best takes the top QB (need weighting), so safe is the next-highest QB.
    expect(r.bestPick?.playerId).toBe('qb1')
    expect(r.safePick?.playerId).toBe('qb2')
    expect(r.safePick!.reasoning).toMatch(/thinnest position is QB \(0 of 2\)/)
  })

  it('best, safe and upside are three different players when the board allows', async () => {
    const r = await rec([], BOARD)
    const three = [r.bestPick?.playerId, r.safePick?.playerId, r.upsidePick?.playerId]
    expect(new Set(three).size).toBe(3)
  })
})

describe('best ball draft assistant — only players that were sent', () => {
  it('every recommendation is a player from availablePlayers and not already rostered', async () => {
    const roster: DraftedPlayer[] = [{ playerId: 'wr1', name: 'Wide One', pos: 'WR' }]
    const r = await rec(roster, BOARD, 12, NFL_TOURNAMENT, 'tournament')
    const sent = new Set(BOARD.map((p) => p.playerId))
    for (const id of ids(r).filter(Boolean)) {
      expect(sent.has(id!)).toBe(true)
      expect(id).not.toBe('wr1')
    }
  })

  it('an empty list returns no picks and says why', async () => {
    const r = await rec([], [])
    expect(r.bestPick).toBeNull()
    expect(r.safePick).toBeNull()
    expect(r.upsidePick).toBeNull()
    expect(r.structuralPick).toBeNull()
    expect(r.leveragePick).toBeNull()
    expect(r.pickContext).toMatch(/No available players were sent/)
  })

  it('a one-player list gives that player as best and nothing invented for the others', async () => {
    const r = await rec([], [{ playerId: 'solo', name: 'Solo', pos: 'RB', adp: 3 }])
    expect(r.bestPick?.playerId).toBe('solo')
    expect(r.safePick).toBeNull()
    expect(r.upsidePick).toBeNull()
  })

  it('duplicate and malformed entries are ignored', async () => {
    const r = await rec([], [
      { playerId: 'a', name: 'A', pos: 'RB', adp: 5 },
      { playerId: 'a', name: 'A again', pos: 'RB', adp: 1 },
      { playerId: '', name: 'No id', pos: 'RB', adp: 1 },
      { playerId: 'b', name: 'B', pos: '', adp: 1 },
    ])
    expect(r.bestPick?.playerId).toBe('a')
    expect(r.safePick).toBeNull()
  })
})

describe('best ball draft assistant — leverage', () => {
  it('tournament: stacks a pass catcher with a quarterback already on the roster', async () => {
    const roster: DraftedPlayer[] = [{ playerId: 'myqb', name: 'Mahomes', pos: 'QB', team: 'KC' }]
    const r = await rec(roster, BOARD, 12, NFL_TOURNAMENT, 'tournament')
    expect(r.leveragePick).not.toBeNull()
    expect(['wr2', 'te1']).toContain(r.leveragePick!.playerId)
    expect(r.leveragePick!.reasoning).toMatch(/Stacks with your quarterback Mahomes on KC/)
  })

  it('standard leagues get no leverage pick', async () => {
    const roster: DraftedPlayer[] = [{ playerId: 'myqb', name: 'Mahomes', pos: 'QB', team: 'KC' }]
    const r = await rec(roster, BOARD)
    expect(r.leveragePick).toBeNull()
  })

  it('tournament without team data gets no leverage pick rather than an invented one', async () => {
    const roster: DraftedPlayer[] = [{ playerId: 'myqb', name: 'Mahomes', pos: 'QB' }]
    const r = await rec(roster, BOARD, 12, NFL_TOURNAMENT, 'tournament')
    expect(r.leveragePick).toBeNull()
  })
})
