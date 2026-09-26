// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { claimClientSyncRefresh, getClientSyncSnapshot, startClientSync, subscribeClientSync } from '@/lib/core-app/clientSyncJob'
import type { SyncPostResult } from '@/lib/core-app/syncRunLoop'

describe('shared client sync job', () => {
  it('keeps one running job when another control is clicked and screens change', async () => {
    let resolve!: (result: SyncPostResult) => void
    const post = vi.fn(() => new Promise<SyncPostResult>((done) => { resolve = done }))
    const oldScreen = vi.fn()
    const unsubscribe = subscribeClientSync(oldScreen)
    const job = startClientSync('sleeper:one', post)
    expect(getClientSyncSnapshot().phase).toBe('busy')
    expect(startClientSync('sleeper:two', post)).toBe(job)
    unsubscribe()
    oldScreen.mockClear()
    const newScreen = vi.fn()
    const stop = subscribeClientSync(newScreen)
    resolve({ httpOk: true, round: { ok: true, totalCandidates: 1, attempted: 1, synced: 1 } })
    await job
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(['sleeper:one'])
    expect(oldScreen).not.toHaveBeenCalled()
    expect(newScreen).toHaveBeenCalled()
    expect(getClientSyncSnapshot().message).toBe('Synced 1')
    const completion = getClientSyncSnapshot().completion
    expect(claimClientSyncRefresh(completion)).toBe(true)
    expect(claimClientSyncRefresh(completion)).toBe(false)
    stop()
  })

  it('continues remaining leagues even when no screen is subscribed', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ httpOk: true, round: { ok: true, totalCandidates: 2, attempted: 1, synced: 1, remaining: ['sleeper:two'] } })
      .mockResolvedValueOnce({ httpOk: true, round: { ok: true, totalCandidates: 1, attempted: 1, synced: 1 } })
    await startClientSync(null, post)
    expect(post).toHaveBeenNthCalledWith(2, ['sleeper:two'])
    expect(getClientSyncSnapshot().message).toBe('Synced 2')
  })

  it('clears a failed job so a later press can retry', async () => {
    const failure = vi.fn(async () => ({ httpOk: false, round: { error: 'Connection interrupted' } }))
    await startClientSync(null, failure)
    expect(getClientSyncSnapshot().phase).toBe('error')
    const retry = vi.fn(async () => ({ httpOk: true, round: { ok: true, totalCandidates: 1, attempted: 1, synced: 1 } }))
    await startClientSync(null, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(getClientSyncSnapshot().phase).toBe('done')
  })
})
