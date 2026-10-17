/**
 * `crosswalkToRollingInsightsIds` — league ids → RI ids through `PlayerIdentityMap`, refusing every
 * mapping that is not one-to-one. Shared by `/api/redraft/roster` and `/api/players/rolling-insights/batch`.
 */
import { describe, expect, it, vi } from 'vitest'
import { crosswalkToRollingInsightsIds, type RiCrosswalkDb } from '@/lib/player-identity/rollingInsightsCrosswalk'

type Row = Record<string, unknown>

function fakeDb(rows: Row[]) {
  const findMany = vi.fn(async (args: { where: Row }) => {
    const where = args.where as { sport: string; OR: Array<Record<string, { in: string[] }>> }
    return rows.filter(
      (r) =>
        r.sport === where.sport &&
        r.rollingInsightsId != null &&
        where.OR.some((clause) => Object.entries(clause).every(([col, c]) => c.in.includes(r[col] as string))),
    )
  })
  return { db: { playerIdentityMap: { findMany } } as unknown as RiCrosswalkDb, findMany }
}

describe('crosswalkToRollingInsightsIds', () => {
  it('maps a Sleeper id to its row\'s RI id, sport-scoped, and leaves an unmapped id out', async () => {
    const { db } = fakeDb([
      { sport: 'NFL', sleeperId: '6794', rollingInsightsId: '5904', canonicalName: 'Justin Jefferson', currentTeam: 'MIN', position: 'WR' },
      { sport: 'NBA', sleeperId: '9999', rollingInsightsId: '1', canonicalName: 'Other Sport', currentTeam: null, position: null },
    ])
    const out = await crosswalkToRollingInsightsIds(db, { sport: 'nfl', lookups: [{ column: 'sleeperId', ids: ['6794', '9999'] }] })
    expect(out.byId.get('6794')).toEqual({ rollingInsightsId: '5904', canonicalName: 'Justin Jefferson', currentTeam: 'MIN', position: 'WR' })
    expect(out.byId.has('9999')).toBe(false)
    expect(out.ambiguous).toEqual([])
  })

  it('🛑 refuses an id whose column matches rows with MORE THAN ONE RI id', async () => {
    const { db } = fakeDb([
      { sport: 'NFL', fleaflickerId: '55', rollingInsightsId: '100', canonicalName: 'A' },
      { sport: 'NFL', fleaflickerId: '55', rollingInsightsId: '200', canonicalName: 'B' },
      { sport: 'NFL', fleaflickerId: '66', rollingInsightsId: '300', canonicalName: 'C' },
    ])
    const out = await crosswalkToRollingInsightsIds(db, { sport: 'NFL', lookups: [{ column: 'fleaflickerId', ids: ['55', '66'] }] })
    expect(out.byId.has('55')).toBe(false)
    expect(out.byId.get('66')?.rollingInsightsId).toBe('300')
    expect(out.ambiguous).toEqual(['55'])
  })

  it('🛑 refuses BOTH ids when two requested ids claim one RI id', async () => {
    const { db } = fakeDb([
      { sport: 'NFL', espnId: '11', rollingInsightsId: '700', canonicalName: 'Same Person?' },
      { sport: 'NFL', espnId: '12', rollingInsightsId: '700', canonicalName: 'Same Person?' },
    ])
    const out = await crosswalkToRollingInsightsIds(db, { sport: 'NFL', lookups: [{ column: 'espnId', ids: ['11', '12'] }] })
    expect(out.byId.size).toBe(0)
    expect(out.ambiguous.sort()).toEqual(['11', '12'])
  })

  it('passes rollingInsightsId-column ids (native non-NFL rosters) through without a query', async () => {
    const { db, findMany } = fakeDb([])
    const out = await crosswalkToRollingInsightsIds(db, { sport: 'NHL', lookups: [{ column: 'rollingInsightsId', ids: ['1086'] }] })
    expect(out.byId.get('1086')?.rollingInsightsId).toBe('1086')
    expect(findMany).not.toHaveBeenCalled()
  })
})
