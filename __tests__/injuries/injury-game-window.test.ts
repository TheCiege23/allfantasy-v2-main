import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The five-minute game-day injury run: /api/cron/import-injuries?sport=NFL&gameWindow=1.
 * Measured 2026-09-20: new ESPN injury rows landed at 11:30, 11:45 and 12:30 ET on a 30-minute
 * cron — a 45-minute hole across the inactives hour. This run fills it, and costs one indexed
 * read the rest of the week.
 */

const mockGameFindFirst = vi.hoisted(() => vi.fn())
const mockRi = vi.hoisted(() => vi.fn())
const mockEspn = vi.hoisted(() => vi.fn())
const heartbeats = vi.hoisted(() => [] as Array<{ jobName: string; outcome: unknown }>)

vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findFirst: mockGameFindFirst } } }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/injuries/rollingInsightsInjuries', () => ({ syncRollingInsightsInjuriesToDb: mockRi }))
vi.mock('@/lib/injuries/espnInjuries', () => ({ espnHasInjuryFeed: () => true, syncEspnInjuriesToDb: mockEspn }))
vi.mock('@/lib/api-sports', () => ({ getApiSportsKey: () => null, syncAPISportsInjuriesToDb: vi.fn() }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (ctx: { jobName: string }, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
    const r = await fn()
    heartbeats.push({ jobName: ctx.jobName, outcome: extract ? extract(r) : null })
    return r
  },
}))
vi.mock('@/lib/injuries/injurySyncState', () => ({ recordInjurySyncRun: vi.fn(async () => {}), recordInjurySyncDeferred: vi.fn(async () => {}) }))

import { kickoffRangeForWindow, inNflInjuryGameWindow } from '@/lib/injuries/injuryGameWindow'
import { GET } from '@/app/api/cron/import-injuries/route'

const req = (qs: string) => new NextRequest(`http://localhost/api/cron/import-injuries${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  heartbeats.length = 0
  mockRi.mockResolvedValue({ fetched: 10, written: 10, unparseableStatus: 0, legacyExpired: 0, unsupported: false, notModified: false, errors: [] })
  mockEspn.mockResolvedValue({ sport: 'NFL', fetched: 300, written: 300, skippedNoPlayer: 0, errors: [] })
})

describe('kickoffRangeForWindow', () => {
  it('reaches 150 minutes ahead (the inactive list is ~90 before) and 30 behind (late scratches)', () => {
    const now = new Date('2026-09-27T15:30:00.000Z') // 11:30a ET
    const { from, to } = kickoffRangeForWindow(now)
    expect(from.toISOString()).toBe('2026-09-27T15:00:00.000Z')
    expect(to.toISOString()).toBe('2026-09-27T18:00:00.000Z') // a 1:00p ET kickoff (17:00Z) is inside
  })
})

describe('inNflInjuryGameWindow', () => {
  it('reads the NFL schedule for a kickoff in range', async () => {
    mockGameFindFirst.mockResolvedValueOnce({ id: 'g1' })
    expect(await inNflInjuryGameWindow(new Date('2026-09-27T15:30:00.000Z'))).toBe(true)
    expect(mockGameFindFirst.mock.calls[0][0].where.sport).toBe('NFL')
    mockGameFindFirst.mockResolvedValueOnce(null)
    expect(await inNflInjuryGameWindow(new Date('2026-09-29T15:30:00.000Z'))).toBe(false)
  })
  it('a failed read answers true — an extra poll is cheap, a missed inactive is not', async () => {
    mockGameFindFirst.mockRejectedValueOnce(new Error('db down'))
    expect(await inNflInjuryGameWindow()).toBe(true)
  })
})

describe('import-injuries ?gameWindow=1', () => {
  it('outside a window: no provider is called and the run says it skipped', async () => {
    mockGameFindFirst.mockResolvedValue(null)
    const res = await GET(req('?sport=NFL&gameWindow=1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'outside an NFL game window' })
    expect(mockRi).not.toHaveBeenCalled()
    expect(mockEspn).not.toHaveBeenCalled()
    // The tick still FIRED, and says so: a heartbeat on every fire is what the freshness monitor probes.
    expect(heartbeats).toEqual([{ jobName: 'cron-import-injuries-gamewindow', outcome: { rowsWritten: 0, status: 'success', metadata: { inWindow: false } } }])
  })

  it('inside a window: ESPN runs and Rolling Insights (twice-daily feed) does not', async () => {
    mockGameFindFirst.mockResolvedValue({ id: 'g1' })
    const res = await GET(req('?sport=NFL&gameWindow=1'))
    expect(res.status).toBe(200)
    expect(mockEspn).toHaveBeenCalledTimes(1)
    expect(mockRi).not.toHaveBeenCalled()
    expect(heartbeats).toEqual([{ jobName: 'cron-import-injuries-gamewindow', outcome: { rowsWritten: 300, status: 'success', metadata: { inWindow: true } } }])
  })

  it('refuses any sport but NFL — the window is read off the NFL schedule', async () => {
    const res = await GET(req('?sport=NBA&gameWindow=1'))
    expect(res.status).toBe(400)
    expect(mockGameFindFirst).not.toHaveBeenCalled()
  })

  it('the ordinary run is unchanged: Rolling Insights still runs', async () => {
    const res = await GET(req('?sport=NFL'))
    expect(res.status).toBe(200)
    expect(mockRi).toHaveBeenCalledTimes(1)
    expect(mockGameFindFirst).not.toHaveBeenCalled()
  })
})

describe('the registry', () => {
  it('declares the game-window run and has a heartbeat probe for it', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('cron-schedule.json', 'utf8')).crons as Array<{ path: string; schedule: string }>
    expect(crons).toContainEqual({ path: '/api/cron/import-injuries?sport=NFL&gameWindow=1', schedule: '*/5 * * * *' })
    const { PROBES } = await import('../../scripts/cron-freshness-check.mjs')
    expect(PROBES['/api/cron/import-injuries?sport=NFL&gameWindow=1']).toEqual({ heartbeat: 'cron-import-injuries-gamewindow' })
  })
})
