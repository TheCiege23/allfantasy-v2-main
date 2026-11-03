import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({sources:vi.fn(),audit:vi.fn(),native:vi.fn(),user:'owner',scope:'',rows:[] as unknown[]}))
vi.mock('@/lib/prisma',()=>({prisma:{
 $transaction:async(fn:(tx:unknown)=>unknown)=>fn({zombieLeague:{findMany:mocks.sources},zombieAuditLog:{findFirst:mocks.audit},redraftSeason:{findUnique:mocks.native}}),
}}))
import {previewStandaloneZombieRenewal} from '@/lib/zombie/renewZombieUniverse'
describe('standalone renewal guards',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.sources.mockResolvedValue([{leagueId:'league',season:2026,universeId:null,status:'setup',sport:'NFL',league:{userId:'owner',season:2026,sport:'NFL',platform:'manual'}}]);mocks.audit.mockResolvedValue(null);mocks.native.mockResolvedValue(null)})
 it('rejects other managers before checking history or season evidence',async()=>{
  await expect(previewStandaloneZombieRenewal('league',2026,'member')).rejects.toThrow('RENEWAL_OWNER_REQUIRED')
  expect(mocks.audit).not.toHaveBeenCalled()
 })
 it('routes linked leagues to whole-universe renewal',async()=>{
  mocks.sources.mockResolvedValue([{universeId:'universe',league:{userId:'owner'}}])
  await expect(previewStandaloneZombieRenewal('league',2026,'owner')).rejects.toThrow('RENEWAL_UNIVERSE_REQUIRED')
 })
 it('refuses an unstarted/incomplete season',async()=>{
  await expect(previewStandaloneZombieRenewal('league',2026,'owner')).rejects.toThrow('RENEWAL_SEASONS_INCOMPLETE')
 })
 it('returns a durable receipt on repeated previews only for the owner',async()=>{
  mocks.audit.mockResolvedValue({metadata:{leagues:[{leagueId:'next'}],placements:[]}})
  expect(await previewStandaloneZombieRenewal('league',2026,'owner')).toMatchObject({completed:true,result:{leagues:[{leagueId:'next'}]}})
 })
 it('does not read an invalid season or an unknown league',async()=>{
  await expect(previewStandaloneZombieRenewal('league',2026.5,'owner')).rejects.toThrow('RENEWAL_SEASON_INVALID')
  expect(mocks.sources).not.toHaveBeenCalled()
  mocks.sources.mockResolvedValue([])
  await expect(previewStandaloneZombieRenewal('league',2026,'owner')).rejects.toThrow('RENEWAL_NOT_FOUND')
 })
})
