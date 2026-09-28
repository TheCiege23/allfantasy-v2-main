import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SyncPostResult } from '@/lib/core-app/syncRunLoop'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const KEY = 'af-core-sync-continuation:v1'

beforeEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(window, '__afCoreSyncJobV1')
  window.sessionStorage.clear()
  router.refresh.mockClear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function seed(at = Date.now()) {
  window.sessionStorage.setItem(KEY, JSON.stringify({ at, checkpoint: {
    only: ['sleeper:unfinished'], total: 3, synced: 1, failed: 1, locked: 0, rounds: 5,
  } }))
}

describe('sync continues across client module and page reloads', () => {
  it('shares the running job and completion feedback across client bundles', async () => {
    const first = await import('@/lib/core-app/clientSyncJob')
    let finish!: (result: SyncPostResult) => void
    const post = vi.fn(() => new Promise<SyncPostResult>(resolve => { finish = resolve }))
    const job = first.startClientSync('sleeper:one', post)
    vi.resetModules()
    const second = await import('@/lib/core-app/clientSyncJob')
    const duplicate = vi.fn()
    expect(second.startClientSync('sleeper:two', duplicate)).toBe(job)
    expect(second.getClientSyncSnapshot().phase).toBe('busy')
    finish({ httpOk: true, round: { ok: true, totalCandidates: 1, attempted: 1, synced: 1 } })
    await job
    expect(duplicate).not.toHaveBeenCalled()
    expect(second.getClientSyncSnapshot().message).toBe('Synced 1')
    expect(second.claimClientSyncRefresh(1)).toBe(true)
    expect(first.claimClientSyncRefresh(1)).toBe(false)
  })

  it('automatically resumes only unfinished keys and retains previously reported failures', async () => {
    seed()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ ok: true, totalCandidates: 1, attempted: 1, synced: 1, remaining: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { default: SyncNowButton } = await import('@/components/core-app/SyncNowButton')
    render(<SyncNowButton eligibleCount={3} />)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Synced 2 of 3 · 1 failed · 0 already syncing'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ only: ['sleeper:unfinished'] })
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not resume expired checkpoints', async () => {
    seed(Date.now() - 16 * 60 * 1000)
    const { resumeClientSync } = await import('@/lib/core-app/clientSyncJob')
    const post = vi.fn()
    expect(resumeClientSync(post)).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('preserves confirmed remaining work when navigation aborts the next request', async () => {
    const first = await import('@/lib/core-app/clientSyncJob')
    let abort!: (result: SyncPostResult) => void
    const post = vi.fn()
      .mockResolvedValueOnce({ httpOk: true, round: { ok: true, totalCandidates: 2, attempted: 1, synced: 1, remaining: ['sleeper:unfinished'] } })
      .mockImplementationOnce(() => new Promise<SyncPostResult>(resolve => { abort = resolve }))
    const job = first.startClientSync(undefined, post)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    window.dispatchEvent(new Event('beforeunload'))
    abort({ httpOk: false, round: { error: 'Request interrupted' } })
    await job
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!).checkpoint.only).toEqual(['sleeper:unfinished'])
    Reflect.deleteProperty(window, '__afCoreSyncJobV1')
    vi.resetModules()
    const reloaded = await import('@/lib/core-app/clientSyncJob')
    const resume = vi.fn(async () => ({ httpOk: true, round: { ok: true, totalCandidates: 1, attempted: 1, synced: 1, remaining: [] } }))
    await reloaded.resumeClientSync(resume)
    expect(resume).toHaveBeenCalledWith(['sleeper:unfinished'])
    expect(reloaded.getClientSyncSnapshot().message).toBe('Synced 2')
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('clears remaining work after an ordinary transport failure without auto-retry', async () => {
    seed()
    const { resumeClientSync } = await import('@/lib/core-app/clientSyncJob')
    await resumeClientSync(async () => ({ httpOk: false, round: { error: 'Network unavailable' } }))
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('still permits a requested sync when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { startClientSync, getClientSyncSnapshot } = await import('@/lib/core-app/clientSyncJob')
    await startClientSync('sleeper:one', async () => ({ httpOk: true, round: { ok: true, totalCandidates: 1, attempted: 1, synced: 1 } }))
    expect(getClientSyncSnapshot().message).toBe('Synced 1')
  })
})
