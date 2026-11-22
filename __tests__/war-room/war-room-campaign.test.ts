/**
 * War Room phase 5 — the road ahead (lib/core-app/warRoomCampaign.ts).
 *
 * Pins: each remaining game is priced by Season Outlook's own forced-result branch (same seed, same
 * iterations — so next week's numbers equal the swing card's by construction); the biggest swing is
 * flagged and a game under MIN_SWING is called small; a game under way is named, never ranked; the
 * number priced is capped; clinched, eliminated and unmodelled teams get no games; and the tiebreak
 * picture is you plus every team within a win, in seed order, with points-for gaps.
 */

import { describe, expect, it } from 'vitest'

import type { OutlookLeague, OutlookTeam } from '@/lib/core-app/seasonOutlook'
import { pctOf, simulateSeason, type SimGame, type SimInput } from '@/lib/core-app/outlookSim'
import { buildTiebreak, buildWarCampaign, MAX_GAMES, MIN_SWING } from '@/lib/core-app/warRoomCampaign'

const ITER = 600
const SEED = 4242

function team(id: string, over: Partial<OutlookTeam> = {}): OutlookTeam {
  return {
    rosterId: id,
    name: `Team ${id}`,
    isYou: id === 'me',
    wins: 4,
    losses: 4,
    ties: 0,
    pointsFor: 1000,
    seed: 3,
    playoffPct: 50,
    byePct: 0,
    titlePct: 10,
    missPct: 50,
    range: null,
    status: null,
    modelled: true,
    weeksFitted: 8,
    weeklyMean: 120,
    expectedWins: 4,
    schedule: null,
    ...over,
  }
}

/** Six teams, the top three in. "me" sits on the cut line; weeks 9–14 left. */
function setup(over: { remaining?: SimGame[]; you?: Partial<OutlookTeam>; medianGame?: boolean } = {}) {
  const ids = ['a', 'b', 'me', 'c', 'd', 'e']
  const rec: Record<string, [number, number, number]> = { a: [7, 1, 1150], b: [5, 3, 1080], me: [4, 4, 1010], c: [4, 4, 990], d: [3, 5, 960], e: [1, 7, 900] }
  const teams = ids.map((id, i) =>
    team(id, { wins: rec[id][0], losses: rec[id][1], pointsFor: rec[id][2], seed: i + 1, playoffPct: [95, 70, 45, 40, 15, 1][i], ...(id === 'me' ? over.you : {}) }),
  )
  const pairs: Array<[string, string]> = [
    ['me', 'a'], ['me', 'c'], ['me', 'e'], ['me', 'b'], ['me', 'd'], ['me', 'c'],
  ]
  const others: Array<[string, string]> = [
    ['b', 'c'], ['a', 'd'], ['b', 'd'], ['c', 'e'], ['a', 'c'], ['b', 'e'],
  ]
  const remaining: SimGame[] =
    over.remaining ??
    pairs.flatMap(([x, y], i) => [
      { week: 9 + i, a: x, b: y },
      { week: 9 + i, a: others[i][0], b: others[i][1] },
    ])
  const sim: SimInput = {
    teams: ids.map((id) => ({
      rosterId: id,
      wins: rec[id][0],
      losses: rec[id][1],
      pointsFor: rec[id][2],
      profile: { mu: { a: 130, b: 124, me: 120, c: 119, d: 112, e: 100 }[id]!, sigma: 18, n: 8 },
    })),
    remaining,
    playoffTeams: 3,
    byeTeams: 0,
    ...(over.medianGame ? { medianGame: true } : {}),
  }
  const row: Pick<OutlookLeague, 'teams' | 'playoffTeams' | 'you'> = {
    teams,
    playoffTeams: 3,
    you: teams.find((t) => t.isYou) ?? null,
  }
  return { sim, row }
}

describe('buildWarCampaign — pricing', () => {
  it('prices every game of yours chronologically, both ways, from the forced branch Season Outlook uses', () => {
    const { sim, row } = setup()
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: ITER })
    if (c.kind !== 'games') throw new Error('expected games')
    expect(c.games.map((g) => g.week)).toEqual([9, 10, 11, 12, 13, 14])
    expect(c.games.map((g) => g.opponent.rosterId)).toEqual(['a', 'c', 'e', 'b', 'd', 'c'])

    // Week 9, recomputed exactly as Season Outlook's swing card does it.
    const forced = (winner: string) =>
      pctOf(simulateSeason(sim, { iterations: ITER, seed: SEED, forced: [{ week: 9, a: 'me', b: 'a', winner }] }).counts.me.playoff, ITER)
    expect(c.games[0].ifWin).toBe(forced('me'))
    expect(c.games[0].ifLose).toBe(forced('a'))
    for (const g of c.games) {
      expect(g.swing).toBeCloseTo(g.ifWin - g.ifLose, 10)
      expect(g.ifWin).toBeGreaterThan(g.ifLose)
    }
    expect(c.playoffPct).toBe(45)
  })

  it('flags exactly one biggest game — the largest swing — and calls a sub-MIN_SWING game small', () => {
    const { sim, row } = setup()
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: ITER })
    if (c.kind !== 'games') throw new Error('expected games')
    const biggest = c.games.filter((g) => g.biggest)
    expect(biggest).toHaveLength(1)
    expect(biggest[0].swing).toBe(Math.max(...c.games.map((g) => g.swing)))
    for (const g of c.games) expect(g.small).toBe(Math.abs(g.swing) < MIN_SWING)
  })

  it('no game is "biggest" when every one is small', () => {
    // Already 4 games ahead of the cut with one game left, the result cannot move you much.
    const { sim, row } = setup({
      remaining: [{ week: 14, a: 'me', b: 'e' }],
      you: { wins: 4 },
    })
    sim.teams = sim.teams.map((t) => (t.rosterId === 'me' ? { ...t, wins: 9, losses: 0 } : t))
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: ITER })
    if (c.kind !== 'games') throw new Error('expected games')
    expect(c.games[0].small).toBe(true)
    expect(c.games.some((g) => g.biggest)).toBe(false)
  })

  it('🛑 a game under way is named and left out of the ranking', () => {
    const base = setup().sim.remaining
    const remaining = base.map((g) => (g.week === 9 ? { ...g, live: { a: 60, b: 20, restA: 0.4, restB: 0.4 } } : g))
    const { sim, row } = setup({ remaining })
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: ITER })
    if (c.kind !== 'games') throw new Error('expected games')
    expect(c.inProgressWeek).toBe(9)
    expect(c.games.map((g) => g.week)).not.toContain(9)
  })

  it('prices at most MAX_GAMES games, the nearest, and counts the rest', () => {
    const remaining: SimGame[] = Array.from({ length: MAX_GAMES + 3 }, (_, i) => ({ week: 5 + i, a: 'me', b: i % 2 ? 'c' : 'd' }))
    const { sim, row } = setup({ remaining })
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: 200 })
    if (c.kind !== 'games') throw new Error('expected games')
    expect(c.games).toHaveLength(MAX_GAMES)
    expect(c.games[0].week).toBe(5)
    expect(c.unpricedGames).toBe(3)
  })

  it('says when the league also plays the median', () => {
    const { sim, row } = setup({ medianGame: true })
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: 200 })
    expect(c.kind === 'games' && c.medianGame).toBe(true)
  })

  it('an opponent who is not modelled carries no playoff odds — a fact is never invented', () => {
    const { sim, row } = setup()
    row.teams = row.teams.map((t) => (t.rosterId === 'a' ? { ...t, modelled: false } : t))
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: 200 })
    if (c.kind !== 'games') throw new Error('expected games')
    expect(c.games[0].opponent.playoffPct).toBeNull()
    expect(c.games[1].opponent.playoffPct).toBe(40)
  })
})

describe('buildWarCampaign — nothing to price', () => {
  it.each([
    ['clinched', { status: 'clinched' as const }],
    ['eliminated', { status: 'eliminated' as const }],
    ['unplaced', { modelled: false }],
  ])('%s', (why, you) => {
    const { sim, row } = setup({ you })
    const c = buildWarCampaign({ row, sim, seed: SEED, iterations: 200 })
    expect(c).toMatchObject({ kind: 'none', why })
  })

  it('no games left', () => {
    const { sim, row } = setup({ remaining: [{ week: 14, a: 'b', b: 'c' }] })
    expect(buildWarCampaign({ row, sim, seed: SEED, iterations: 200 })).toMatchObject({ kind: 'none', why: 'no_games' })
  })

  it('no team of yours on the board', () => {
    const { sim, row } = setup()
    expect(buildWarCampaign({ row: { ...row, you: null }, sim, seed: SEED, iterations: 200 })).toMatchObject({ kind: 'none', why: 'unplaced' })
  })
})

describe('buildTiebreak', () => {
  it('you and every team within one win, in seed order, with points-for gaps and the cut', () => {
    const { row } = setup()
    const t = buildTiebreak(row)!
    // me 4-4; b 5-3 and c 4-4 and d 3-5 are within a win; a 7-1 and e 1-7 are not.
    expect(t.rows.map((r) => r.rosterId)).toEqual(['b', 'me', 'c', 'd'])
    expect(t.rows.find((r) => r.rosterId === 'b')).toMatchObject({ pointsGap: 70, inField: true })
    expect(t.rows.find((r) => r.rosterId === 'c')).toMatchObject({ pointsGap: -20, inField: false })
    expect(t.rows.find((r) => r.isYou)).toMatchObject({ pointsGap: 0, inField: true })
    expect(t.playoffTeams).toBe(3)
  })

  it('a tie counts as half a win', () => {
    const { row } = setup()
    // e at 2-5-1 is 2.5 wins: 1.5 behind me, still out. d at 2-5-1 would be 2.5: out too.
    row.teams = row.teams.map((t) => (t.rosterId === 'd' ? { ...t, wins: 2, losses: 5, ties: 1 } : t))
    expect(buildTiebreak(row)!.rows.map((r) => r.rosterId)).toEqual(['b', 'me', 'c'])
  })

  it('null when nobody is within a win, or you are not on the board', () => {
    const lone = { playoffTeams: 2, teams: [team('me', { wins: 8, losses: 0 }), team('x', { wins: 2, losses: 6 })] }
    expect(buildTiebreak(lone)).toBeNull()
    expect(buildTiebreak({ playoffTeams: 2, teams: [team('x', { isYou: false })] })).toBeNull()
  })
})
