import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Commissioner OS, 2026-11-20: the hub screen's snapshot is Chimmy's snapshot. The hub builds the league-health
 * snapshot live and hands it to Commissioner OS's five-minute fact, so Chimmy's next read serves the numbers the
 * commissioner is looking at — and opening the hub is the warm.
 */

const derive = vi.fn()
vi.mock('@/lib/commissioner-hub/commissionerHubHealth', () => ({ getCommissionerHubHealthForUser: derive }))

// An in-memory `domain_os_facts`.
const rows = new Map<string, Record<string, unknown>>()
const k = (w: { domain_kind_level_scopeKey: Record<string, string> }) => Object.values(w.domain_kind_level_scopeKey).join('/')
let writesFail = false
vi.mock('@/lib/prisma', () => ({
  prisma: {
    domainOsFacts: {
      findUnique: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> } }) => rows.get(k(a.where)) ?? null),
      upsert: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> }; create: Record<string, unknown> }) => {
        if (writesFail) throw new Error('write refused')
        rows.set(k(a.where), { ...a.create, capturedAt: new Date() })
        return a.create
      }),
    },
  },
}))

const { primeCommissionerHealthSnapshot, createCommissionerOsLoaders } = await import('@/lib/decision-os/commissioner-os')
const { createOsFeed } = await import('@/lib/decision-os/domain-os/feed')

const ARGS = { userId: 'u1', leagueId: 'lg1' }
const shown = (over: Record<string, unknown> = {}) =>
  ({ leagueId: 'lg1', source: 'database', teamCount: 12, dataConfidence: 'high', healthScore: 71, inactiveManagers: 2, ...over }) as never
const HUB = { dynastySignals: false, dynastyLeague: false }

beforeEach(() => {
  rows.clear()
  writesFail = false
  derive.mockReset()
  derive.mockResolvedValue([{ leagueId: 'lg1', source: 'database', teamCount: 12, dataConfidence: 'high', healthScore: 55, inactiveManagers: 5 }])
})

describe('the hub screen primes what Chimmy reads', () => {
  it('Chimmy’s next read serves the screen’s snapshot — no second build', async () => {
    expect(await primeCommissionerHealthSnapshot(ARGS, shown(), HUB)).toBe(true)
    const loaders = createCommissionerOsLoaders()
    const read = await loaders.loadHealthSnapshot(ARGS)
    expect(read).toMatchObject({ healthScore: 71, inactiveManagers: 2 })
    expect(loaders.drainOutcomes()).toMatchObject({ health: { servedFrom: 'store' } })
    expect(derive).not.toHaveBeenCalled()
  })

  it('control: without the prime, Chimmy derives its own (different) build', async () => {
    const read = await createCommissionerOsLoaders().loadHealthSnapshot(ARGS)
    expect(read).toMatchObject({ healthScore: 55, inactiveManagers: 5 })
    expect(derive).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the dashboard fallback', shown({ source: 'dashboard-fallback' }), HUB],
    ['another league’s snapshot', shown({ leagueId: 'lg2' }), HUB],
    ['a dynasty league built without its dynasty signals', shown(), { dynastySignals: false, dynastyLeague: true }],
    ['no snapshot', null, HUB],
  ])('never stores %s', async (_label, snap, built) => {
    expect(await primeCommissionerHealthSnapshot(ARGS, snap as never, built)).toBe(false)
    expect(rows.size).toBe(0)
  })

  it('a dynasty league built WITH its signals is stored', async () => {
    expect(await primeCommissionerHealthSnapshot(ARGS, shown(), { dynastySignals: true, dynastyLeague: true })).toBe(true)
  })

  it('a refused write reports false and never throws', async () => {
    writesFail = true
    await expect(primeCommissionerHealthSnapshot(ARGS, shown(), HUB)).resolves.toBe(false)
  })

  it('the kernel never stores a null fact', async () => {
    const store = { read: vi.fn(async () => null), write: vi.fn(async () => true) }
    const feed = createOsFeed('commissioner', { store: store as never })
    const source = { kind: 'x', level: 'user' as const, ttlMs: 1000, scopeKey: () => 'k', sport: () => 'ALL', derive: async () => null }
    expect(await feed.prime(source, {}, null)).toBe(false)
    expect(store.write).not.toHaveBeenCalled()
  })
})

describe('the hub screen is wired to it', () => {
  const SRC = readFileSync(join(process.cwd(), 'lib/core-app/commissionerHub.ts'), 'utf8')

  it('primes the snapshot it scores, after the commissioner check', () => {
    const roleCheck = SRC.indexOf("role !== 'commissioner' && role !== 'co_commissioner'")
    const picked = SRC.indexOf('const snapshot = healthSnapshots.find((s) => s.leagueId === leagueId) ?? null')
    const primed = SRC.search(/^\s*void primeCommissionerHealthSnapshot\(\{ userId, leagueId \}, snapshot, \{ dynastySignals: dynastyLeague, dynastyLeague \}\)/m)
    expect(roleCheck).toBeGreaterThan(-1)
    expect(picked).toBeGreaterThan(roleCheck)
    expect(primed).toBeGreaterThan(picked)
  })

  it('builds with the dynasty signals the prime is told about', () => {
    expect(SRC).toMatch(/\], \{ dynastySignals: dynastyLeague \}\)\.catch\(\(\) => \[\]\)/)
  })
})
