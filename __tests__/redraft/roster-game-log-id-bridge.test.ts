import { describe, expect, it, vi } from 'vitest'

import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'

/*
 * Roster ids -> player_game_stats ids for the daily sports. A native NHL/NCAAB roster holds the
 * draft pool's Rolling Insights id; the game logs are keyed on PlayerIdentityMap.id. Measured on
 * production 2026-09-24: 0 of 18,222 NCAAB and 0 of 5,502 NHL pool ids find a game log directly.
 */

type Row = { id: string; rollingInsightsId: string | null; sleeperId: string | null }

function db(byRi: Row[], bySleeper: Row[] = []) {
  const findMany = vi.fn(async (args: { where: Record<string, unknown> }) =>
    'rollingInsightsId' in args.where ? byRi : bySleeper,
  )
  return { findMany, db: { playerIdentityMap: { findMany } } as never }
}

describe('bridgeRosterIdsToGameLogIds', () => {
  it('maps an RI roster id to the identity id its game logs are stored under', async () => {
    const { db: d } = db([{ id: 'pim-1', rollingInsightsId: '16158', sleeperId: null }])
    const b = await bridgeRosterIdsToGameLogIds(d, ['NCAAB'], ['16158'])
    expect(b.gameLogIds).toContain('pim-1')
    expect(b.rosterIdFor('pim-1')).toBe('16158')
    expect(b.bridged).toBe(1)
  })

  it('keeps every roster id as itself, so a roster already holding identity ids still works', async () => {
    const { db: d, findMany } = db([])
    const b = await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['pim-already', 'name:Someone:C:BOS'])
    expect(b.rosterIdFor('pim-already')).toBe('pim-already')
    expect(b.rosterIdFor('name:Someone:C:BOS')).toBe('name:Someone:C:BOS')
    // Nothing numeric, so the identity map is not even asked.
    expect(findMany).not.toHaveBeenCalled()
  })

  it('scopes the lookup to the sport — RI ids are unique per sport, not across sports', async () => {
    const { db: d, findMany } = db([])
    await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['3932'])
    for (const [args] of findMany.mock.calls) expect(args.where.sport).toEqual({ in: ['NHL'] })
  })

  it('REFUSES an id that is also ANOTHER player\'s Sleeper id in the sport (the numeric spaces collide)', async () => {
    const { db: d } = db(
      [{ id: 'pim-ri', rollingInsightsId: '5850', sleeperId: null }],
      [{ id: 'pim-other', rollingInsightsId: null, sleeperId: '5850' }],
    )
    const b = await bridgeRosterIdsToGameLogIds(d, ['NBA'], ['5850'])
    expect(b.ambiguous).toEqual(['5850'])
    expect(b.gameLogIds).not.toContain('pim-ri')
    expect(b.bridged).toBe(0)
  })

  it('does not treat a player\'s OWN matching Sleeper id as a clash', async () => {
    const me = { id: 'pim-me', rollingInsightsId: '777', sleeperId: '777' }
    const { db: d } = db([me], [me])
    const b = await bridgeRosterIdsToGameLogIds(d, ['NBA'], ['777'])
    expect(b.ambiguous).toEqual([])
    expect(b.rosterIdFor('pim-me')).toBe('777')
  })

  describe('tsdb_ roster ids (an older draft pool), bridged by name', () => {
    type Pim = Row & { normalizedName: string }
    function nameDb(byRi: Pim[], byName: Pim[]) {
      const findMany = vi.fn(async (args: { where: Record<string, unknown> }) =>
        'rollingInsightsId' in args.where ? byRi : 'normalizedName' in args.where ? byName : [],
      )
      return { findMany, db: { playerIdentityMap: { findMany } } as never }
    }
    const fox: Pim = { id: 'pim-fox', rollingInsightsId: '2359', sleeperId: null, normalizedName: 'adam fox' }

    it('maps a tsdb_ id to the one identity carrying its name', async () => {
      const { db: d, findMany } = nameDb([], [fox])
      const b = await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['tsdb_34176537'], new Map([['tsdb_34176537', 'Adam Fox']]))
      expect(b.rosterIdFor('pim-fox')).toBe('tsdb_34176537')
      expect(b).toMatchObject({ bridged: 1, bridgedByName: 1, nameRefused: [] })
      const byName = findMany.mock.calls.find(([a]) => 'normalizedName' in a.where)![0]
      expect(byName.where).toEqual({ sport: { in: ['NHL'] }, normalizedName: { in: ['adam fox'] } })
    })

    it('folds accents the way the identity map stores names', async () => {
      const raty: Pim = { id: 'pim-raty', rollingInsightsId: '3020', sleeperId: null, normalizedName: 'aatu raty' }
      const { db: d } = nameDb([], [raty])
      const b = await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['tsdb_34184761'], new Map([['tsdb_34184761', 'Aatu Räty']]))
      expect(b.rosterIdFor('pim-raty')).toBe('tsdb_34184761')
    })

    it('REFUSES a name another roster id of the league already reaches (one man drafted twice)', async () => {
      const raty: Pim = { id: 'pim-raty', rollingInsightsId: '3020', sleeperId: null, normalizedName: 'aatu raty' }
      const { db: d } = nameDb([raty], [raty])
      const b = await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['3020', 'tsdb_34184761'], new Map([['tsdb_34184761', 'Aatu Räty']]))
      // His games stay with the Rolling Insights copy, once.
      expect(b.rosterIdFor('pim-raty')).toBe('3020')
      expect(b.nameRefused).toEqual(['tsdb_34184761'])
      expect(b.bridgedByName).toBe(0)
    })

    it('REFUSES a name two identities carry (namesakes), and two tsdb_ ids sharing a name', async () => {
      const a: Pim = { id: 'pim-a', rollingInsightsId: '1', sleeperId: null, normalizedName: 'luis garcia' }
      const b2: Pim = { id: 'pim-b', rollingInsightsId: '2', sleeperId: null, normalizedName: 'luis garcia' }
      const { db: d1 } = nameDb([], [a, b2])
      const one = await bridgeRosterIdsToGameLogIds(d1, ['MLB'], ['tsdb_1'], new Map([['tsdb_1', 'Luis Garcia']]))
      expect(one.nameRefused).toEqual(['tsdb_1'])
      expect(one.gameLogIds).toEqual(['tsdb_1'])

      const { db: d2 } = nameDb([], [fox])
      const two = await bridgeRosterIdsToGameLogIds(d2, ['NHL'], ['tsdb_1', 'tsdb_2'], new Map([['tsdb_1', 'Adam Fox'], ['tsdb_2', 'Adam Fox']]))
      expect(two.nameRefused.sort()).toEqual(['tsdb_1', 'tsdb_2'])
      expect(two.rosterIdFor('pim-fox')).toBeUndefined()
    })

    it('without names, or without a tsdb_ id, the identity map is never asked by name', async () => {
      const { db: d, findMany } = nameDb([], [fox])
      await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['tsdb_34176537'])
      await bridgeRosterIdsToGameLogIds(d, ['NHL'], ['name:Adam Fox:D:NYR'], new Map([['name:Adam Fox:D:NYR', 'Adam Fox']]))
      expect(findMany).not.toHaveBeenCalled()
    })
  })
})
