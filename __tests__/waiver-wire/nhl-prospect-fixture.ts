/**
 * Shared fake DB for the NHL prospect free-agency tests: a stored Fantrax universe and the NHL
 * identity registry, in the shapes `loadNhlFantraxProspects` reads. Not a test file itself.
 */
import { vi } from 'vitest'
import { NHL_FANTRAX_UNIVERSE_CACHE_KEY, type NhlFantraxUniverseRow } from '@/lib/player-identity/nhlFantraxProspects'

/** `[fantraxId, "Last, First", team, position]`, as the weekly job stores it. */
export const UNIVERSE: NhlFantraxUniverseRow[] = [
  ['04qyh', 'Madden, Tyler', 'MIN', 'RW'], // AHL, NHL org MIN
  ['04qyf', 'Hillis, Cameron', '(N/A)', 'C'], // unsigned
  ['04abc', 'Drafted, Already', 'TOR', 'D'], // a prospect another team drafted
  ['04lnk', 'Linked, Pro', 'EDM', 'C'], // the weekly link attached him to an NHL identity
]

export const IDENTITIES = [
  { id: 'idm-linked', fantraxId: '04lnk', normalizedName: 'pro linked', canonicalName: 'Pro Linked', rollingInsightsId: '5001', sleeperId: null },
  { id: 'idm-mcdavid', fantraxId: '02abc', normalizedName: 'connor mcdavid', canonicalName: 'Connor McDavid', rollingInsightsId: '7001', sleeperId: null },
]

export function prospectDb(opts: { universe?: NhlFantraxUniverseRow[] | 'throw' | null } = {}) {
  const universe = opts.universe === undefined ? UNIVERSE : opts.universe
  const findUnique = vi.fn(async (args: { where: { cacheKey: string } }) => {
    if (universe === 'throw') throw new Error('db down')
    if (args.where.cacheKey !== NHL_FANTRAX_UNIVERSE_CACHE_KEY || universe === null) return null
    return { data: { at: '2026-10-31T00:00:00.000Z', rows: universe }, expiresAt: new Date(Date.now() + 86_400_000) }
  })
  const identityFindMany = vi.fn(async (args: { where: { sport: string; fantraxId?: { in: string[] } } }) => {
    const ids = args.where.fantraxId?.in
    return IDENTITIES.filter((r) => !ids || (r.fantraxId && ids.includes(r.fantraxId)))
  })
  return { sportsDataCache: { findUnique }, playerIdentityMap: { findMany: identityFindMany } }
}
