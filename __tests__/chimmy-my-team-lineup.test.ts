/**
 * One start/sit answer (2026-11-16 re-score item 6): Chimmy's lineup tools read My Team's own best lineup, built
 * here by the REAL `optimizeLineup` exactly as `getMyTeamData` builds it, so chat cannot disagree with the screen.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/myTeam', () => ({ getMyTeamData: vi.fn() }))

import { optimizeLineup } from '@/lib/decision-os/lineup/bestLineup'
import { buildMyTeamLineupContext, buildMyTeamStartSitContext } from '@/lib/chimmy/myTeamLineupGrounding'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

const NOW = new Date('2026-11-15T15:00:00.000Z')
const later = new Date('2026-11-15T18:00:00.000Z')

function player(id: string, name: string, position: string, af: number | null, over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: id, name, position, team: 'XX', sport: 'NFL', imageUrl: null, gameContext: null, kickoff: later,
    preseason: false, venue: null, injuryStatus: null, ruledOut: false, afProjectedPoints: af, onBye: false,
    ...over,
  } as unknown as LineupPlayer
}
const slot = (slotLabel: string, p: LineupPlayer | null): LineupSlot =>
  ({ slotLabel, benchCheck: null, player: p, empty: !p, unresolvedId: null }) as unknown as LineupSlot

function myTeam(starters: LineupSlot[], bench: LineupPlayer[], over: Partial<MyTeamData> = {}): MyTeamData {
  return {
    league: { id: 'L', name: 'Sunday League', platform: 'sleeper', sport: 'NFL', format: 'redraft', sourceLink: null },
    starters: { available: true, data: starters },
    bench: { available: true, data: bench },
    projections: { available: true, data: { season: '2026', week: 11 } },
    // The exact call getMyTeamData makes.
    lineupOptimizer: optimizeLineup({ starters, bench, sport: 'NFL', now: NOW }),
    ...over,
  } as unknown as MyTeamData
}

const qb = player('1', 'Quinn Arm', 'QB', 21)
const wr1 = player('2', 'Wade Hands', 'WR', 9)
const wr2 = player('3', 'Benchy Burner', 'WR', 15)
const rb = player('4', 'Rex Legs', 'RB', 12)
const rbBench = player('5', 'Ronnie Backup', 'RB', 11)

const run = (data: MyTeamData | null, onStartCall?: (c: unknown) => void) =>
  buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW, ...(onStartCall ? { onStartCall } : {}) }, { load: async () => data })

describe('whole lineup: Chimmy says what My Team says', () => {
  it('names My Team’s swap, its totals and its verdict — and records the one clear swap for the advice ledger', async () => {
    const data = myTeam([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [wr2, rbBench])
    expect(data.lineupOptimizer).toMatchObject({ state: 'improve', verdict: 'swap', gain: 6 })
    const calls: unknown[] = []
    const out = (await run(data, (c) => calls.push(c))) as string
    expect(out).toContain('THE SAME ANSWER THE MY TEAM SCREEN SHOWS')
    expect(out).toContain('(week 11, 2026)')
    expect(out).toContain('Verdict: CHANGE THE LINEUP. Current 42 pts, best 48 pts (+6).')
    expect(out).toContain('- WR: start Benchy Burner (15 pts) instead of Wade Hands (9 pts).')
    expect(out).toContain('never recommend a different lineup')
    expect(calls).toEqual([{ leagueId: 'L', season: 2026, week: 11, rec: { key: '3', name: 'Benchy Burner' }, alt: { key: '2', name: 'Wade Hands' }, slot: 'WR' }])
  })

  it('a gain inside projection noise is a CLOSE CALL, and is not recorded as a call', async () => {
    const data = myTeam([slot('QB', qb), slot('RB', rbBench)], [rb])
    expect(data.lineupOptimizer).toMatchObject({ verdict: 'close' })
    const calls: unknown[] = []
    const out = (await run(data, (c) => calls.push(c))) as string
    expect(out).toContain('CLOSE CALL')
    expect(calls).toEqual([])
  })

  it('an already-best lineup says so; a bye counts 0 and a started game is locked, as on the screen', async () => {
    const byeWr = player('6', 'Bye Guy', 'WR', 14, { onBye: true })
    const started = player('7', 'Early Kick', 'RB', 8, { kickoff: new Date('2026-11-15T14:00:00.000Z') })
    const data = myTeam([slot('QB', qb), slot('WR', wr2), slot('RB', started)], [byeWr])
    const out = (await run(data)) as string
    expect(out).toContain('Verdict: the current lineup is already the best one')
    expect(out).toContain('1 seat(s) are locked')
    expect(out).toContain('Bye Guy (WR) 0 pts [BYE]')
    expect(out).toContain('Early Kick (RB) 8 pts [game started — locked]')
  })

  it('when My Team has no answer it gives My Team’s reason and forbids a home-made lineup', async () => {
    const unpriced = player('8', 'No Line', 'RB', null)
    const data = myTeam([slot('QB', qb), slot('RB', unpriced)], [rb])
    expect(data.lineupOptimizer).toBeNull()
    const out = (await run(data)) as string
    expect(out).toContain('My Team has no best lineup to give right now')
    expect(out).toContain('do not build a lineup of your own')
  })

  it('another sport is answered from My Team whenever My Team has a best lineup — the screen and chat agree', async () => {
    // 2026-11-20: this was NFL-only, so an NCAAF/NBA points league got one lineup on the screen and another in chat.
    const ncaaf = { league: { id: 'L', name: 'Campus League', platform: 'fantrax', sport: 'NCAAF', format: 'redraft', sourceLink: null } }
    const data = myTeam([slot('QB', qb), slot('WR', wr1)], [wr2], ncaaf as never)
    expect(data.lineupOptimizer).not.toBeNull()
    const out = (await run(data)) as string
    expect(typeof out).toBe('string')
    expect(out).toContain('THE SAME ANSWER THE MY TEAM SCREEN SHOWS')
    expect(out).toContain('start Benchy Burner')
  })

  it('steps aside by design when another sport has no My Team best lineup (a category league), and as a failure when My Team cannot load', async () => {
    const nba = { league: { id: 'L', name: 'x', platform: 'sleeper', sport: 'NBA', format: null, sourceLink: null }, lineupOptimizer: null }
    expect(await run(myTeam([slot('QB', qb)], [], nba as never))).toEqual({ fallback: 'not_nfl' })
    expect(await run(null)).toEqual({ fallback: 'no_my_team' })
    expect(await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u' }, { load: async () => { throw new Error('down') } })).toEqual({ fallback: 'no_my_team' })
  })
})

describe('start A or B: derived from My Team’s best lineup, so it cannot contradict it', () => {
  const ss = (data: MyTeamData, players: [string, string], onStartCall?: (c: unknown) => void) =>
    buildMyTeamStartSitContext({ leagueId: 'L', userId: 'u', players, now: NOW, ...(onStartCall ? { onStartCall } : {}) }, { load: async () => data })
  const data = myTeam([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [wr2, rbBench])

  it('picks the one My Team starts, with the gap, and records the call', async () => {
    const calls: unknown[] = []
    const out = (await ss(data, ['wade hands', 'Benchy Burner'], (c) => calls.push(c))) as string
    expect(out).toContain('Verdict: START Benchy Burner over Wade Hands (6 pts).')
    expect(calls).toEqual([{ leagueId: 'L', season: 2026, week: 11, rec: { key: '3', name: 'Benchy Burner' }, alt: { key: '2', name: 'Wade Hands' }, slot: null }])
  })

  it('says BOTH START or NEITHER STARTS rather than inventing an either/or', async () => {
    expect(await ss(data, ['Quinn Arm', 'Benchy Burner'])).toContain('BOTH START')
    expect(await ss(data, ['Wade Hands', 'Ronnie Backup'])).toContain('NEITHER STARTS')
  })

  it('another sport with a My Team best lineup is answered from it too', async () => {
    const nhl = { league: { id: 'L', name: 'Ice League', platform: 'sleeper', sport: 'NHL', format: 'redraft', sourceLink: null } }
    const out = (await ss(myTeam([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [wr2, rbBench], nhl as never), ['Wade Hands', 'Benchy Burner'])) as string
    expect(typeof out).toBe('string')
    expect(out).toContain("FROM MY TEAM'S BEST LINEUP")
  })

  it('a name not on this roster goes to the scenario tool, which names the problem', async () => {
    expect(await ss(data, ['Somebody Else', 'Benchy Burner'])).toEqual({ fallback: 'not_nfl' })
  })
})

describe('the answer is decided at the moment it is given, not when the shared load ran (2026-11-20)', () => {
  /*
   * The load is shared for up to 60 s and its verdict was computed with the load's clock, while the "locked" flags use
   * the answer's clock. In the minute a game kicks off the block could say "start X" and label X locked.
   */
  const kickoff = new Date(NOW.getTime() + 30_000)
  const burner = player('3', 'Benchy Burner', 'WR', 15, { kickoff })

  it('🛑 a bench player whose game started after the load is not recommended', async () => {
    const data = myTeam([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [burner, rbBench])
    // Control: at load time he was the swap.
    expect(data.lineupOptimizer).toMatchObject({ state: 'improve', changes: [{ inName: 'Benchy Burner' }] })
    const answeredAt = new Date(NOW.getTime() + 60_000)
    const out = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: answeredAt }, { load: async () => data })) as string
    expect(out).not.toContain('start Benchy Burner')
    expect(out).toContain('Benchy Burner (WR) 15 pts [game started — locked]')
  })

  it('answered inside the same moment as the load, the verdict is unchanged', async () => {
    const data = myTeam([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [burner, rbBench])
    const out = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => data })) as string
    expect(out).toContain('- WR: start Benchy Burner (15 pts) instead of Wade Hands (9 pts).')
  })

  it('no answer at load time stays no answer', async () => {
    const data = myTeam([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [burner, rbBench], { lineupOptimizer: null } as never)
    const out = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => data }))
    expect(out).not.toEqual(expect.stringContaining('Verdict:'))
  })
})
