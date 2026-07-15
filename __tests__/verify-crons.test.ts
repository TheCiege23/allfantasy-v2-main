import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { verifyCrons, checkCronPaths, cronPathToRouteFile } from '../scripts/verify-crons'

/**
 * AF_LIVE_DATA_CRON_BUILD §1 + §7 — guards that every vercel.json cron resolves to a real
 * handler (no 404s), catches a deliberately-broken entry, and catches a re-introduced
 * duplicate (the historical /api/zombie/automation x2). Runs the checker against the real repo.
 */
const REPO_ROOT = resolve(__dirname, '..')

describe('verify-crons', () => {
  it('every vercel.json cron path resolves to a real handler — no dangling, no duplicates', () => {
    const result = verifyCrons(REPO_ROOT)
    expect(result.dangling, `dangling: ${JSON.stringify(result.dangling)}`).toEqual([])
    expect(result.duplicatePaths, `duplicates: ${JSON.stringify(result.duplicatePaths)}`).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.uniqueHandlers).toBeGreaterThan(0)
  })

  it('the new import-projections cron resolves to its handler', () => {
    const result = checkCronPaths([{ path: '/api/cron/import-projections' }], REPO_ROOT)
    expect(result.ok).toBe(true)
    expect(result.resolved[0]?.file).toBe('app/api/cron/import-projections/route.ts')
  })

  it('DETECTS a deliberately-broken entry (would 404 when Vercel fires it)', () => {
    const result = checkCronPaths(
      [
        { path: '/api/cron/import-scores' }, // real
        { path: '/api/cron/this-handler-does-not-exist' }, // broken
      ],
      REPO_ROOT,
    )
    expect(result.ok).toBe(false)
    expect(result.dangling.map((d) => d.path)).toEqual(['/api/cron/this-handler-does-not-exist'])
  })

  it('DETECTS a duplicate path (same path twice, nothing to distinguish — the zombie bug)', () => {
    const result = checkCronPaths(
      [
        { path: '/api/zombie/automation', schedule: '0 * * * *' },
        { path: '/api/zombie/automation', schedule: '0 9 * * 2' },
      ],
      REPO_ROOT,
    )
    expect(result.ok).toBe(false)
    expect(result.duplicatePaths).toEqual([{ path: '/api/zombie/automation', count: 2 }])
  })

  it('does NOT flag same-handler entries distinguished by query string (world-cup ?job=)', () => {
    const result = checkCronPaths(
      [
        { path: '/api/brackets/world-cup/cron/sync?job=teams&provider=apifootball' },
        { path: '/api/brackets/world-cup/cron/sync?job=fixtures&provider=apifootball' },
      ],
      REPO_ROOT,
    )
    expect(result.ok).toBe(true)
    expect(result.duplicatePaths).toEqual([])
    expect(result.uniqueHandlers).toBe(1) // both map to a single route file
  })

  it('maps a cron path to its App-Router handler file (query stripped)', () => {
    expect(cronPathToRouteFile('/api/cron/import-scores')).toBe('app/api/cron/import-scores/route.ts')
    expect(cronPathToRouteFile('/api/brackets/world-cup/cron/sync?job=live&x=1')).toBe(
      'app/api/brackets/world-cup/cron/sync/route.ts',
    )
  })
})
