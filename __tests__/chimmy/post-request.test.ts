// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { postChimmyRequest } from '@/lib/chimmy/postRequest'
afterEach(() => vi.useRealTimers())
it('reuses the identity when the user retries a lost response', async () => {
  const form = new FormData(); form.set('message','Trade question')
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(new Response('{}'))
  await expect(postChimmyRequest(form,fetcher)).rejects.toThrow('connection lost')
  await postChimmyRequest(form,fetcher)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(form.get('requestId')).toBeTruthy()
  expect(fetcher.mock.calls[0][1].body.get('requestId')).toBe(fetcher.mock.calls[1][1].body.get('requestId'))
})
it('polls the existing request instead of posting and charging again', async () => {
  vi.useFakeTimers()
  const form = new FormData(); form.set('requestId','same-request')
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}',{status:202})).mockResolvedValueOnce(new Response('{"response":"YES"}'))
  const pending = postChimmyRequest(form,fetcher)
  await vi.advanceTimersByTimeAsync(3000)
  expect(await (await pending).json()).toEqual({response:'YES'})
  expect(fetcher).toHaveBeenLastCalledWith('/api/chat/chimmy?requestId=same-request',{cache:'no-store'})
})
it('recovers the same question after a page reload without a second POST', async () => {
  const values = new Map<string,string>()
  const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const first = new FormData();first.set('message','Trade question');first.set('requestId','original-id')
  const lost = vi.fn().mockRejectedValue(new Error('transport lost'))
  await expect(postChimmyRequest(first,lost,storage)).rejects.toThrow()
  expect(values.size).toBe(1)
  const retry = new FormData();retry.set('message','Trade question');retry.set('requestId','fresh-id')
  const recovered = vi.fn().mockResolvedValue(new Response('{"response":"COUNTER"}'))
  expect(await (await postChimmyRequest(retry,recovered,storage)).json()).toEqual({response:'COUNTER'})
  expect(recovered).toHaveBeenCalledWith('/api/chat/chimmy?requestId=original-id',{cache:'no-store'})
  expect(recovered).toHaveBeenCalledTimes(1)
  expect(values.size).toBe(0)
})

it('refreshes an unspent preview after reload without authorizing the changed conversation', async () => {
 const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
 const original=new FormData();original.set('message','Same question');original.set('requestId','original-id');original.set('conversation','old-context')
 const preview=()=>new Response(JSON.stringify({code:'token_confirmation_required',analysisPreview:{version:1}}),{status:409})
 await postChimmyRequest(original,vi.fn().mockResolvedValue(preview()),storage)
 const reload=new FormData();reload.set('message','Same question');reload.set('requestId','fresh-id');reload.set('conversation','new-context')
 const fetcher=vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview())
 await postChimmyRequest(reload,fetcher,storage)
 expect(fetcher.mock.calls[0][0]).toBe('/api/chat/chimmy?requestId=original-id')
 expect(fetcher.mock.calls[1][1].body.get('requestId')).toBe('fresh-id');expect(fetcher.mock.calls[1][1].body.get('confirmTokenSpend')).toBeNull()
})
