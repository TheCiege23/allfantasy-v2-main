// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { postChimmyRequest } from '@/lib/chimmy/postRequest'
afterEach(() => vi.useRealTimers())
it('reuses the identity when a response is lost', async () => {
  const form = new FormData(); form.set('message','Trade question')
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(new Response('{}'))
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
