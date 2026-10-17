// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildZombieMatchups, infectionPairsForWeek } from '@/lib/zombie/zombieMatchupBoard'
import { pickTurnMoment, withBoardDetail, type ZombieBoardEntry } from '@/lib/zombie/zombieHomeSummary'

const RULES = { bashingThreshold: 128, maulingThreshold: 211 }
const r = (id: string, home: string, away: string, hs: number, as: number, final = true) => ({
  matchupId: id,
  homeRosterId: home,
  awayRosterId: away,
  homeScore: hs,
  awayScore: as,
  final,
})

const statuses: Record<string, string> = { A: 'Survivor', B: 'Zombie', C: 'Survivor', D: 'Survivor', E: 'Survivor', F: 'Zombie' }
const base = {
  statusOf: (id: string) => statuses[id] ?? 'Survivor',
  nameOf: (id: string) => `Team ${id}`,
  rules: RULES,
  lossToZombieInfects: true,
}

describe('buildZombieMatchups', () => {
  it('takes the transfer from the winnings engine: an infection moves the whole week, a mauling half, a bashing a quarter', () => {
    const views = buildZombieMatchups({
      ...base,
      results: [
        r('m1', 'A', 'B', 900, 1000), // A (Survivor) loses to B (Zombie): infected
        r('m2', 'C', 'D', 1300, 1000), // 300: mauling
        r('m3', 'E', 'F', 1200, 1050), // 150: bashing
      ],
      infected: [{ victimRosterId: 'A', infectorRosterId: 'B' }],
      myRosterId: 'C',
    })
    expect(views.map((v) => [v.id, v.outcome?.kind, v.transfer?.amount])).toEqual([
      ['m1', 'infection', 900],
      ['m2', 'mauling', 500],
      ['m3', 'bashing', 262.5],
    ])
    expect(views[0]!.transfer).toMatchObject({ fromRosterId: 'A', toRosterId: 'B' })
    expect(views[1]!.mySide).toBe('home')
  })

  it('before the week is final: shows what is on pace and who is at risk, and moves nothing', () => {
    const [v] = buildZombieMatchups({ ...base, results: [r('m1', 'A', 'B', 700, 940, false)], infected: [] })
    expect(v!.transfer).toBeNull()
    expect(v!.outcome).toEqual({ kind: 'mauling', final: false })
    expect(v!.atRisk).toBe('home')
  })

  it('never puts an infection at stake against a team the viewer sees as a Survivor (a hidden Whisperer)', () => {
    const [v] = buildZombieMatchups({ ...base, results: [r('m1', 'A', 'C', 700, 720, false)], infected: [] })
    expect(v!.atRisk).toBeNull()
  })

  it('two infected teams put no infection at stake', () => {
    const [v] = buildZombieMatchups({ ...base, results: [r('m1', 'B', 'F', 700, 720, false)], infected: [] })
    expect(v!.atRisk).toBeNull()
  })

  it('a tie moves nothing and leads nobody', () => {
    const [v] = buildZombieMatchups({ ...base, results: [r('m1', 'C', 'D', 1000, 1000)], infected: [] })
    expect(v!.leader).toBeNull()
    expect(v!.transfer).toBeNull()
    expect(v!.outcome).toBeNull()
  })
})

describe('infectionPairsForWeek', () => {
  it('reads only that week, and only rows that name an infector', () => {
    expect(
      infectionPairsForWeek(
        [
          { rosterId: 'A', weekBecameZombie: 3, killedByRosterId: 'B' },
          { rosterId: 'C', weekBecameZombie: 2, killedByRosterId: 'B' },
          { rosterId: 'D', weekBecameZombie: 3, killedByRosterId: null },
        ],
        3,
      ),
    ).toEqual([{ victimRosterId: 'A', infectorRosterId: 'B' }])
  })
})

describe('pickTurnMoment', () => {
  const me = (over: Partial<{ status: string; weekBecameZombie: number | null; killedByRosterId: string | null; revivedAt: Date | null }>) => ({
    rosterId: 'A',
    status: 'Survivor',
    weekBecameZombie: null,
    killedByRosterId: null,
    revivedAt: null,
    ...over,
  })
  const ctx = { statusOf: base.statusOf, nameOf: base.nameOf, hiddenRoster: () => false }

  it('turned: you became a Zombie in the latest resolved week', () => {
    expect(
      pickTurnMoment({ ...ctx, lastResolvedWeek: 3, me: me({ status: 'Zombie', weekBecameZombie: 3, killedByRosterId: 'B' }), results: [r('m1', 'A', 'B', 900, 1000)] }),
    ).toEqual({ kind: 'turned', week: 3, opponentName: 'Team B', myScore: 900, opponentScore: 1000, key: 'turned:3' })
  })

  it('turned an earlier week: nothing to announce now', () => {
    expect(pickTurnMoment({ ...ctx, lastResolvedWeek: 4, me: me({ status: 'Zombie', weekBecameZombie: 3 }), results: [] })).toBeNull()
  })

  it('never names an infector the viewer may not know', () => {
    const m = pickTurnMoment({
      ...ctx,
      hiddenRoster: (id) => id === 'W',
      lastResolvedWeek: 3,
      me: me({ status: 'Zombie', weekBecameZombie: 3, killedByRosterId: 'W' }),
      results: [r('m1', 'A', 'W', 900, 1000)],
    })
    expect(m?.opponentName).toBeNull()
  })

  it('survived: a Survivor who beat an infected opponent', () => {
    const m = pickTurnMoment({ ...ctx, lastResolvedWeek: 3, me: me({}), results: [r('m1', 'A', 'B', 1100, 1000)] })
    expect(m).toMatchObject({ kind: 'survived', opponentName: 'Team B', key: 'survived:3' })
  })

  it('beating a Survivor is not a moment', () => {
    expect(pickTurnMoment({ ...ctx, lastResolvedWeek: 3, me: me({}), results: [r('m1', 'A', 'C', 1100, 1000)] })).toBeNull()
  })

  it('revived: keyed on the revival, so it shows once per revival', () => {
    const at = new Date('2026-10-28T12:00:00Z')
    expect(pickTurnMoment({ ...ctx, lastResolvedWeek: 3, me: me({ revivedAt: at }), results: [] })?.key).toBe(`revived:${at.toISOString()}`)
  })

  it('nothing before the first resolution, or without a team', () => {
    expect(pickTurnMoment({ ...ctx, lastResolvedWeek: null, me: me({}), results: [] })).toBeNull()
    expect(pickTurnMoment({ ...ctx, lastResolvedWeek: 3, me: null, results: [] })).toBeNull()
  })
})

describe('withBoardDetail', () => {
  it('attaches the scores and the points the engine moved to each entry', () => {
    const views = buildZombieMatchups({
      ...base,
      results: [r('m1', 'A', 'B', 900, 1000), r('m2', 'C', 'D', 1300, 1000)],
      infected: [{ victimRosterId: 'A', infectorRosterId: 'B' }],
    })
    const board: ZombieBoardEntry[] = [
      { kind: 'infection', victimRosterId: 'A', infectorRosterId: 'B' },
      { kind: 'mauling', winnerRosterId: 'C', loserRosterId: 'D', margin: 300 },
    ]
    expect(withBoardDetail(board, views)).toEqual([
      { kind: 'infection', victimRosterId: 'A', infectorRosterId: 'B', winnerScore: 1000, loserScore: 900, amount: 900 },
      { kind: 'mauling', winnerRosterId: 'C', loserRosterId: 'D', margin: 300, winnerScore: 1300, loserScore: 1000, amount: 500 },
    ])
  })
})
