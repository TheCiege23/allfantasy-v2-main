/**
 * Phase 4 — Production Data Health core coverage.
 *
 * Exercises every verdict branch the operational dashboard depends on, with a
 * fixed clock so freshness math is deterministic:
 *   - successful imports / failed imports / partial imports
 *   - cron never-run + stuck-running detection
 *   - stale + very-stale freshness
 *   - provider outage isolation + unconfigured provider
 *   - stale / expired / empty cache
 *   - traffic-light rollups
 *   - structured AI data warnings for Chimmy
 */

import { describe, expect, it } from 'vitest'

import {
  ageHoursFrom,
  buildAiDataWarnings,
  computeCacheHealth,
  computeCronStatus,
  computeFreshness,
  computeJobHealth,
  computeProviderHealth,
  normalizeRunStatus,
  rollupTrafficLights,
  TRAFFIC_LIGHT_EMOJI,
  type JobRunRecord,
} from '@/lib/production-health/productionHealthCore'

const NOW = Date.parse('2026-06-25T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

// ───────────────────────────── traffic lights ─────────────────────────────

describe('rollupTrafficLights — worst-of severity', () => {
  it('returns failed when any input is failed', () => {
    expect(rollupTrafficLights(['healthy', 'warning', 'failed'])).toBe('failed')
  })
  it('returns warning when worst is warning', () => {
    expect(rollupTrafficLights(['healthy', 'warning', 'healthy'])).toBe('warning')
  })
  it('returns healthy when all healthy', () => {
    expect(rollupTrafficLights(['healthy', 'healthy'])).toBe('healthy')
  })
  it('returns unknown for empty or all-unknown', () => {
    expect(rollupTrafficLights([])).toBe('unknown')
    expect(rollupTrafficLights(['unknown', 'unknown'])).toBe('unknown')
  })
  it('ignores unknown when a real signal exists', () => {
    expect(rollupTrafficLights(['unknown', 'healthy'])).toBe('healthy')
  })
  it('exposes emoji for each light', () => {
    expect(TRAFFIC_LIGHT_EMOJI.healthy).toBe('🟢')
    expect(TRAFFIC_LIGHT_EMOJI.warning).toBe('🟡')
    expect(TRAFFIC_LIGHT_EMOJI.failed).toBe('🔴')
  })
})

// ───────────────────────────── freshness ──────────────────────────────────

describe('computeFreshness — tiers + traffic lights', () => {
  it('fresh under 6h', () => {
    const f = computeFreshness(hoursAgo(2), { now: NOW })
    expect(f.status).toBe('fresh')
    expect(f.trafficLight).toBe('healthy')
  })
  it('recent between 6h and 24h', () => {
    expect(computeFreshness(hoursAgo(12), { now: NOW }).status).toBe('recent')
  })
  it('stale between 24h and 7d → warning', () => {
    const f = computeFreshness(hoursAgo(48), { now: NOW })
    expect(f.status).toBe('stale')
    expect(f.trafficLight).toBe('warning')
  })
  it('very_stale past 7d → failed', () => {
    const f = computeFreshness(hoursAgo(24 * 10), { now: NOW })
    expect(f.status).toBe('very_stale')
    expect(f.trafficLight).toBe('failed')
  })
  it('pending when no timestamp but data expected', () => {
    expect(computeFreshness(null, { now: NOW }).status).toBe('pending')
  })
  it('unavailable when dataAvailable is false', () => {
    const f = computeFreshness(hoursAgo(1), { now: NOW, dataAvailable: false })
    expect(f.status).toBe('unavailable')
    expect(f.trafficLight).toBe('failed')
  })
  it('respects custom thresholds', () => {
    const f = computeFreshness(hoursAgo(2), { now: NOW, thresholds: { staleAfterH: 1, veryStaleAfterH: 6 } })
    expect(f.status).toBe('stale')
  })

  it('ageHoursFrom handles bad input', () => {
    expect(ageHoursFrom(null)).toBeNull()
    expect(ageHoursFrom('not-a-date')).toBeNull()
    expect(ageHoursFrom(hoursAgo(3), NOW)).toBeCloseTo(3, 5)
  })
})

// ───────────────────────────── run status normalization ───────────────────

describe('normalizeRunStatus', () => {
  it('maps success-like statuses', () => {
    for (const s of ['success', 'completed', 'real', 'cached_only', 'OK']) {
      expect(normalizeRunStatus(s)).toBe('success')
    }
  })
  it('maps failure + partial + running', () => {
    expect(normalizeRunStatus('failed')).toBe('failed')
    expect(normalizeRunStatus('partial')).toBe('partial')
    expect(normalizeRunStatus('running')).toBe('running')
  })
  it('unknown for unrecognized', () => {
    expect(normalizeRunStatus('weird')).toBe('unknown')
    expect(normalizeRunStatus(undefined)).toBe('unknown')
  })
})

// ───────────────────────────── cron / job health ──────────────────────────

function run(over: Partial<JobRunRecord>): JobRunRecord {
  return {
    jobName: 'import-players',
    status: 'success',
    rowsRead: 100,
    rowsWritten: 100,
    rowsSkipped: 0,
    startedAt: hoursAgo(1),
    completedAt: hoursAgo(1),
    durationMs: 1200,
    ...over,
  }
}

describe('computeJobHealth', () => {
  it('healthy on a recent successful run', () => {
    const h = computeJobHealth({ jobName: 'import-players' }, [run({})], { now: NOW })
    expect(h.trafficLight).toBe('healthy')
    expect(h.lastStatus).toBe('success')
    expect(h.succeededToday).toBe(true)
    expect(h.lastRows.written).toBe(100)
  })

  it('failed when the last run failed, surfacing the error', () => {
    const h = computeJobHealth({ jobName: 'import-players' }, [
      run({ status: 'failed', errorMessage: 'provider 503', startedAt: hoursAgo(0.5), completedAt: hoursAgo(0.5) }),
      run({ status: 'success', startedAt: hoursAgo(8), completedAt: hoursAgo(8) }),
    ], { now: NOW })
    expect(h.trafficLight).toBe('failed')
    expect(h.message).toMatch(/FAILED/)
    expect(h.errors[0]).toMatch(/provider 503/)
    expect(h.lastSuccessAt).not.toBeNull() // prior success still tracked
  })

  it('never-run job is failed with a clear message', () => {
    const h = computeJobHealth({ jobName: 'import-projections', label: 'Projections' }, [], { now: NOW })
    expect(h.trafficLight).toBe('failed')
    expect(h.message).toMatch(/never run/i)
    expect(h.lastSuccessAt).toBeNull()
  })

  it('partial run is a warning and reports skipped rows', () => {
    const h = computeJobHealth({ jobName: 'import-players' }, [
      run({ status: 'partial', rowsSkipped: 17, startedAt: hoursAgo(0.5), completedAt: hoursAgo(0.5) }),
    ], { now: NOW })
    expect(h.trafficLight).toBe('warning')
    expect(h.warnings.join(' ')).toMatch(/17 rows skipped/)
  })

  it('stale success (older than threshold) is a warning', () => {
    const h = computeJobHealth({ jobName: 'import-players', staleAfterH: 6 }, [
      run({ startedAt: hoursAgo(30), completedAt: hoursAgo(30) }),
    ], { now: NOW })
    expect(h.trafficLight).toBe('warning')
    expect(h.succeededToday).toBe(false)
  })

  it('very stale success is failed', () => {
    const h = computeJobHealth({ jobName: 'import-players', staleAfterH: 6 }, [
      run({ startedAt: hoursAgo(24 * 3), completedAt: hoursAgo(24 * 3) }),
    ], { now: NOW })
    expect(h.trafficLight).toBe('failed')
  })

  it('detects a stuck (long-running) job', () => {
    const h = computeJobHealth({ jobName: 'waivers', stuckAfterH: 1 }, [
      run({ status: 'running', startedAt: hoursAgo(4), completedAt: null }),
    ], { now: NOW })
    expect(h.runningTooLong).toBe(true)
    expect(h.trafficLight).toBe('warning')
    expect(h.message).toMatch(/stuck/i)
  })

  it('a fresh running job is healthy, not stuck', () => {
    const h = computeJobHealth({ jobName: 'waivers', stuckAfterH: 2 }, [
      run({ status: 'running', startedAt: hoursAgo(0.1), completedAt: null }),
    ], { now: NOW })
    expect(h.runningTooLong).toBe(false)
    expect(h.trafficLight).toBe('healthy')
  })
})

describe('computeCronStatus — fleet rollup', () => {
  const expected = [
    { jobName: 'import-players', staleAfterH: 12 },
    { jobName: 'import-injuries', staleAfterH: 6 },
    { jobName: 'import-projections', staleAfterH: 24 },
  ]

  it('rolls up to failed when one job is missing', () => {
    const runs = [
      run({ jobName: 'import-players', startedAt: hoursAgo(1), completedAt: hoursAgo(1) }),
      run({ jobName: 'import-injuries', startedAt: hoursAgo(1), completedAt: hoursAgo(1) }),
      // import-projections never ran
    ]
    const report = computeCronStatus(expected, runs, { now: NOW })
    expect(report.trafficLight).toBe('failed')
    expect(report.failed).toContain('import-projections')
    expect(report.total).toBe(3)
    expect(report.healthy).toBe(2)
  })

  it('all healthy when every job recently succeeded', () => {
    const runs = expected.map((e) => run({ jobName: e.jobName, startedAt: hoursAgo(1), completedAt: hoursAgo(1) }))
    const report = computeCronStatus(expected, runs, { now: NOW })
    expect(report.trafficLight).toBe('healthy')
    expect(report.failed).toEqual([])
  })
})

// ───────────────────────────── provider health ────────────────────────────

describe('computeProviderHealth — outage isolation', () => {
  it('healthy when last success is recent and no newer error', () => {
    const h = computeProviderHealth(
      { provider: 'Sleeper', lastSuccessAt: hoursAgo(2), lastErrorAt: hoursAgo(40), recordsImported: 500 },
      { now: NOW },
    )
    expect(h.trafficLight).toBe('healthy')
    expect(h.records.imported).toBe(500)
  })

  it('failed when the most recent event is an error (outage)', () => {
    const h = computeProviderHealth(
      { provider: 'ESPN', lastSuccessAt: hoursAgo(10), lastErrorAt: hoursAgo(1), lastError: 'timeout' },
      { now: NOW },
    )
    expect(h.trafficLight).toBe('failed')
    expect(h.message).toMatch(/FAILING/)
    expect(h.lastError).toBe('timeout')
  })

  it('warning when unconfigured', () => {
    const h = computeProviderHealth({ provider: 'Fantrax', configured: false }, { now: NOW })
    expect(h.trafficLight).toBe('warning')
    expect(h.freshness).toBe('unavailable')
  })

  it('one provider failing does not change another provider verdict', () => {
    const espn = computeProviderHealth({ provider: 'ESPN', lastErrorAt: hoursAgo(1), lastSuccessAt: hoursAgo(10) }, { now: NOW })
    const sleeper = computeProviderHealth({ provider: 'Sleeper', lastSuccessAt: hoursAgo(1) }, { now: NOW })
    expect(espn.trafficLight).toBe('failed')
    expect(sleeper.trafficLight).toBe('healthy')
  })

  it('stale success (no recent error) is a warning', () => {
    const h = computeProviderHealth({ provider: 'MFL', lastSuccessAt: hoursAgo(48) }, { now: NOW, staleAfterH: 24 })
    expect(h.trafficLight).toBe('warning')
    expect(h.freshness).toBe('stale')
  })
})

// ───────────────────────────── cache health ───────────────────────────────

describe('computeCacheHealth', () => {
  it('empty cache scope is failed', () => {
    const c = computeCacheHealth([{ name: 'NFL players', count: 0, lastUpdatedAt: hoursAgo(1) }], { now: NOW })
    expect(c.scopes[0].reason).toBe('empty')
    expect(c.trafficLight).toBe('failed')
  })

  it('expired cache is a warning', () => {
    const c = computeCacheHealth([{ name: 'pool', count: 10, expiresAt: hoursAgo(1), lastUpdatedAt: hoursAgo(2) }], { now: NOW })
    expect(c.scopes[0].reason).toBe('expired')
  })

  it('stale cache (old lastUpdatedAt) is a warning', () => {
    const c = computeCacheHealth([{ name: 'standings', count: 10, lastUpdatedAt: hoursAgo(48) }], { now: NOW, staleAfterH: 24 })
    expect(c.scopes[0].reason).toBe('stale')
  })

  it('healthy cache scope', () => {
    const c = computeCacheHealth([{ name: 'players', count: 999, lastUpdatedAt: hoursAgo(1) }], { now: NOW })
    expect(c.scopes[0].reason).toBe('ok')
    expect(c.trafficLight).toBe('healthy')
  })
})

// ───────────────────────────── AI data warnings (Chimmy) ──────────────────

describe('buildAiDataWarnings — Chimmy freshness guardrails', () => {
  it('emits no warnings when data is fresh/recent', () => {
    const w = buildAiDataWarnings('NFL', { players: 'fresh', injuries: 'recent' })
    expect(w).toEqual([])
  })

  it('flags stale as warning and very_stale/unavailable as critical', () => {
    const w = buildAiDataWarnings('NFL', {
      projections: 'stale',
      injuries: 'very_stale',
      schedule: 'unavailable',
      players: 'pending',
    })
    const byType = Object.fromEntries(w.map((x) => [x.dataType, x]))
    expect(byType.projections.severity).toBe('warning')
    expect(byType.injuries.severity).toBe('critical')
    expect(byType.schedule.severity).toBe('critical')
    expect(byType.players.severity).toBe('critical')
  })

  it('includes an explicit do-not-hallucinate instruction for unavailable data', () => {
    const w = buildAiDataWarnings('NCAAF', { projections: 'unavailable' })
    expect(w[0].instruction).toMatch(/do not invent/i)
  })

  it('stale instruction tells Chimmy to caveat with "as of the last import"', () => {
    const w = buildAiDataWarnings('NFL', { adp: 'stale' })
    expect(w[0].instruction).toMatch(/as of the last import/i)
  })
})
