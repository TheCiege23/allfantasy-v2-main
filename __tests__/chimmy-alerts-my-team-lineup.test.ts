import { describe, expect, it, vi } from 'vitest'

/**
 * 2026-11-21 code re-score: the scheduled lineup and slate-lock alerts used a second optimizer, so an alert could say
 * "start X" that My Team — opened from the alert — did not. They now read My Team's own best lineup.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { lineupOptimizationFromMyTeam } = await import('@/lib/chimmy-alerts/myTeamLineupOptimization')
const { findLineupIssues } = await import('@/lib/chimmy-alerts/lineupCheck')
const { optimizeLineup } = await import('@/lib/decision-os/lineup/bestLineup')

const NOW = new Date('2026-11-22T15:00:00Z')
const SUNDAY = new Date('2026-11-22T18:00:00Z')
const player = (id: string, position: string, points: number | null, over: Record<string, unknown> = {}) => ({
  sleeperId: id, name: `Player ${id}`, position, team: 'AAA', injuryStatus: null, ruledOut: false, onBye: false,
  afProjectedPoints: points, kickoff: SUNDAY, ...over,
})
const slot = (label: string, p: ReturnType<typeof player> | null) => ({ slotLabel: label, benchCheck: null, player: p, empty: p == null })
const data = (starters: ReturnType<typeof slot>[], bench: ReturnType<typeof player>[]) =>
  ({
    league: { sport: 'NFL', bestBall: false },
    starters: { available: true, data: starters },
    bench: { available: true, data: bench },
    projections: { available: true, data: { season: '2026', week: 12 } },
  }) as never

describe('the lineup alerts answer from My Team', () => {
  it('a swap My Team calls is the swap the alert pushes, with My Team\'s own gain', () => {
    const starters = [slot('RB', player('1', 'RB', 6)), slot('WR', player('2', 'WR', 14))]
    const bench = [player('3', 'RB', 15)]
    const d = data(starters, bench)
    const out = lineupOptimizationFromMyTeam(d, NOW)
    const mine = optimizeLineup({ starters: starters as never, bench: bench as never, sport: 'NFL', now: NOW })!
    expect(out.status).toBe('ready')
    if (out.status !== 'ready' || mine.state !== 'improve') throw new Error('expected a swap')
    expect(out.gain).toBe(mine.gain)
    expect(out.startInstead.map((p) => p.name)).toEqual(['Player 3'])
    expect(out.benchInstead.map((p) => p.name)).toEqual(['Player 1'])
    expect(findLineupIssues(out, () => false)).toEqual([expect.objectContaining({ kind: 'reshuffle', gain: 9 })])
  })

  it('a close call inside projection noise is not pushed — My Team calls it close too', () => {
    const out = lineupOptimizationFromMyTeam(data([slot('RB', player('1', 'RB', 10))], [player('3', 'RB', 11)]), NOW)
    if (out.status !== 'ready') throw new Error('expected ready')
    expect(out.startInstead).toEqual([])
    expect(out.gain).toBe(0)
    expect(findLineupIssues(out, () => false)).toEqual([])
  })

  it('an empty seat, a ruled-out starter and an unpriced starter are each flagged; an unpriced one gives no swap', () => {
    const out = lineupOptimizationFromMyTeam(
      data([slot('RB', null), slot('WR', player('2', 'WR', 12, { ruledOut: true, injuryStatus: 'Out' })), slot('TE', player('4', 'TE', null))], [player('5', 'TE', 7)]),
      NOW,
    )
    if (out.status !== 'ready') throw new Error('expected ready')
    expect(out.current.emptySlots).toBe(1)
    // A ruled-out starter is priced at 0, as My Team prices him, never at his healthy projection.
    expect(out.current.starters.find((p) => p.playerId === '2')?.points).toBe(0)
    expect(out.gain).toBeNull()
    const kinds = findLineupIssues(out, () => false).map((i) => i.kind)
    expect(kinds).toEqual(expect.arrayContaining(['empty_slots', 'no_projection', 'ruled_out']))
    expect(kinds).not.toContain('reshuffle')
  })

  it('no alert from a lineup My Team cannot answer honestly: an unidentified starter, best ball, no projections', () => {
    const unresolved = data([{ slotLabel: 'RB', benchCheck: null, player: null, empty: false } as never], [])
    expect(lineupOptimizationFromMyTeam(unresolved, NOW).status).toBe('unresolved')
    expect(lineupOptimizationFromMyTeam({ ...(data([], []) as object), bestBall: true } as never, NOW).status).toBe('unresolved')
    expect(lineupOptimizationFromMyTeam({ ...(data([], []) as object), projections: { available: false, reason: 'none' } } as never, NOW).status).toBe('unresolved')
  })

  it('both scheduled alerts default to My Team\'s optimizer', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['lib/chimmy-alerts/runLineupCheck.ts', 'lib/chimmy-alerts/runSlateLockCheck.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src).toMatch(/^\s*optimize: \(leagueId, userId\) => myTeamLineupOptimization\(leagueId, userId\),$/m)
      expect(src).not.toMatch(/^\s*optimize: \(leagueId, userId\) => buildLineupOptimization/m)
    }
  })
})
