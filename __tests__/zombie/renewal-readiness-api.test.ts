// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(),renew:vi.fn(),readiness:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/zombie/renewZombieUniverse',()=>({previewStandaloneZombieRenewal:m.preview,renewStandaloneZombieLeague:m.renew,ZombieRenewalError:class extends Error {}}))
vi.mock('@/lib/zombie/ZombieReadinessService',()=>({getZombieReadiness:m.readiness,ZombieReadinessError:class extends Error {}}))
import {GET,POST} from '@/app/api/zombie/league/[leagueId]/renew/route'
import {GET as readinessGET} from '@/app/api/zombie/readiness/route'
import {ZombieRenewalError} from '@/lib/zombie/renewZombieUniverse'
import {ZombieReadinessError} from '@/lib/zombie/ZombieReadinessService'
const context={params:Promise.resolve({leagueId:'league'})},hash='a'.repeat(64)
describe('Zombie renewal and readiness API boundaries',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({user:{id:'owner'}})})
 it('requires authentication before reading input or a report',async()=>{
  m.session.mockResolvedValue(null)
  expect((await GET(new Request('http://localhost/renew'),context)).status).toBe(401)
  expect((await readinessGET(new Request('http://localhost/readiness?leagueId=l'))).status).toBe(401)
  expect(m.preview).not.toHaveBeenCalled();expect(m.readiness).not.toHaveBeenCalled()
 })
 it('rejects malformed seasons and approvals before mutations',async()=>{
  expect((await GET(new Request('http://localhost/renew?season=2026.5'),context)).status).toBe(400)
  expect((await POST(new Request('http://localhost/renew',{method:'POST',body:JSON.stringify({season:2026,previewHash:'stale'})}),context)).status).toBe(400)
  expect(m.renew).not.toHaveBeenCalled()
 })
 it('requires exactly one readiness scope',async()=>{
  expect((await readinessGET(new Request('http://localhost/readiness?leagueId=l&universeId=u'))).status).toBe(400)
  expect(m.readiness).not.toHaveBeenCalled()
 })
 it('preserves service authorization and conflict responses',async()=>{
  m.preview.mockRejectedValue(new ZombieRenewalError('RENEWAL_OWNER_REQUIRED'))
  expect((await GET(new Request('http://localhost/renew?season=2026'),context)).status).toBe(403)
  m.renew.mockRejectedValue(new ZombieRenewalError('RENEWAL_PREVIEW_CHANGED'))
  expect((await POST(new Request('http://localhost/renew',{method:'POST',body:JSON.stringify({season:2026,previewHash:hash})}),context)).status).toBe(409)
  expect(m.renew).toHaveBeenCalledWith('league',2026,'owner',hash)
 })
 it('does not disclose unexpected transaction errors',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{})
  try {
   m.preview.mockRejectedValue(new Error('private fixture diagnostic'))
   const response=await GET(new Request('http://localhost/renew?season=2026'),context)
   expect(response.status).toBe(500)
   expect(await response.text()).not.toContain('private fixture diagnostic')
  } finally {log.mockRestore()}
 })
 it('keeps readiness private and reports owner denial',async()=>{
  m.readiness.mockRejectedValue(new ZombieReadinessError('OWNER_REQUIRED'))
  expect((await readinessGET(new Request('http://localhost/readiness?leagueId=l'))).status).toBe(403)
  m.readiness.mockResolvedValue({leagues:[]})
  const response=await readinessGET(new Request('http://localhost/readiness?leagueId=l'))
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
 })
})
