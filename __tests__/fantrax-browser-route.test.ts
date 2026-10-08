// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {NextRequest, NextResponse} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),importScores:vi.fn()}))
vi.mock('@/lib/auth-guard',()=>({requireVerifiedUser:mocks.auth}))
vi.mock('@/lib/http/served-origin',()=>({getServedOrigin:()=> 'https://www.allfantasy.ai'}))
vi.mock('@/lib/import-os/collector/fantraxBrowserContext',()=>({fantraxBrowserContext:mocks.context}))
vi.mock('@/lib/import-os/collector/fantraxBrowserActuals',()=>({importFantraxBrowserActuals:mocks.importScores}))
import {GET,POST} from '../app/api/leagues/import/fantrax-browser/route'
const origin='https://www.allfantasy.ai',leagueId='ff59b139-03a8-47c6-82c0-59d6580670b4'
const body={leagueId,season:2026,exports:[{period:4,sourceTeamId:'team',csv:'csv'}]}
const request=(value:unknown=body,source=origin)=>new NextRequest(`${origin}/api/leagues/import/fantrax-browser`,{method:'POST',headers:{origin:source,'content-type':'application/json'},body:JSON.stringify(value)})
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({ok:true,userId:'owner'});mocks.importScores.mockResolvedValue({mode:'dry-run'});mocks.context.mockResolvedValue({periods:[]})})
describe('browser connector API',()=>{
 it('requires a verified app session on both methods',async()=>{
  mocks.auth.mockResolvedValue({ok:false,response:NextResponse.json({error:'Unauthorized'},{status:401})})
  expect((await POST(request())).status).toBe(401)
  expect((await GET(new NextRequest(`${origin}/api/leagues/import/fantrax-browser?leagueId=${leagueId}`))).status).toBe(401)
  expect(mocks.importScores).not.toHaveBeenCalled();expect(mocks.context).not.toHaveBeenCalled()
 })
 it('rejects cross-origin imports before ingestion',async()=>{expect((await POST(request(body,'https://other.example'))).status).toBe(403);expect(mocks.importScores).not.toHaveBeenCalled()})
 it('accepts the configured public origin behind a bind-address proxy',async()=>{
  const req=new NextRequest('http://0.0.0.0:8080/api/leagues/import/fantrax-browser',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
  expect((await POST(req)).status).toBe(200)
 })
 it('defaults to dry-run and passes only allowed fields',async()=>{
  expect((await POST(request({...body,apply:'true',cookie:'never-forward',exports:[{...body.exports[0],url:'https://other.example'}]}))).status).toBe(200)
  expect(mocks.importScores).toHaveBeenCalledWith('owner',{...body,apply:false})
 })
 it('requires explicit boolean apply and accepts valid context requests',async()=>{
  await POST(request({...body,apply:true}));expect(mocks.importScores).toHaveBeenCalledWith('owner',{...body,apply:true})
  const response=await GET(new NextRequest(`${origin}/api/leagues/import/fantrax-browser?leagueId=${leagueId}`));expect(response.headers.get('cache-control')).toBe('no-store');expect(mocks.context).toHaveBeenCalledWith('owner',leagueId)
 })
 it('rejects malformed batches and hides ingestion errors',async()=>{
  expect((await POST(request({...body,exports:[null]}))).status).toBe(400);expect(mocks.importScores).not.toHaveBeenCalled()
  mocks.importScores.mockRejectedValue(new Error('private source detail'));const response=await POST(request());expect(response.status).toBe(400);expect(await response.text()).not.toContain('private source detail')
 })
})
