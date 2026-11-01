import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({league:vi.fn(),universe:vi.fn(),aggregate:vi.fn(),sources:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findUnique:mocks.league},zombieUniverse:{findUnique:mocks.universe},zombieLeague:{aggregate:mocks.aggregate,findMany:mocks.sources}}}))
import {getZombieReadiness} from '@/lib/zombie/ZombieReadinessService'
describe('commissioner readiness ownership',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('blocks nonowners before reading a league report',async()=>{
  mocks.league.mockResolvedValue({userId:'owner'})
  await expect(getZombieReadiness({leagueId:'league'},'member')).rejects.toThrow('OWNER_REQUIRED')
  expect(mocks.aggregate).not.toHaveBeenCalled()
 })
 it('uses the explicit universe commissioner and rejects a previous creator',async()=>{
  mocks.universe.mockResolvedValue({id:'u',commissionedByUserId:'current',createdByUserId:'previous'})
  await expect(getZombieReadiness({universeId:'u'},'previous')).rejects.toThrow('OWNER_REQUIRED')
 })
 it('selects only the latest universe season and returns no false ready empty league',async()=>{
  mocks.universe.mockResolvedValue({id:'u',createdByUserId:'owner'})
  mocks.aggregate.mockResolvedValue({_max:{season:2027}})
  mocks.sources.mockResolvedValue([])
  expect(await getZombieReadiness({universeId:'u'},'owner')).toMatchObject({scope:'universe',leagues:[]})
  expect(mocks.sources.mock.calls[0][0].where).toEqual({universeId:'u',season:2027})
 })
})
