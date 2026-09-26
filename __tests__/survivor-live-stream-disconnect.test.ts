/**
 * The Survivor live stream must stop working the moment nobody is reading it.
 *
 * 🛑 IT DID NOT. `GET /api/leagues/[leagueId]/survivor/live` had no `cancel()` and ignored the
 * request's abort signal, so after a viewer left, its two timers ran for the full 300 s: audit-table
 * queries every 4 s and a heartbeat that threw `ERR_INVALID_STATE: Controller is already closed` as
 * an uncaughtException every 5 s. Found in a dev session on 2026-09-26: 63 of those from one tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  entries: vi.fn(async () => [] as unknown[]),
  logs: vi.fn(async () => [] as unknown[]),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/prisma', () => {
  const prisma = {
    survivorAuditEntry: { findMany: h.entries },
    survivorAuditLog: { findMany: h.logs },
  }
  return { prisma, default: prisma }
})

import { GET } from '@/server/api-route-modules/league-survivor/live/route'

async function open() {
  const abort = new AbortController()
  const req = new NextRequest('http://x/api/leagues/L1/survivor/live', { signal: abort.signal })
  const res = await GET(req, { params: Promise.resolve({ leagueId: 'L1' }) })
  const reader = res.body!.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  return { abort, reader, first }
}

/** Database reads made so far — each tick makes one of each. */
const reads = () => h.entries.mock.calls.length

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the Survivor live stream', () => {
  it('polls while someone is reading', async () => {
    const { first, reader } = await open()
    expect(first).toContain('"type":"connected"')
    const before = reads()
    await vi.advanceTimersByTimeAsync(8_100)
    expect(reads()).toBeGreaterThan(before)
    await reader.cancel()
  })

  it('stops every timer the moment the viewer cancels', async () => {
    const { reader } = await open()
    await vi.advanceTimersByTimeAsync(4_100)
    await reader.cancel()
    const atCancel = reads()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(atCancel)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops when the request is aborted (the tab went away mid-response)', async () => {
    const { abort } = await open()
    abort.abort()
    const atAbort = reads()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(atAbort)
    expect(vi.getTimerCount()).toBe(0)
  })

  /* A rejected read used to escape as an unhandled rejection; vitest fails the run on one. */
  it('survives a failed database read and keeps polling', async () => {
    h.entries.mockRejectedValueOnce(new Error('db blip'))
    const { reader } = await open()
    await vi.advanceTimersByTimeAsync(8_100)
    expect(reads()).toBeGreaterThanOrEqual(3)
    await reader.cancel()
  })
})
