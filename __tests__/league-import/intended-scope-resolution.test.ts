/**
 * Batch A.1 item 3 — the intended scope is RESOLVED from a priority chain, and an
 * unresolvable required dimension is a rejection.
 *
 *     explicit request  >  stored connection  >  previously verified league identity
 */

import { describe, expect, it, vi } from 'vitest'

import { fetchNormalizedForConnection } from '@/lib/import-os/collector/normalizedLoader'
import {
  findScopeMismatches,
  isDurableSyncError,
  resolveIntendedScope,
} from '@/lib/league-import/sourceRef'
import type { NormalizedImportResult } from '@/lib/league-import/types'

const NOW = new Date('2026-09-09T12:00:00.000Z')

function payload(sport: string | null, season: number | null): NormalizedImportResult {
  return {
    source: { source_league_id: '123' },
    league: { sport, season },
  } as unknown as NormalizedImportResult
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    runKey: 'espn:123:2026',
    provider: 'espn' as const,
    externalLeagueId: '123',
    season: 2026,
    sport: 'NFL',
    ...overrides,
  }
}

describe('resolveIntendedScope priority chain', () => {
  it('prefers an explicit request over the stored connection', () => {
    const r = resolveIntendedScope({
      request: { sport: 'NBA', season: 2024 },
      connection: { sport: 'NFL', season: 2026 },
    })
    expect(r).toMatchObject({ sport: 'NBA', season: 2024 })
    expect(r.origin).toEqual({ sport: 'request', season: 'request' })
  })

  it('falls back to the connection, then to a verified identity', () => {
    expect(
      resolveIntendedScope({ connection: { sport: 'NFL', season: 2026 } }),
    ).toMatchObject({ sport: 'NFL', season: 2026, origin: { sport: 'connection', season: 'connection' } })

    expect(
      resolveIntendedScope({ verifiedIdentity: { sport: 'NHL', season: 2023 } }),
    ).toMatchObject({ sport: 'NHL', season: 2023, origin: { sport: 'verified_identity', season: 'verified_identity' } })
  })

  it('resolves each dimension INDEPENDENTLY', () => {
    /*
     * A job that pins the season but not the sport must still inherit the sport, rather than
     * falling wholesale to a lower tier and discarding the caller's explicit season.
     */
    const r = resolveIntendedScope({
      request: { season: 2024 },
      connection: { sport: 'NBA', season: 2026 },
    })
    expect(r.season).toBe(2024)
    expect(r.sport).toBe('NBA')
    expect(r.origin).toEqual({ sport: 'connection', season: 'request' })
  })

  it('reports unknown when no tier supplies a dimension', () => {
    const r = resolveIntendedScope({ connection: { sport: null, season: null } })
    expect(r).toMatchObject({ sport: null, season: null })
    expect(r.origin).toEqual({ sport: 'unknown', season: 'unknown' })
  })

  it('ignores an out-of-range season rather than adopting it', () => {
    const r = resolveIntendedScope({ request: { season: 1899 }, connection: { season: 2026 } })
    expect(r.season).toBe(2026)
  })
})

describe('the rejection matrix', () => {
  it('rejects a WRONG SEASON', () => {
    expect(
      findScopeMismatches({
        provider: 'espn',
        requested: { sport: 'NFL', season: 2023 },
        returned: { sport: 'NFL', season: 2026 },
      }),
    ).toEqual([{ field: 'season', kind: 'mismatch', requested: '2023', returned: '2026' }])
  })

  it('rejects a WRONG SPORT', () => {
    expect(
      findScopeMismatches({
        provider: 'fleaflicker',
        requested: { sport: 'NBA', season: 2024 },
        returned: { sport: 'NFL', season: 2024 },
      }),
    ).toEqual([{ field: 'sport', kind: 'mismatch', requested: 'NBA', returned: 'NFL' }])
  })

  it('rejects a MISSING TARGET season', () => {
    const problems = findScopeMismatches({
      provider: 'mfl',
      requested: { sport: 'NFL', season: null },
      returned: { sport: 'NFL', season: 2026 },
    })
    expect(problems).toEqual([
      { field: 'season', kind: 'missing_target', requested: null, returned: '2026' },
    ])
  })

  it('rejects a MISSING SOURCE season', () => {
    const problems = findScopeMismatches({
      provider: 'mfl',
      requested: { sport: 'NFL', season: 2024 },
      returned: { sport: 'NFL', season: null },
    })
    expect(problems).toEqual([
      { field: 'season', kind: 'missing_required', requested: '2024', returned: null },
    ])
  })

  it('rejects for the fail-closed DEFAULT provider too', () => {
    const problems = findScopeMismatches({
      provider: 'a-provider-nobody-has-reasoned-about',
      requested: { sport: 'NFL', season: null },
      returned: { sport: 'NFL', season: 2026 },
    })
    expect(problems.map((p) => p.kind)).toEqual(['missing_target'])
  })
})

describe('end to end through the loader', () => {
  it('a bare id no longer defaults to the current year — the season is re-encoded', async () => {
    const runPipeline = vi.fn(async () => ({
      success: true as const,
      normalized: payload('NFL', 2023),
    }))
    await fetchNormalizedForConnection(
      connection({ season: 2023, runKey: 'espn:123:2023' }) as never,
      { runPipeline: runPipeline as never, resolveCandidates: async () => ['u1'], now: NOW },
    )
    expect(runPipeline.mock.calls[0]?.[0]).toMatchObject({ sourceId: '123:2023' })
  })

  it('an explicit request scope overrides a stale connection row', async () => {
    const runPipeline = vi.fn(async () => ({
      success: true as const,
      normalized: payload('NFL', 2022),
    }))
    await fetchNormalizedForConnection(connection() as never, {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => ['u1'],
      now: NOW,
      requestedScope: { sport: 'NFL', season: 2022 },
    })
    /* Resolution used the request, so the 2022 payload is accepted rather than rejected. */
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })

  it('preserves last-good by THROWING rather than returning a wrong-scope payload', async () => {
    await expect(
      fetchNormalizedForConnection(connection() as never, {
        runPipeline: (async () => ({ success: true as const, normalized: payload('NFL', 2019) })) as never,
        resolveCandidates: async () => ['u1'],
        now: NOW,
      }),
    ).rejects.toThrow(/did not confirm the requested league scope/i)
  })

  it('rejects when NO tier supplies a required dimension', async () => {
    await expect(
      fetchNormalizedForConnection(
        connection({ season: null, sport: null }) as never,
        {
          runPipeline: (async () => ({ success: true as const, normalized: payload('NFL', 2026) })) as never,
          resolveCandidates: async () => ['u1'],
          now: NOW,
        },
      ),
    ).rejects.toThrow(/cannot be verified/i)
  })

  it('causes NO retry storm — the error is durable and the pipeline ran once', async () => {
    /*
     * A scope disagreement is just as true on the third attempt as the first. `durable` is what
     * `runner.ts` reads to break out of its retry loop instead of paying for the same answer.
     */
    const runPipeline = vi.fn(async () => ({
      success: true as const,
      normalized: payload('NFL', 2019),
    }))
    const err = await fetchNormalizedForConnection(connection() as never, {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => ['u1'],
      now: NOW,
    }).catch((e: unknown) => e)

    expect(isDurableSyncError(err)).toBe(true)
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })

  it('emits a sanitized error carrying scope and nothing else', async () => {
    const err = (await fetchNormalizedForConnection(connection() as never, {
      runPipeline: (async () => ({ success: true as const, normalized: payload('NFL', 2019) })) as never,
      resolveCandidates: async () => ['u1'],
      now: NOW,
    }).catch((e: unknown) => e)) as Error

    expect(err.message).toContain('2026')
    expect(err.message).toContain('2019')
    expect(err.message).not.toMatch(/token|cookie|secret|password|swid|espn_s2|@/i)
    /* Not even the league id — the runKey on the sync-state row identifies the league. */
    expect(err.message).not.toContain('123')
  })
})
