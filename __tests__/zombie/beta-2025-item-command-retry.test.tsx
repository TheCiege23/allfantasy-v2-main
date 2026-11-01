import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useZombieDmCommand } from '@/app/zombie/components/chimmy/useZombieDmCommand'
afterEach(() => vi.unstubAllGlobals())
describe('Zombie item command retry controls', () => {
  it('reuses the original request after a network failure, then permits a new deliberate use', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, privateMessage: 'Used one serum.' }) })
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useZombieDmCommand('L'))
    await act(async () => { expect(await result.current.sendCommand('use serum')).toBe(false) })
    await act(async () => { expect(await result.current.sendCommand('use serum')).toBe(true) })
    await act(async () => { expect(await result.current.sendCommand('use serum')).toBe(true) })
    const ids = fetcher.mock.calls.map(c => JSON.parse(c[1].body).commandId)
    expect(ids[0]).toBe(ids[1]); expect(ids[2]).not.toBe(ids[1])
  })
  it('allows only one in-flight request even before React paints the disabled button', async () => {
    let resolve!: (r: unknown) => void
    const fetcher = vi.fn(() => new Promise(r => { resolve = r }))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useZombieDmCommand('L'))
    await act(async () => {
      const first = result.current.sendCommand('use serum')
      expect(await result.current.sendCommand('use serum')).toBe(false)
      resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); await first
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retains the request id after an uncertain server error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Temporary failure' }) }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useZombieDmCommand('L'))
    await act(async () => { await result.current.sendCommand('use bomb') })
    await act(async () => { await result.current.sendCommand('use bomb') })
    expect(JSON.parse(fetcher.mock.calls[0][1].body).commandId).toBe(JSON.parse(fetcher.mock.calls[1][1].body).commandId)
  })
})
