// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({cacheFind:vi.fn(),cacheCreate:vi.fn(),cacheDelete:vi.fn(),cacheUpdate:vi.fn(),accountFind:vi.fn(),accountUnique:vi.fn(),accountDelete:vi.fn(),accountCreate:vi.fn(),accountUpdate:vi.fn(),fetch:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>{const db={sportsDataCache:{findUnique:m.cacheFind,create:m.cacheCreate,deleteMany:m.cacheDelete,update:m.cacheUpdate},authAccount:{findFirst:m.accountFind,findUnique:m.accountUnique,deleteMany:m.accountDelete,create:m.accountCreate,updateMany:m.accountUpdate}};return {prisma:{...db,$transaction:async(fn:(tx:unknown)=>unknown)=>fn(db)}}})
import { encrypt } from '@/lib/league-auth-crypto'
import { assertWeeklyXOrigin,beginWeeklyXConnection,completeWeeklyXConnection,publishWeeklyXPost,validWeeklyXPost,weeklyXStateKey,weeklyXStatus } from '@/lib/core-app/weeklyXPublishing'
const request={requestId:'03c894a2-2d36-4f13-9060-d1d44fe45aee',text:'My fantasy week'}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('fetch',m.fetch)
  vi.stubEnv('X_OAUTH_REDIRECT_URI','https://www.allfantasy.ai/api/core/week/x/callback');vi.stubEnv('X_OAUTH_CLIENT_ID','client');vi.stubEnv('X_OAUTH_CLIENT_SECRET','secret');vi.stubEnv('LEAGUE_AUTH_ENCRYPTION_KEY','test-only-encryption-key')
  m.cacheFind.mockResolvedValue(null);m.cacheCreate.mockResolvedValue({});m.cacheDelete.mockResolvedValue({count:1});m.cacheUpdate.mockResolvedValue({})
  m.accountFind.mockResolvedValue({access_token:'v1:'+encrypt('user-token'),expires_at:Math.floor(Date.now()/1000)+3600,scope:'tweet.read tweet.write users.read',session_state:'manager'})
  m.accountUnique.mockResolvedValue(null);m.accountCreate.mockResolvedValue({});m.accountUpdate.mockResolvedValue({count:1});m.accountDelete.mockResolvedValue({count:0})
})
describe('weekly X connection isolation',()=>{
  it('requires matching origin and confidential server configuration',()=>{
    expect(()=>assertWeeklyXOrigin(new Request('https://www.allfantasy.ai/api/core/week/x',{headers:{Origin:'https://attacker.example'}}))).toThrow('invalid_origin')
    expect(assertWeeklyXOrigin(new Request('https://www.allfantasy.ai/api/core/week/x',{headers:{Origin:'https://www.allfantasy.ai'}})).redirectUri).toBe('https://www.allfantasy.ai/api/core/week/x/callback')
    vi.stubEnv('X_OAUTH_CLIENT_ID','');expect(()=>assertWeeklyXOrigin(new Request('https://www.allfantasy.ai/api/core/week/x'))).toThrow('not_configured')
  })
  it('stores a session-bound encrypted verifier and uses S256 PKCE',async()=>{
    const url=new URL(await beginWeeklyXConnection('user-A','league-A'))
    expect(url.origin).toBe('https://x.com');expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('tweet.read tweet.write users.read')
    const data=m.cacheCreate.mock.calls[0][0].data
    expect(data.cacheKey).toBe(weeklyXStateKey(url.searchParams.get('state')!));expect(data.data.user).not.toBe('user-A')
    expect(data.data.verifier).toMatch(/^v1:/);expect(data.data.verifier).not.toBe(url.searchParams.get('code_challenge'))
  })
  it('refuses a callback belonging to another user without consuming it',async()=>{
    const url=new URL(await beginWeeklyXConnection('user-A',null)),state=url.searchParams.get('state')!
    m.cacheFind.mockResolvedValue(m.cacheCreate.mock.calls[0][0].data)
    await expect(completeWeeklyXConnection('user-B',state,'code')).rejects.toThrow('invalid_callback')
    expect(m.cacheDelete).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled()
  })
  it('consumes once, verifies account identity, and stores only encrypted per-user credentials',async()=>{
    const url=new URL(await beginWeeklyXConnection('user-A','league-A')),state=url.searchParams.get('state')!
    m.cacheFind.mockResolvedValue(m.cacheCreate.mock.calls[0][0].data)
    m.fetch.mockResolvedValueOnce(Response.json({access_token:'new-user-token',token_type:'bearer',expires_in:7200,scope:'tweet.read tweet.write users.read'})).mockResolvedValueOnce(Response.json({data:{id:'12345',username:'manager'}}))
    expect(await completeWeeklyXConnection('user-A',state,'code')).toBe('league-A')
    const saved=m.accountCreate.mock.calls[0][0].data
    expect(saved.userId).toBe('user-A');expect(saved.providerAccountId).toBe('12345');expect(saved.access_token).toMatch(/^v1:/);expect(saved.access_token).not.toContain('new-user-token')
    expect(saved.refresh_token).toBeNull()
    m.cacheDelete.mockResolvedValue({count:0});await expect(completeWeeklyXConnection('user-A',state,'code')).rejects.toThrow('invalid_callback')
    expect(m.fetch).toHaveBeenCalledTimes(2)
  })
  it('never exposes a token in connection status',async()=>{
    const result=await weeklyXStatus('user-A')
    expect(result).toMatchObject({connected:true,handle:'manager'});expect(JSON.stringify(result)).not.toContain('access_token')
    m.accountFind.mockResolvedValue({access_token:'unversioned-token',expires_at:9999999999,scope:'tweet.read tweet.write users.read'})
    expect((await weeklyXStatus('user-A')).connected).toBe(false)
  })
})
describe('reviewed X posting',()=>{
  it('requires a UUID and a nonempty bounded caption',()=>{
    expect(validWeeklyXPost(request)).toBe(true);expect(validWeeklyXPost(null)).toBe(false)
    expect(validWeeklyXPost({...request,text:' '})).toBe(false);expect(validWeeklyXPost({...request,text:'a'.repeat(281)})).toBe(false)
    expect(validWeeklyXPost({...request,requestId:'repeated'})).toBe(false)
  })
  it('posts the exact reviewed text with the user token, then returns the existing result on retry',async()=>{
    m.fetch.mockResolvedValue(Response.json({data:{id:'98765'}}))
    const result=await publishWeeklyXPost('user-A',request)
    expect(result.url).toBe('https://x.com/i/status/98765')
    expect(m.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer user-token')
    expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({text:request.text})
    m.cacheFind.mockResolvedValue({data:m.cacheUpdate.mock.calls[0][0].data.data})
    expect(await publishWeeklyXPost('user-A',request)).toEqual(result);expect(m.fetch).toHaveBeenCalledTimes(1)
    await expect(publishWeeklyXPost('user-A',{...request,text:'Changed caption'})).rejects.toThrow('request_changed')
  })
  it('does not retry an ambiguous network response or a concurrent pending request',async()=>{
    m.fetch.mockRejectedValue(new Error('timeout'))
    await expect(publishWeeklyXPost('user-A',request)).rejects.toThrow('publication_unknown')
    m.cacheFind.mockResolvedValue({data:m.cacheCreate.mock.calls[0][0].data.data})
    await expect(publishWeeklyXPost('user-A',request)).rejects.toThrow('publication_unknown')
    expect(m.fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects expired or unencrypted credentials without using global publishing tokens',async()=>{
    m.accountFind.mockResolvedValue(null);vi.stubEnv('X_PUBLISH_ACCESS_TOKEN','global-token')
    await expect(publishWeeklyXPost('user-A',request)).rejects.toThrow('reconnect')
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('treats server errors and accepted writes whose result cannot be saved as uncertain',async()=>{
    m.fetch.mockResolvedValue(new Response('',{status:503}))
    await expect(publishWeeklyXPost('user-A',request)).rejects.toThrow('publication_unknown')
    expect(m.cacheUpdate).not.toHaveBeenCalled()
    m.fetch.mockResolvedValue(Response.json({data:{id:'12345'}}));m.cacheUpdate.mockRejectedValue(new Error('DB offline'))
    await expect(publishWeeklyXPost('user-A',request)).rejects.toThrow('publication_unknown')
  })
})

it('does not overwrite a verified X identity linked to another AllFantasy account',async()=>{
 const url=new URL(await beginWeeklyXConnection('user-A',null)),state=url.searchParams.get('state')!
 m.cacheFind.mockResolvedValue(m.cacheCreate.mock.calls[0][0].data)
 m.fetch.mockResolvedValueOnce(Response.json({access_token:'new-token',token_type:'bearer',expires_in:7200,scope:'tweet.read tweet.write users.read'})).mockResolvedValueOnce(Response.json({data:{id:'12345',username:'manager'}}))
 m.accountUnique.mockResolvedValue({id:'foreign',userId:'user-B'})
 await expect(completeWeeklyXConnection('user-A',state,'code')).rejects.toThrow('account_already_connected')
 expect(m.accountCreate).not.toHaveBeenCalled();expect(m.accountUpdate).not.toHaveBeenCalled();expect(m.accountDelete).not.toHaveBeenCalled()
})
it('updates an existing connection only with an explicit owning-user condition',async()=>{
 const url=new URL(await beginWeeklyXConnection('user-A',null)),state=url.searchParams.get('state')!
 m.cacheFind.mockResolvedValue(m.cacheCreate.mock.calls[0][0].data)
 m.fetch.mockResolvedValueOnce(Response.json({access_token:'new-token',token_type:'bearer',expires_in:7200,scope:'tweet.read tweet.write users.read'})).mockResolvedValueOnce(Response.json({data:{id:'12345',username:'manager'}}))
 m.accountUnique.mockResolvedValue({id:'owned',userId:'user-A'})
 await completeWeeklyXConnection('user-A',state,'code')
 expect(m.accountUpdate.mock.calls[0][0].where).toEqual({id:'owned',userId:'user-A',provider:'x-weekly-publish'})
 expect(m.accountCreate).not.toHaveBeenCalled()
})
