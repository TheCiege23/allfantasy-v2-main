import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { queryRaw, executeRaw } = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: queryRaw, $executeRaw: executeRaw },
}))

import {
  writeProfileSeasonSnapshot,
  readManagerTrajectory,
  readLeagueTrajectories,
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

  /**
   * ── R4b.5 — `readLeagueTrajectories`: one query for the whole league, not one per manager ────
   * The psychology packet slice reports on every manager in a league (8-14, typically), and
   * `readManagerTrajectory` in a loop would be N+1. Same row shape, same null-handling — these
   * tests exist to catch the two ways that could drift: managers not correctly grouped, or the
   * batched path silently losing the null-preservation guard the single-manager path already has.
   */
  it('🛑 groups seasons by manager, and each manager stays season-ordered within their own group', async () => {
    queryRaw.mockResolvedValue([
      { managerId: 'm1', season: 2024, profileLabels: ['rebuilder'], aggressionScore: 20, sampleSize: 10, confidence: 0.5 },
      { managerId: 'm2', season: 2025, profileLabels: ['aggressive'], aggressionScore: 90, sampleSize: 40, confidence: 0.9 },
      { managerId: 'm1', season: 2026, profileLabels: ['win-now'], aggressionScore: 80, sampleSize: 50, confidence: 0.7 },
    ])
    const byManager = await readLeagueTrajectories('L1')
    expect(byManager.get('m1')?.map((p) => p.season)).toEqual([2024, 2026])
    expect(byManager.get('m2')?.map((p) => p.season)).toEqual([2025])
  })

  it('🛑 preserves a null aggressionScore in the batched read, same as the single-manager read', async () => {
    // `Number(null)` is 0, not NaN — R4b.3's exact bug, in the path this session already fixed it
    // once. The batched query shares `toTrajectoryPoint`, but a regression here would be silent:
    // the map still builds, it would just quietly resurrect a coerced zero.
    queryRaw.mockResolvedValue([
      { managerId: 'm1', season: 2026, profileLabels: [], aggressionScore: null, sampleSize: 5, confidence: 0.4 },
    ])
    const byManager = await readLeagueTrajectories('L1')
    expect(byManager.get('m1')?.[0]?.aggressionScore).toBeNull()
  })

  it('returns an empty map rather than throwing when the query fails', async () => {
    queryRaw.mockRejectedValue(new Error('nope'))
    const byManager = await readLeagueTrajectories('L1')
    expect(byManager.size).toBe(0)
  })

  it('a manager with no rows at all is simply absent from the map (not an empty array)', async () => {
    queryRaw.mockResolvedValue([])
    const byManager = await readLeagueTrajectories('L1')
    expect(byManager.has('m-nonexistent')).toBe(false)
    expect(byManager.get('m-nonexistent')).toBeUndefined()
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

/**
 * ── 🛑 R4b.3: "NEVER MEASURED" MUST NOT BE STORED, READ, OR REPORTED AS ZERO ────────────────
 *
 * The five score columns were `NOT NULL DEFAULT 0` and the writer coalesced with `?? 0`, so a
 * manager never assessed for aggression was recorded as maximally passive — the exact failure
 * `gateScores` prevents one module over, where `PsychologyProfileFact.scores` is already
 * `number | null` for this reason. Measured on the first 97 production rows: 68 had a non-zero
 * aggression score and nothing separated the other 29 from genuine zeros.
 *
 * ⚠ THE NULL DIED IN THREE PLACES, NOT ONE, AND EACH NEEDS ITS OWN TEST. The writer coalesced it,
 * `Number(null)` is `0` so the READ resurrected it, and `null - 5` is `-5` so the SUMMARY would
 * have reported a confident swing for a season nobody measured. Fixing only the writer would have
 * left two of the three intact and the suite still green.
 */
describe('R4b.3 — an unmeasured score stays unmeasured end to end', () => {
  beforeEach(() => vi.clearAllMocks())

  it('🛑 WRITE: sends NULL, never 0, for an unmeasured score', async () => {
    executeRaw.mockResolvedValue(1)
    await writeProfileSeasonSnapshot({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', format: null, season: 2026,
      labels: [],
      scores: { aggressionScore: null, activityScore: null, tradeFrequencyScore: null, waiverFocusScore: null, riskToleranceScore: null },
      // Deliberately NON-zero: sampleSize is the one numeric that legitimately may be 0, so
      // keeping it at 7 means any 0 in the parameter list can ONLY be a coalesced score.
      sampleSize: 7,
      confidence: null,
    })
    const vals = (executeRaw.mock.calls[0][0] as { values: unknown[] }).values
    // The positive control: restore `?? 0` in the writer and five zeros appear here.
    expect(vals).not.toContain(0)
    expect(vals.filter((v) => v === null)).toHaveLength(7) // 5 scores + format + confidence
  })

  it('🛑 READ: a NULL column comes back null — `Number(null)` is 0, not NaN', async () => {
    queryRaw.mockResolvedValue([
      { season: 2026, profileLabels: [], aggressionScore: null, sampleSize: 4, confidence: 0.3 },
    ])
    const t = await readManagerTrajectory({ leagueId: 'L1', managerId: 'm1' })
    // A bare `Number(r.aggressionScore)` silently yields 0 and this is the only thing that says so.
    expect(t[0].aggressionScore).toBeNull()
    expect(t[0].aggressionScore).not.toBe(0)
  })

  it('🛑 SUMMARY: refuses a delta when either end is unmeasured, rather than treating it as 0', () => {
    // Both seasons clear the evidence floor, so this is NOT the confidence filter — clearing the
    // floor overall does not imply every individual score was measured.
    const s = summariseTrajectory([
      { season: 2024, labels: ['patient rebuilder'], aggressionScore: null, sampleSize: 30, confidence: 0.5 },
      { season: 2026, labels: ['win-now'], aggressionScore: 75, sampleSize: 60, confidence: 0.8 },
    ])
    // The label change is real direction, so the trajectory survives — only the number is withheld.
    expect(s.hasTrajectory).toBe(true)
    expect(s.summary).toContain('patient rebuilder')
    expect(s.summary).toContain('win-now')
    expect(s.summary).toMatch(/not measured/i)
    // `null - 75` is -75 in JS, so the un-fixed code prints a confident "+75"/"-75" here.
    expect(s.summary).not.toMatch(/aggression [+-]?\d/)
  })

  it('still reports the delta when BOTH ends were measured', () => {
    // Guards the fix against over-correcting into refusing everything.
    const s = summariseTrajectory([
      { season: 2024, labels: ['patient rebuilder'], aggressionScore: 20, sampleSize: 30, confidence: 0.5 },
      { season: 2026, labels: ['win-now'], aggressionScore: 75, sampleSize: 60, confidence: 0.8 },
    ])
    expect(s.summary).toContain('aggression +55')
  })
})
