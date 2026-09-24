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
})
