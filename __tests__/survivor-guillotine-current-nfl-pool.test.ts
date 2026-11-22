import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { verifiedCurrentSGNflRows, enforceCurrentSGNflEntries } from '@/lib/survivor-guillotine/currentNflPool'
import { sgCatalogRows } from '@/lib/survivor-guillotine/providerCatalog'
const sleeper = (id: string, name: string, status = 'Active') => ({ source: 'sleeper', externalId: 'sleeper:' + id, sleeperId: id, name, status, position: 'QB', team: 'KC' })
const ri = (id: string, name: string, status = 'ACT') => ({ ...sleeper(id, name, status), source: 'rolling_insights', externalId: id, sleeperId: null, team: 'Kansas City Chiefs' })
describe('Survivor current NFL scoring identities', () => {
 it('uses the verified Sleeper ID when the RI numeric ID belongs to another player', () => {
   const rows = verifiedCurrentSGNflRows([{ name: 'Patrick Mahomes', position: 'QB', playerId: 'name:patrick-mahomes', adp: 12 }], [sleeper('4046', 'Patrick Mahomes'), ri('3036', 'Patrick Mahomes'), sleeper('3036', 'Historical Player')])
   expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ playerId: '4046', team: 'KC', adp: 12, name: 'Patrick Mahomes' })
 })
 it('rejects stale historical and explicitly inactive profiles without excluding injured current players', () => {
   expect(verifiedCurrentSGNflRows([], [sleeper('1', 'Tom Brady'), ri('9', 'Tom Brady', 'INACT')])).toEqual([])
   expect(verifiedCurrentSGNflRows([], [sleeper('1', 'Current Player', 'Inactive'), ri('9', 'Current Player')])).toEqual([])
   expect(verifiedCurrentSGNflRows([], [sleeper('1', 'Current Player', 'IR'), ri('9', 'Current Player')])).toHaveLength(1)
 })
 it('rejects ambiguous name matches and unknown clubs', () => {
   expect(verifiedCurrentSGNflRows([], [sleeper('1', 'Same Name'), sleeper('2', 'Same Name'), ri('9', 'Same Name')])).toEqual([])
   expect(verifiedCurrentSGNflRows([], [sleeper('1', 'Current Player'), { ...ri('9', 'Current Player'), team: 'FA' }])).toEqual([])
 })
 it('keeps NFL RI catalog IDs in their own provider namespace', () => {
   expect(sgCatalogRows('NFL', [{player_id: 3036, player: 'Patrick Mahomes', position: 'QB', team: 'Kansas City Chiefs', status: 'ACT'}], 'rolling_insights')[0]).toMatchObject({ externalId: '3036', sleeperId: null, source: 'rolling_insights', sport: 'NFL' })
 })
 it('restores verified final entries and rejects unmatched synthetic identities', () => {
   const current = verifiedCurrentSGNflRows([], [sleeper('4046', 'Patrick Mahomes'), ri('3036', 'Patrick Mahomes')])
   const result = enforceCurrentSGNflEntries([{ name: 'Patrick Mahomes', position: 'QB', playerId: 'name:patrick-mahomes', team: 'BUF', display: {playerId:'3036'} }, {name:'Tom Brady',position:'QB',display:{playerId:'1'}}] as any, current)
   expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ playerId: '4046', team: 'KC', display: {playerId:'4046',displayName:'Patrick Mahomes'} })
 })
})
