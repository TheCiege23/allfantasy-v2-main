// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(),renew:vi.fn(),review:vi.fn(),editor:vi.fn(),save:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/zombie/renewZombieUniverse',()=>({previewZombieUniverseRenewal:m.preview,renewZombieUniverse:m.renew,previewReviewedZombieUniverseRenewal:m.review,getZombieUniverseRenewalEditor:m.editor,saveZombieUniverseRenewalDraft:m.save,ZombieRenewalError:class extends Error{}}))
import {GET,PATCH,PUT,POST} from '@/app/api/zombie-universe/[universeId]/renew/route'
import {ZombieRenewalError} from '@/lib/zombie/renewZombieUniverse'
const context={params:Promise.resolve({universeId:'u'})},hash='a'.repeat(64),proposal={version:1}
const request=(method:string,body:unknown)=>new Request('http://localhost/renew',{method,body:JSON.stringify(body)})
describe('reviewed renewal API',()=>{
 beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({user:{id:'owner'}})})
 it('authenticates all methods before parsing input',async()=>{
  m.session.mockResolvedValue(null)
  for(const handler of [GET,PATCH,PUT,POST])expect((await handler(new Request('http://localhost/renew'),context)).status).toBe(401)
  for(const fn of [m.preview,m.renew,m.review,m.editor,m.save])expect(fn).not.toHaveBeenCalled()
 })
 it('reads the editor and previews privately without executing or saving',async()=>{
  m.editor.mockResolvedValue({pools:[]});m.review.mockResolvedValue({previewHash:hash})
  const editor=await GET(new Request('http://localhost/renew?editor=1&season=2026'),context)
  expect(editor.status).toBe(200);expect(editor.headers.get('Cache-Control')).toBe('private, no-store')
  expect(m.editor).toHaveBeenCalledWith('u',2026,'owner')
  expect((await PATCH(request('PATCH',{season:2026,proposal}),context)).status).toBe(200)
  expect(m.review).toHaveBeenCalledWith('u',2026,'owner',proposal)
  expect(m.save).not.toHaveBeenCalled();expect(m.renew).not.toHaveBeenCalled()
 })
 it('binds save and execution to the complete reviewed proposal and hash',async()=>{
  m.save.mockResolvedValue({saved:true});m.renew.mockResolvedValue({nextSeason:2027})
  expect((await PUT(request('PUT',{season:2026,previewHash:hash,proposal}),context)).status).toBe(200)
  expect(m.save).toHaveBeenCalledWith('u',2026,'owner',hash,proposal)
  expect((await POST(request('POST',{season:2026,previewHash:hash,proposal}),context)).status).toBe(200)
  expect(m.renew).toHaveBeenCalledWith('u',2026,'owner',hash,proposal)
 })
 it('retains the existing automatic execution signature',async()=>{
  m.renew.mockResolvedValue({})
  await POST(request('POST',{season:2026,previewHash:hash}),context)
  expect(m.renew).toHaveBeenCalledWith('u',2026,'owner',hash)
 })
 it('rejects malformed, oversized and unapproved requests before mutation',async()=>{
  for(const body of [null,[],{season:2026.1},{season:2026,previewHash:'stale'}])
   expect((await PUT(request('PUT',body),context)).status).toBe(400)
  expect((await PATCH(new Request('http://localhost/renew',{method:'PATCH',body:'x'.repeat(160001)}),context)).status).toBe(413)
  expect(m.save).not.toHaveBeenCalled();expect(m.renew).not.toHaveBeenCalled()
 })
 it('preserves owner denials and stale preview conflicts',async()=>{
  m.editor.mockRejectedValue(new ZombieRenewalError('RENEWAL_OWNER_REQUIRED'))
  expect((await GET(new Request('http://localhost/renew?editor=1&season=2026'),context)).status).toBe(403)
  m.save.mockRejectedValue(new ZombieRenewalError('RENEWAL_PREVIEW_CHANGED'))
  expect((await PUT(request('PUT',{season:2026,previewHash:hash,proposal}),context)).status).toBe(409)
 })
 it('does not disclose private transaction diagnostics',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{})
  try{m.review.mockRejectedValue(new Error('private database connection'));const r=await PATCH(request('PATCH',{season:2026,proposal}),context)
   expect(r.status).toBe(500);expect(await r.text()).not.toContain('private database')
  }finally{log.mockRestore()}
 })
})
