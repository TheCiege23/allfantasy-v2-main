// @vitest-environment node
import { webcrypto } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
let storage:Map<string,string>
let client:typeof import('@/lib/tokens/paidToolClient')
const ask=vi.fn()
const url='https://test/api/paid-tool'
const init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'same question',confirmTokenSpend:true})}
function offer(headers:Headers,cost=3) { return new Response(JSON.stringify({code:'token_confirmation_required',paidToolRequestId:headers.get('x-paid-tool-request-id'),tokenQuote:`quote-${cost}`,preview:{tokenCost:cost,currentBalance:10,featureLabel:'analysis'}}),{status:409}) }
const done=()=>new Response(JSON.stringify({ok:true,result:'detail'}),{headers:{'Content-Type':'application/json','x-paid-tool-terminal':'1'}})
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();storage=new Map();vi.stubGlobal('crypto',webcrypto)
 vi.stubGlobal('sessionStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)})
 vi.stubGlobal('window',{confirm:ask});ask.mockReturnValue(true);client=await import('@/lib/tokens/paidToolClient')
})
it('asks the exact server price and sends the approved quote with the same identity',async()=>{
 const calls:any[]=[];const fetcher=vi.fn(async(_url,options)=>{calls.push(options);return calls.length===1?offer(new Headers(options.headers)):done()}) as any
 expect((await client.paidToolFetchWithConfirm(url,init,fetcher)).status).toBe(200)
 expect(JSON.parse(calls[0].body).confirmTokenSpend).toBe(false);expect(JSON.parse(calls[1].body).confirmTokenSpend).toBe(true)
 expect(new Headers(calls[1].headers).get('x-paid-tool-quote')).toBe('quote-3')
 expect(new Headers(calls[1].headers).get('x-paid-tool-request-id')).toBe(new Headers(calls[0].headers).get('x-paid-tool-request-id'))
 expect(ask).toHaveBeenCalledWith(expect.stringContaining('3 tokens'))
})
it('a declined offer cannot send an approved request',async()=>{
 ask.mockReturnValue(false);const fetcher=vi.fn(async(_url,options)=>offer(new Headers(options.headers))) as any
 expect((await client.paidToolFetchWithConfirm(url,init,fetcher)).status).toBe(409);expect(fetcher).toHaveBeenCalledTimes(1)
})
it('a changed price requires a second explicit confirmation',async()=>{
 const fetcher=vi.fn(async(_url,options)=>fetcher.mock.calls.length===1?offer(new Headers(options.headers),3):fetcher.mock.calls.length===2?offer(new Headers(options.headers),4):done()) as any
 ask.mockReturnValueOnce(true).mockReturnValueOnce(false)
 expect((await client.paidToolFetchWithConfirm(url,init,fetcher)).status).toBe(409);expect(fetcher).toHaveBeenCalledTimes(2)
 expect(ask.mock.calls.map(c=>c[0])).toEqual([expect.stringContaining('3 tokens'),expect.stringContaining('4 tokens')])
})
it('a lost paid response retries the original approved receipt after a reload without asking or charging anew',async()=>{
 const calls:any[]=[];const fetcher=vi.fn(async(_url,options)=>{calls.push(options);if(calls.length===1)return offer(new Headers(options.headers));if(calls.length===2)throw new TypeError('connection lost after server completed');return done()}) as any
 await expect(client.paidToolFetchWithConfirm(url,init,fetcher)).rejects.toThrow('connection lost')
 const saved=JSON.stringify([...storage]);expect(saved).not.toContain('same question');expect(saved).not.toContain('analysis')
 vi.resetModules();client=await import('@/lib/tokens/paidToolClient')
 expect((await client.paidToolFetchWithConfirm(url,init,fetcher)).status).toBe(200)
 expect(ask).toHaveBeenCalledTimes(1)
 expect(new Headers(calls[2].headers).get('x-paid-tool-request-id')).toBe(new Headers(calls[1].headers).get('x-paid-tool-request-id'))
 expect(new Headers(calls[2].headers).get('x-paid-tool-quote')).toBe('quote-3');expect(JSON.parse(calls[2].body).confirmTokenSpend).toBe(true)
})
it('a rate limit before receipt replay cannot discard an ambiguous paid identity',async()=>{
 const calls:any[]=[];const fetcher=vi.fn(async(_url,options)=>{calls.push(options);if(calls.length===1)return offer(new Headers(options.headers));if(calls.length===2)throw new Error('lost');if(calls.length===3)return new Response('{}',{status:429});return done()}) as any
 await expect(client.paidToolFetchWithConfirm(url,init,fetcher)).rejects.toThrow('lost')
 expect((await client.paidToolFetchWithConfirm(url,init,fetcher)).status).toBe(429)
 await client.paidToolFetchWithConfirm(url,init,fetcher)
 expect(new Headers(calls[3].headers).get('x-paid-tool-request-id')).toBe(new Headers(calls[1].headers).get('x-paid-tool-request-id'));expect(ask).toHaveBeenCalledTimes(1)
})
it('concurrent calls each use current authentication while sharing a server receipt identity',async()=>{
 const releases:Array<(r:Response)=>void>=[]
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{releases.push(resolve)})) as any
 const one=client.paidToolFetch(url,init,fetcher),two=client.paidToolFetch(url,init,fetcher)
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2))
 const ids=fetcher.mock.calls.map(([,options]:any)=>new Headers(options.headers).get('x-paid-tool-request-id'))
 expect(ids[0]).toBe(ids[1])
 releases[0](done());releases[1](new Response(JSON.stringify({error:'Forbidden'}),{status:403}))
 // Which call reached the fetcher first is not deterministic (each awaits an async fingerprint),
 // so check the pair of outcomes rather than which call got which.
 const results=await Promise.all([one,two])
 expect(results.map(r=>r.status).sort()).toEqual([200,403])
 expect(await results.find(r=>r.status===200)!.json()).toEqual({ok:true,result:'detail'})
})

it('an overlapping lost response cannot discard an approved identity when another call finishes',async()=>{
 const calls:any[]=[];let reject!:(e:Error)=>void;let resolve!:(r:Response)=>void
 const fetcher=vi.fn(async(_url,options)=>{calls.push(options);if(calls.length===1)return offer(new Headers(options.headers));if(calls.length===2)return new Promise<Response>((_r,no)=>{reject=no});if(calls.length===3)return new Promise<Response>(yes=>{resolve=yes});return done()}) as any
 const first=await client.paidToolFetch(url,{...init,body:JSON.stringify({question:'same question',confirmTokenSpend:false})},fetcher)
 client.approvePaidToolQuote(await first.json())
 // Each call awaits an async fingerprint before fetching, so which of the two reaches the
 // fetcher first (and gets the lost response) is not deterministic. Settle both regardless of
 // order: assuming `one` loses left `two` as an unhandled rejection and `one` waiting forever.
 const one=client.paidToolFetch(url,init,fetcher),two=client.paidToolFetch(url,init,fetcher)
 const settled=Promise.allSettled([one,two])
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3))
 reject(new Error('lost'));resolve(done())
 const results=await settled
 expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected'])
 expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.message).toBe('lost')
 await client.paidToolFetch(url,init,fetcher)
 const ids=calls.slice(1).map(options=>new Headers(options.headers).get('x-paid-tool-request-id'))
 expect(new Set(ids).size).toBe(1)
})

it('ordinary GET reads pass through unchanged without a body or token consent',async()=>{
 const fetcher=vi.fn(async()=>done()) as any
 const options={cache:'no-store' as const}
 await client.paidToolFetchWithConfirm(url,options,fetcher)
 expect(fetcher).toHaveBeenCalledWith(url,options);expect(ask).not.toHaveBeenCalled()
})

it('free multipart uploads pass through without JSON rewriting or a token prompt',async()=>{
 const fetcher=vi.fn(async()=>done()) as any
 const form=new FormData();form.set('action','upload_image')
 const options={method:'POST',body:form}
 await client.paidToolFetchWithConfirm(url,options,fetcher)
 expect(fetcher).toHaveBeenCalledWith(url,options);expect(ask).not.toHaveBeenCalled()
})
