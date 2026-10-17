import { describe, expect, it, vi } from 'vitest'

/*
 * `loadAbsencesBySport` keeps the reason ("IR", "on bye") that `loadUnavailableBySport` used to throw
 * away. It is the same reads and the same `isRuledOut` rule, and the old function is now its key set —
 * so the rail, the matchup board and the waiver board, which read the old one, cannot drift from the
 * Waiver Intelligence list, which reads the new one.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async () => [
        { sleeperId: 'ir', name: 'Hurt Back', team: 'MIN', sport: 'NFL' },
        { sleeperId: 'q', name: 'Questionable Back', team: 'NYJ', sport: 'NFL' },
        { sleeperId: 'bye', name: 'Bye Back', team: 'KC', sport: 'NFL' },
        { sleeperId: 'both', name: 'Out On Bye', team: 'KC', sport: 'NFL' },
        { sleeperId: 'fine', name: 'Fine Back', team: 'BUF', sport: 'NFL' },
      ]),
    },
  },
}))
vi.mock('@/lib/core-app/injuryStatusById', () => ({
  namesBySleeperId: () => new Map(),
  readInjuryStatusById: vi.fn(async () => new Map([['ir', 'IR'], ['q', 'Questionable'], ['both', 'Out']])),
}))
vi.mock('@/lib/core-app/playerIdentityCompose', () => ({
  composePlayerIdentities: (rows: Array<{ sleeperId: string; team: string }>) => new Map(rows.map((r) => [r.sleeperId, { team: r.team }])),
}))
vi.mock('@/lib/core-app/byeWeeks', () => ({
  getByeWeeks: vi.fn(async () => ({ byWeek: new Map([[4, new Set(['bye', 'both'])]]) })),
}))

const { loadAbsencesBySport, loadUnavailableBySport } = await import('@/lib/core-app/unavailableStarters')
const ARGS = { sleeperIds: ['ir', 'q', 'bye', 'both', 'fine'], sports: ['NFL'], season: 2026, week: 4 }

describe('loadAbsencesBySport', () => {
  it('says why each player is out: the designation, or the bye', async () => {
    const nfl = (await loadAbsencesBySport(ARGS)).get('NFL')!
    expect(nfl.get('ir')).toEqual({ kind: 'ruled_out', status: 'IR' })
    expect(nfl.get('bye')).toEqual({ kind: 'bye' })
    expect(nfl.has('q')).toBe(false) // questionable is not ruled out
    expect(nfl.has('fine')).toBe(false)
  })

  it('a designation wins over a bye when a player has both', async () => {
    const nfl = (await loadAbsencesBySport(ARGS)).get('NFL')!
    expect(nfl.get('both')).toEqual({ kind: 'ruled_out', status: 'Out' })
  })

  it('loadUnavailableBySport is exactly its key set — the readers that price at zero are unchanged', async () => {
    const reasons = (await loadAbsencesBySport(ARGS)).get('NFL')!
    const ids = (await loadUnavailableBySport(ARGS)).get('NFL')!
    expect([...ids].sort()).toEqual([...reasons.keys()].sort())
    expect([...ids].sort()).toEqual(['both', 'bye', 'ir'])
  })
})
