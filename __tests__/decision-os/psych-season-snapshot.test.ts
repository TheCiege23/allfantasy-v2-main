import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { queryRaw, executeRaw } = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: queryRaw, $executeRaw: executeRaw },
}))

import {
  writeProfileSeasonSnapshot,
  readManagerTrajectory,
  summariseTrajectory,
} from '@/lib/psychological-profiles/ProfileSeasonSnapshot'

/**
 * ── 🛑 P1: THE PROFILE IS ONE ROW, OVERWRITTEN — HISTORY WAS UNRECOVERABLE ──────────────────
 *
 * `manager_psych_profiles` is `@@unique([leagueId, managerId])` and every refresh upserts it, so
 * "he was a rebuilder in 2023 and win-now since 2024" was not unimplemented — it was
 * **unanswerable from the data as stored**, and every refresh that ran destroyed the prior read.
 *
 * ⚠ RAW SQL, NOT A PRISMA DELEGATE, AND THAT IS DELIBERATE. Adding the model to `schema.prisma`
 * makes the delegate exist only after someone runs `prisma generate` — and regenerating mutates
 * shared `node_modules` under every running tsc, which took the whole box down once tonight.
 * Worse, an ungenerated client reproduces EXACTLY the `domain_os_facts` failure this session
 * already fixed: the delegate is absent, every write silently no-ops, and the caller cannot tell.
 * Raw SQL works the moment the table exists, which it does.
 */
describe('P1 — per-season snapshots make a trajectory possible', () => {
  beforeEach(() => vi.clearAllMocks())

  it('🛑 upserts on (league, manager, season) so a re-run REPLACES rather than duplicates', async () => {
    // The refresh runs every 30 minutes. Without ON CONFLICT this table would grow a row per fire
    // and a trajectory would read as dozens of identical "seasons".
    executeRaw.mockResolvedValue(1)
    await writeProfileSeasonSnapshot({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', format: 'dynasty', season: 2026,
      labels: ['win-now'], scores: { aggressionScore: 70, activityScore: null, tradeFrequencyScore: 80, waiverFocusScore: null, riskToleranceScore: 55 },
      sampleSize: 42, confidence: 0.66,
    })
    // ⚠ `Prisma.sql` hands `$executeRaw` a Sql OBJECT, not a template-strings array — so read its
    // `.strings`/`.sql`, not `[0].join`. The values are parameters and never appear in the text,
    // which is the property that makes this safe with a user-adjacent managerId.
    const arg = executeRaw.mock.calls[0][0] as { strings?: string[]; sql?: string }
    const sql = (arg.strings ?? []).join(' ') || arg.sql || ''
    expect(sql).toMatch(/ON CONFLICT/i)
    expect(sql).toMatch(/DO UPDATE/i)
    // The conflict target must be the unique index, or the upsert throws at runtime rather than
    // replacing — and the 30-minute refresh would grow a row per fire.
    expect(sql).toMatch(/"leagueId",\s*"managerId",\s*"season"/)
  })

  it('never throws — a failed snapshot must not break the refresh that produced it', async () => {
    executeRaw.mockRejectedValue(new Error('db down'))
    await expect(writeProfileSeasonSnapshot({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', format: null, season: 2026,
      labels: [], scores: { aggressionScore: null, activityScore: null, tradeFrequencyScore: null, waiverFocusScore: null, riskToleranceScore: null },
      sampleSize: 0, confidence: null,
    })).resolves.toBe(false)
  })

  it('reports TRUE only when a row was actually written', async () => {
    // Same lesson as OsStore.write: a writer that cannot report failure is a writer that lies.
    executeRaw.mockResolvedValue(1)
    await expect(writeProfileSeasonSnapshot({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', format: null, season: 2026,
      labels: [], scores: { aggressionScore: 1, activityScore: null, tradeFrequencyScore: null, waiverFocusScore: null, riskToleranceScore: null },
      sampleSize: 1, confidence: null,
    })).resolves.toBe(true)
  })

  it('reads a trajectory oldest-first, so a reader sees direction not just points', async () => {
    queryRaw.mockResolvedValue([
      { season: 2024, profileLabels: ['patient rebuilder'], aggressionScore: 20, sampleSize: 30, confidence: 0.5, computedAt: new Date('2024-12-01') },
      { season: 2026, profileLabels: ['win-now'], aggressionScore: 75, sampleSize: 60, confidence: 0.8, computedAt: new Date('2026-09-01') },
    ])
    const t = await readManagerTrajectory({ leagueId: 'L1', managerId: 'm1' })
    expect(t.map((r) => r.season)).toEqual([2024, 2026])
  })

  it('returns an empty trajectory rather than throwing when nothing is recorded', async () => {
    queryRaw.mockRejectedValue(new Error('nope'))
    await expect(readManagerTrajectory({ leagueId: 'L1', managerId: 'm1' })).resolves.toEqual([])
  })

  it('🛑 a SINGLE season is not a trajectory, and says so', () => {
    // One point has no direction. Calling it a trend is the "label seen once" error the
    // cross-league rollup already refuses — same rule, different axis.
    const s = summariseTrajectory([
      { season: 2026, labels: ['win-now'], aggressionScore: 75, sampleSize: 60, confidence: 0.8 },
    ])
    expect(s.hasTrajectory).toBe(false)
    expect(s.summary).toMatch(/one season/i)
  })

  it('names what CHANGED between the first and last season', () => {
    const s = summariseTrajectory([
      { season: 2024, labels: ['patient rebuilder'], aggressionScore: 20, sampleSize: 30, confidence: 0.5 },
      { season: 2026, labels: ['win-now'], aggressionScore: 75, sampleSize: 60, confidence: 0.8 },
    ])
    expect(s.hasTrajectory).toBe(true)
    expect(s.summary).toContain('patient rebuilder')
    expect(s.summary).toContain('win-now')
    expect(s.summary).toMatch(/2024/)
    expect(s.summary).toMatch(/2026/)
  })

  it('⚠ ignores seasons whose confidence is NULL — below the floor is not evidence of change', () => {
    // A season that never cleared its evidence floor cannot be one end of a "he changed" claim.
    // Two nulls and a real reading is one data point, not a trend.
    const s = summariseTrajectory([
      { season: 2023, labels: [], aggressionScore: 5, sampleSize: 1, confidence: null },
      { season: 2026, labels: ['win-now'], aggressionScore: 75, sampleSize: 60, confidence: 0.8 },
    ])
    expect(s.hasTrajectory).toBe(false)
  })
})
