// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { buildFocusInsights } = await import('@/lib/core-app/seasonOutlookFocus')
import type { ScenarioModel, ScenarioPlayer } from '@/lib/core-app/outlookScenario'
import type { SimInput } from '@/lib/core-app/outlookSim'

const IDS = ['1', '2', '3', '4', '5', '6']

function sim(): SimInput {
  const remaining = []
  const list = [...IDS]
  for (let w = 0; w < 5; w += 1) {
    for (let i = 0; i < 3; i += 1) remaining.push({ week: 4 + w, a: list[i], b: list[5 - i] })
    list.splice(1, 0, list.pop()!)
  }
  return {
    teams: IDS.map((id) => ({
      rosterId: id,
      wins: id === '1' ? 3 : 1,
      losses: id === '1' ? 0 : 2,
      pointsFor: 330,
      profile: { mu: id === '1' ? 125 : 105, sigma: 20, n: 30 },
    })),
    remaining,
    playoffTeams: 3,
    byeTeams: 1,
  }
}

function p(id: string, position: string, points: number | null, slot: ScenarioPlayer['slot'], extra: Partial<ScenarioPlayer> = {}): ScenarioPlayer {
  return { id, name: `P${id}`, position, team: 'BUF', points, slot, injury: null, byeWeek: null, age: 26, ...extra }
}

function model(over: Partial<ScenarioModel> = {}): ScenarioModel {
  const s = sim()
  return {
    leagueId: 'L1',
    basisWeek: { season: '2026', week: 4 },
    refusal: null,
    slots: ['QB', 'RB', 'WR', 'FLEX'],
    teams: IDS.map((id) => ({
      rosterId: id,
      name: `Team ${id}`,
      isYou: id === '1',
      players:
        id === '1'
          ? [
              p('qb', 'QB', 22, 'S', { age: 36 }),
              p('rb', 'RB', 16, 'S', { injury: { status: 'Out', kind: 'out' }, byeWeek: 6 }),
              p('wr', 'WR', 14, 'S', { byeWeek: 6 }),
              p('flex', 'RB', 6, 'S', { age: 29 }),
              p('bench', 'WR', 11, 'B'),
              p('rb3', 'RB', 5, 'B'),
            ]
          : [p(`q${id}`, 'QB', 18, 'S'), p(`r${id}`, 'RB', 12, 'S'), p(`w${id}`, 'WR', 11, 'S'), p(`f${id}`, 'WR', 9, 'S')],
    })),
    freeAgents: [p('fa', 'WR', 17, 'F')],
    sim: s,
    seed: 7,
    weeks: [4, 5, 6, 7, 8],
    youRosterId: '1',
    ...over,
  }
}

function run(m = model()) {
  return buildFocusInsights({
    leagueId: 'L1',
    leagueName: 'Test',
    sim: m.sim,
    seed: m.seed,
    youRosterId: '1',
    weeks: m.weeks,
    expectedWins: 1.2,
    remainingRank: 2,
    remainingOpponentMu: 108,
    leagueMu: 108.3,
    teamsRanked: 6,
    swing: { week: 4, opponentName: 'Team 6', ifWin: 90, ifLose: 60 },
    model: m,
    injuryFeedNote: null,
  })
}

describe('buildFocusInsights', () => {
  it('ranks drivers by size and keeps the swing as a spread', () => {
    const out = run()
    const sizes = out.drivers.map((d) => Math.abs(d.impact))
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    const swing = out.drivers.find((d) => d.key === 'swing')!
    expect(swing).toMatchObject({ spread: true, impact: 15 })
    // A strong team that is ahead of its all-play record has luck and strength working for it.
    expect(out.drivers.find((d) => d.key === 'strength')!.impact).toBeGreaterThan(0)
    expect(out.drivers.find((d) => d.key === 'luck')!.impact).toBeGreaterThan(0)
  })

  it('prices the ruled-out starter as a cost — for a team on the bubble, where a week matters', () => {
    // A 3–0 favourite loses under a point of odds to one missing starter, and that is filtered as
    // noise. On the bubble the same absence is a real driver.
    const m = model()
    m.sim.teams = m.sim.teams.map((t) => (t.rosterId === '1' ? { ...t, wins: 1, losses: 2, profile: { mu: 106, sigma: 20, n: 30 } } : t))
    const inj = run(m).drivers.find((d) => d.key === 'injuries')
    expect(inj).toBeDefined()
    expect(inj!.impact).toBeLessThan(0)
    expect(inj!.detail).toMatch(/Prb is ruled out/)
  })

  it('suggests setting the best lineup and the best waiver add, each with its effect on the odds', () => {
    const out = run()
    const lineup = out.moves.find((m) => m.kind === 'lineup')!
    // As set: QB 22 + RB 0 (out) + WR 14 + FLEX 6 = 42. Best: QB 22 + RB 6 + WR 14 + FLEX (bench WR) 11 = 53.
    expect(lineup.pointsPerWeek).toBe(11)
    expect(lineup.week).toBe(4)
    expect(lineup.detail).toMatch(/Prb \(out\)/)
    const waiver = out.moves.find((m) => m.kind === 'waiver')!
    expect(waiver.title).toMatch(/Add Pfa/)
    expect(waiver.pointsPerWeek).toBeGreaterThanOrEqual(1)
    for (const m of out.moves) {
      expect(Number.isFinite(m.playoffDelta)).toBe(true)
      expect(Number.isFinite(m.titleDelta)).toBe(true)
    }
  })

  it('reports durability: age, depth, injuries, byes and concentration', () => {
    const d = run().durability!
    expect(d.age.older.map((o) => o.name)).toEqual(expect.arrayContaining(['Pqb', 'Pflex']))
    expect(d.injuries[0]).toMatchObject({ name: 'Prb', kind: 'out', starting: true })
    expect(d.byes.find((b) => b.week === 6)?.players).toContain('Pwr')
    expect(d.concentration.stack?.team).toBe('BUF')
    expect(d.flags.join(' ')).toMatch(/ruled out/)
  })

  it('refuses roster-based parts by name when the league cannot be priced', () => {
    const out = run(model({ refusal: 'Roster changes cannot be priced here: no rulebook.' }))
    expect(out.moves).toEqual([])
    expect(out.durability).toBeNull()
    expect(out.notes[0]).toMatch(/no rulebook/)
    // Schedule, strength and swing need no rosters.
    expect(out.drivers.some((d) => d.key === 'swing')).toBe(true)
  })

  it('does not suggest a lineup move for a projection week that is not left to play', () => {
    const out = run(model({ basisWeek: { season: '2026', week: 2 } }))
    expect(out.moves.some((m) => m.kind === 'lineup')).toBe(false)
    expect(out.notes.join(' ')).toMatch(/week 2/)
  })
})
