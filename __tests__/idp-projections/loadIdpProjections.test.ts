import { describe, expect, it, vi } from 'vitest'

import { loadIdpProjections } from '@/lib/idp-projections/loadIdpProjections'

type GameRow = {
  playerId: string
  season: number
  weekOrRound: number
  opponent: string | null
  normalizedStatMap: Record<string, unknown>
}

function game(playerId: string, week: number, over: Record<string, number> = {}): GameRow {
  return {
    playerId,
    season: 2025,
    weekOrRound: week,
    opponent: 'IND',
    normalizedStatMap: { idp_tkl_solo: 5, idp_tkl_ast: 3, ...over },
  }
}

/**
 * A prisma double that evaluates the real `OR` the loader builds: earlier weeks of the target
 * season, plus whole earlier seasons. Modelling the actual clause is the point — a double that
 * quietly ignores it would let a leak through and still go green.
 */
function fakePrisma(rows: GameRow[], pace: Array<{ teamId: string; secPerPlay: number | null }>) {
  const findMany = vi.fn(async ({ where }: any) => {
    const ids: string[] = where.playerId.in
    const matches = (r: GameRow) =>
      where.OR.some((clause: any) => {
        if (typeof clause.season === 'number') {
          return r.season === clause.season && r.weekOrRound < clause.weekOrRound.lt
        }
        return r.season >= clause.season.gte && r.season < clause.season.lt
      })
    return rows.filter((r) => ids.includes(r.playerId) && matches(r))
  })
  return {
    playerGameStat: { findMany },
    teamTendencySeason: { findMany: vi.fn(async () => pace) },
    _findMany: findMany,
  } as any
}

const LBS = Array.from({ length: 12 }, (_, i) => ({
  sleeperId: `lb${i}`,
  position: 'LB',
}))

function fullHistory(): GameRow[] {
  return LBS.flatMap((p) => [1, 2, 3, 4, 5, 6].map((w) => game(p.sleeperId, w)))
}

describe('loadIdpProjections', () => {
  it('never reads the week it is projecting', async () => {
    // Week 7 carries an absurd line. If it leaked in, the projection would jump.
    const rows = [...fullHistory(), ...LBS.map((p) => game(p.sleeperId, 7, { idp_tkl_solo: 99 }))]
    const prisma = fakePrisma(rows, [{ teamId: 'IND', secPerPlay: 27 }])

    const { bySleeperId } = await loadIdpProjections({
      prisma,
      season: 2025,
      week: 7,
      players: LBS,
    })

    const out = bySleeperId.get('lb0')!
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.statLine.idp_tkl_solo).toBeCloseTo(5, 1)
    const where = prisma._findMany.mock.calls[0][0].where
    expect(where.OR).toContainEqual({ season: 2025, weekOrRound: { lt: 7 } })
  })

  it('reports coverage and counts refusals by reason instead of swallowing them', async () => {
    const rows = [
      ...fullHistory(),
      // One linebacker with a single game — too thin to project.
      game('thin', 1),
    ]
    const prisma = fakePrisma(rows, [{ teamId: 'IND', secPerPlay: 27 }])

    const { coverage } = await loadIdpProjections({
      prisma,
      season: 2025,
      week: 8,
      players: [
        ...LBS,
        { sleeperId: 'thin', position: 'LB' },
        { sleeperId: 'nohistory', position: 'LB' },
        { sleeperId: 'qb1', position: 'QB' },
      ],
    })

    expect(coverage.requested).toBe(15)
    expect(coverage.projected).toBe(12)
    expect(coverage.refused).toBe(3)
    expect(coverage.refusalsByReason).toEqual({
      insufficient_sample: 1,
      no_history: 1,
      not_idp_position: 1,
    })
    expect(coverage.refusalRate).toBeCloseTo(3 / 15, 3)
    /*
     * 12 starters x 6 games, PLUS the single game belonging to the linebacker who was too
     * thin to project. A player can be below the projection threshold and still be a valid
     * observation in the cohort he is regressed toward — those are different questions.
     */
    expect(coverage.priorsByPosition.LB).toBe(73)
  })

  it('applies opponent pace only when the opponent and a season mean are both known', async () => {
    const prisma = fakePrisma(fullHistory(), [
      { teamId: 'IND', secPerPlay: 25 },
      { teamId: 'DEN', secPerPlay: 31 },
    ])

    const withPace = await loadIdpProjections({
      prisma,
      season: 2025,
      week: 7,
      players: LBS,
      opponentBySleeperId: new Map(LBS.map((p) => [p.sleeperId, 'IND'])),
    })
    const withoutPace = await loadIdpProjections({
      prisma,
      season: 2025,
      week: 7,
      players: LBS,
    })

    expect(withPace.coverage.paceAvailable).toBe(true)
    expect(withoutPace.coverage.paceAvailable).toBe(false)

    const fast = withPace.bySleeperId.get('lb0')!
    const flat = withoutPace.bySleeperId.get('lb0')!
    expect(fast.ok && flat.ok).toBe(true)
    if (!fast.ok || !flat.ok) return
    // IND at 25s/play against a 28s mean is a fast offense — more snaps faced.
    expect(fast.statLine.idp_tkl_solo!).toBeGreaterThan(flat.statLine.idp_tkl_solo!)
  })

  it('degrades to no pace rather than failing when the tendency table is empty', async () => {
    const prisma = fakePrisma(fullHistory(), [])
    const { bySleeperId, coverage } = await loadIdpProjections({
      prisma,
      season: 2025,
      week: 7,
      players: LBS,
      opponentBySleeperId: new Map(LBS.map((p) => [p.sleeperId, 'IND'])),
    })
    expect(coverage.paceAvailable).toBe(false)
    expect(bySleeperId.get('lb0')!.ok).toBe(true)
  })

  it('projects in week 1 from last season rather than refusing the whole league', async () => {
    /*
     * The regression this guards. Restricted to the target season, week 1 has no games with
     * `week < 1`, so every defender refuses for `no_history` and the feature reads as broken
     * for the first month of every season.
     */
    const lastSeason = fullHistory().map((r) => ({ ...r, season: 2025 }))
    const prisma = fakePrisma(lastSeason, [{ teamId: 'IND', secPerPlay: 27 }])

    const { bySleeperId, coverage } = await loadIdpProjections({
      prisma,
      season: 2026,
      week: 1,
      players: LBS,
    })

    expect(coverage.refused).toBe(0)
    const out = bySleeperId.get('lb0')!
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.statLine.idp_tkl_solo).toBeCloseTo(5, 1)
  })

  it('short-circuits on an empty player list without touching the database', async () => {
    const prisma = fakePrisma([], [])
    const { coverage } = await loadIdpProjections({ prisma, season: 2025, week: 7, players: [] })
    expect(coverage.requested).toBe(0)
    expect(prisma._findMany).not.toHaveBeenCalled()
  })
})
