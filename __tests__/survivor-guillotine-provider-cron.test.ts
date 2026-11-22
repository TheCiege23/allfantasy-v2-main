import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const deps=vi.hoisted(()=>({auth:vi.fn(),ingest:vi.fn(),telemetry:vi.fn(),classified:vi.fn()}))
vi.mock('@/app/api/cron/_auth',()=>({requireCronAuth:deps.auth}))
vi.mock('@/lib/production-health/syncJobRunTelemetry',()=>({withSyncJobRun:deps.telemetry}))
vi.mock('@/lib/survivor-guillotine/providerIngestion',()=>({ingestSGProviderData:deps.ingest}))
import {GET} from '@/app/api/cron/survivor-guillotine-ingest/route'
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SG_PROVIDER_INGEST_ENABLED','true');deps.auth.mockReturnValue(true);deps.ingest.mockResolvedValue({ok:true,sport:'NFL'});deps.telemetry.mockImplementation(async(meta,run,classify)=>{const result=await run();deps.classified(meta.jobName,classify(result));return result})});afterEach(()=>vi.unstubAllEnvs())
describe('scheduled provider ingress',()=>{
 it('requires cron authorization before calling any provider',async()=>{deps.auth.mockReturnValue(false);expect((await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest?sport=NFL'))).status).toBe(401);expect(deps.ingest).not.toHaveBeenCalled()})
 it('refuses a disabled feed rather than acknowledging a successful no-op',async()=>{vi.stubEnv('SG_PROVIDER_INGEST_ENABLED','false');expect((await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest?sport=NFL'))).status).toBe(503);expect(deps.ingest).not.toHaveBeenCalled()})
 it('rejects invalid sport and period input before provider traffic',async()=>{for(const query of ['sport=MLB','sport=NFL&week=19','sport=NBA&season=NaN','sport=NBA&date=bad'])expect((await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest?'+query))).status).toBe(400);expect(deps.ingest).not.toHaveBeenCalled()})
 it('reports provider failures as unsuccessful to the scheduler',async()=>{deps.ingest.mockResolvedValue({ok:false,sport:'NBA',error:'Incomplete provider boxes'});const response=await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest?sport=NBA'));expect(response.status).toBe(503);expect((await response.json()).ok).toBe(false)})
 it('passes the explicitly selected real provider period to ingestion',async()=>{expect((await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest?sport=NFL&season=2026&week=7'))).status).toBe(200);expect(deps.ingest).toHaveBeenCalledWith({sport:'NFL',season:2026,week:7,date:undefined})})
})

describe('combined provider schedule',()=>{
 it('runs each sport and fails the schedule if either provider fails',async()=>{
  deps.ingest.mockImplementation(async ({sport}: {sport:string})=>({ok:sport==='NFL',sport}))
  const response=await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest'))
  expect(response.status).toBe(503)
  expect(deps.ingest.mock.calls.map(([arg])=>arg.sport).sort()).toEqual(['NBA','NFL'])
  expect((await response.json()).ok).toBe(false)
  expect(deps.classified).toHaveBeenCalledWith('cron-survivor-guillotine-provider',expect.objectContaining({status:'failed'}))
 })
 it('requires an explicit sport for a historical period',async()=>{
  const response=await GET(new NextRequest('http://localhost/api/cron/survivor-guillotine-ingest?season=2026'))
  expect(response.status).toBe(400)
  expect(deps.ingest).not.toHaveBeenCalled()
 })
})
