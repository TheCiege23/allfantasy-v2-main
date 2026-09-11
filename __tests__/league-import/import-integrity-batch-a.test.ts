/**
 * Batch A — import integrity regressions (AllFantasy import audit, 2026-09-09).
 *
 * Each case here reproduced a defect BEFORE the accompanying fix, per this repo's
 * "make every check reproduce a known positive before you trust its negative" rule.
 * A green run means the defect is repaired; these are not smoke tests.
 *
 *   IMP-08  Fleaflicker sparse-division fixture crashes the adapter
 *   IMP-03  Canonical scoring/roster normalization changes the league's meaning
 *   IMP-01  Scheduled refresh drops sport/season for bare provider league IDs
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FleaflickerAdapter } from '@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { buildProviderSourceRef } from '@/lib/league-import/sourceRef'
import { fetchNormalizedForConnection } from '@/lib/import-os/collector/normalizedLoader'
import {
  fetchFleaflickerLeagueForImport,
  FleaflickerImportLeagueNotFoundError,
  FleaflickerImportUnavailableError,
} from '@/lib/league-import/fleaflicker/FleaflickerLeagueFetchService'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function baseNormalized(overrides: Partial<NormalizedImportResult> = {}): NormalizedImportResult {
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: 'abc',
      imported_at: new Date().toISOString(),
    },
    league: {
      name: 'Test League',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      rosterSize: 16,
      scoring: 'ppr',
      isDynasty: false,
      league_type: 'redraft',
    },
    rosters: [],
    scoring: { scoring_format: 'ppr', rules: [] },
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: {
      leagueSettings: { state: 'full' },
      currentRosters: { state: 'full' },
      historicalRosterSnapshots: { state: 'missing' },
      scoringSettings: { state: 'full' },
      playoffSettings: { state: 'partial' },
      currentStandings: { state: 'full' },
      currentSchedule: { state: 'full' },
      draftHistory: { state: 'missing' },
      tradeHistory: { state: 'missing' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'full' },
    },
    ...overrides,
  }
}

describe('IMP-08 — Fleaflicker sparse divisions', () => {
  /*
   * The committed fixture has three divisions and only the FIRST carries `teams`.
   * `d.teams.map` threw on division 2. This is a real repository fixture, so the
   * crash was reachable from a real Fleaflicker league, not a guessed response.
   */
  it('normalizes the committed standings fixture without throwing', async () => {
    const fixtureDir = join(process.cwd(), 'contracts', 'fleaflicker', 'fixtures')
    const standings = JSON.parse(readFileSync(join(fixtureDir, 'standings.NFL.json'), 'utf8'))
    const rosters = JSON.parse(readFileSync(join(fixtureDir, 'rosters.NFL.json'), 'utf8'))

    const sparse = standings.divisions.filter((d: { teams?: unknown[] }) => !d.teams)
    expect(sparse.length).toBeGreaterThan(0) // positive control: the fixture IS sparse

    const result = await FleaflickerAdapter.normalize({
      sport: 'NFL',
      season: 2026,
      standings,
      rosters,
    } as never)

    expect(result.rosters.length).toBeGreaterThan(0)
    expect(result.source.source_provider).toBe('fleaflicker')
  })
})

describe('IMP-03 — canonical normalization must not change league meaning', () => {
  it('maps a plain "ppr" league to full PPR, not half', () => {
    const b = buildCanonicalImportBundle(baseNormalized())
    expect(b.settingsSnapshot.scoringSettings?.scoringTemplateId).toBe('fb_ppr')
  })

  it('still maps half-PPR and standard correctly', () => {
    const half = buildCanonicalImportBundle(
      baseNormalized({ scoring: { scoring_format: 'half ppr', rules: [] } }),
    )
    expect(half.settingsSnapshot.scoringSettings?.scoringTemplateId).toBe('fb_half_ppr')

    const std = buildCanonicalImportBundle(
      baseNormalized({ scoring: { scoring_format: 'standard non-ppr', rules: [] } }),
    )
    expect(std.settingsSnapshot.scoringSettings?.scoringTemplateId).toBe('fb_std')
  })

  it('treats DL as an NFL IDP STARTER, not a reserve slot', () => {
    /*
     * QB, DL, BN, BN, BN over a 5-slot roster is 2 starters and 3 bench.
     * Counting DL as reserve (Yahoo's "disabled list") inflated bench to 4.
     */
    const b = buildCanonicalImportBundle(
      baseNormalized({
        league: {
          ...baseNormalized().league,
          rosterSize: 5,
          roster_positions: ['QB', 'DL', 'BN', 'BN', 'BN'],
        } as never,
      }),
    )
    expect(b.settingsSnapshot.rosterSettings?.benchSlots).toBe(3)
  })

  it('still treats DL as a reserve slot for MLB, where it means disabled list', () => {
    const b = buildCanonicalImportBundle(
      baseNormalized({
        league: {
          ...baseNormalized().league,
          sport: 'MLB',
          rosterSize: 5,
          roster_positions: ['C', 'DL', 'BN', 'BN', 'BN'],
        } as never,
      }),
    )
    expect(b.settingsSnapshot.rosterSettings?.benchSlots).toBe(4)
  })

  it('does not collapse position-dependent scoring rules onto one value', () => {
    /*
     * MFL prices a reception differently by position. Keying on stat_key alone
     * meant the last rule won and every RB/WR reception silently took the TE value.
     */
    const b = buildCanonicalImportBundle(
      baseNormalized({
        scoring: {
          scoring_format: 'ppr',
          rules: [
            { stat_key: 'rec', points_value: 0.5, positions: ['RB'] },
            { stat_key: 'rec', points_value: 1.0, positions: ['WR'] },
            { stat_key: 'rec', points_value: 1.5, positions: ['TE'] },
          ],
        } as never,
      }),
    )

    const rules = b.settingsSnapshot.scoringSettings?.rules as Record<string, unknown>
    expect(rules['rec@RB']).toBe(0.5)
    expect(rules['rec@WR']).toBe(1.0)
    expect(rules['rec@TE']).toBe(1.5)
  })

  it('keeps an unqualified rule on its bare stat key', () => {
    const b = buildCanonicalImportBundle(
      baseNormalized({
        scoring: {
          scoring_format: 'ppr',
          rules: [{ stat_key: 'pass_td', points_value: 6 }],
        } as never,
      }),
    )
    const rules = b.settingsSnapshot.scoringSettings?.rules as Record<string, unknown>
    expect(rules['pass_td']).toBe(6)
  })
})

describe('IMP-01 — a refresh must not lose sport/season scope', () => {
  it('re-encodes sport and season for a Fleaflicker bare id', () => {
    expect(
      buildProviderSourceRef({ provider: 'fleaflicker', externalLeagueId: '206154', sport: 'NBA', season: 2024 }),
    ).toBe('NBA:206154:2024')
  })

  it('re-encodes season for ESPN and MFL bare ids', () => {
    expect(
      buildProviderSourceRef({ provider: 'espn', externalLeagueId: '12345', sport: 'NFL', season: 2023 }),
    ).toBe('12345:2023')
    expect(
      buildProviderSourceRef({ provider: 'mfl', externalLeagueId: '54321', sport: 'NFL', season: 2022 }),
    ).toBe('54321:2022')
  })

  it('leaves an already-scoped id alone rather than double-encoding it', () => {
    expect(
      buildProviderSourceRef({ provider: 'fleaflicker', externalLeagueId: 'NBA:206154:2024', sport: 'NBA', season: 2024 }),
    ).toBe('NBA:206154:2024')
    expect(
      buildProviderSourceRef({ provider: 'espn', externalLeagueId: '12345:2023', sport: 'NFL', season: 2023 }),
    ).toBe('12345:2023')
  })

  it('leaves providers whose ids already carry scope untouched', () => {
    /* A Sleeper league id is globally unique and season-scoped by the provider. */
    expect(
      buildProviderSourceRef({ provider: 'sleeper', externalLeagueId: '99887766', sport: 'NFL', season: 2024 }),
    ).toBe('99887766')
    /* A Yahoo league KEY already encodes game (sport+season). */
    expect(
      buildProviderSourceRef({ provider: 'yahoo', externalLeagueId: '423.l.12345', sport: 'NFL', season: 2024 }),
    ).toBe('423.l.12345')
  })

  it('returns the bare id unchanged when there is no season to restore', () => {
    expect(
      buildProviderSourceRef({ provider: 'espn', externalLeagueId: '12345', sport: 'NFL', season: null }),
    ).toBe('12345')
  })
})

describe('IMP-01 — fetchNormalizedForConnection preserves scope end to end', () => {
  const nbaConnection = {
    runKey: 'fleaflicker:206154:2024',
    provider: 'fleaflicker' as const,
    externalLeagueId: '206154',
    season: 2024,
    sport: 'NBA',
  }

  function normalizedFor(sport: string, season: number): NormalizedImportResult {
    return baseNormalized({
      source: {
        source_provider: 'fleaflicker',
        source_league_id: '206154',
        imported_at: new Date().toISOString(),
      },
      league: { ...baseNormalized().league, sport, season },
    })
  }

  it('sends the provider a sport- and season-scoped id, not the bare one', async () => {
    const seen: Array<Record<string, unknown>> = []
    await fetchNormalizedForConnection(nbaConnection as never, {
      runPipeline: (async (input: Record<string, unknown>) => {
        seen.push(input)
        return { success: true, normalized: normalizedFor('NBA', 2024) }
      }) as never,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.sourceId).toBe('NBA:206154:2024')
  })

  it('refuses to return a payload whose scope is not what was requested', async () => {
    /*
     * The dangerous case: the wrong scope EXISTS at the provider, so the fetch succeeds
     * and the writer would apply another league's data over a good record.
     */
    await expect(
      fetchNormalizedForConnection(nbaConnection as never, {
        runPipeline: (async () => ({
          success: true,
          normalized: normalizedFor('NFL', 2026),
        })) as never,
      }),
    ).rejects.toThrow(/did not confirm the requested league scope/i)
  })

  it('accepts a matching scope', async () => {
    const out = await fetchNormalizedForConnection(nbaConnection as never, {
      runPipeline: (async () => ({
        success: true,
        normalized: normalizedFor('NBA', 2024),
      })) as never,
    })
    expect(out.league.sport).toBe('NBA')
    expect(out.league.season).toBe(2024)
  })
})

describe('IMP-08 — Fleaflicker error classification', () => {
  /*
   * A throttle or 5xx used to be raised as `FleaflickerImportLeagueNotFoundError`, which
   * the pipeline maps to LEAGUE_NOT_FOUND — and the collector reads that as "the league
   * is gone: skip it", not "retry". A transient outage retired a live league.
   */
  it('classifies a 429 and a 503 as unavailable, not as a missing league', async () => {
    const statuses = [429, 503]
    for (const status of statuses) {
      const original = globalThis.fetch
      globalThis.fetch = (async () => new Response('', { status })) as never
      try {
        await expect(fetchFleaflickerLeagueForImport('206154')).rejects.toBeInstanceOf(
          FleaflickerImportUnavailableError,
        )
      } finally {
        globalThis.fetch = original
      }
    }
  })

  it('still classifies a 404 as a missing league', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 404 })) as never
    try {
      await expect(fetchFleaflickerLeagueForImport('206154')).rejects.toBeInstanceOf(
        FleaflickerImportLeagueNotFoundError,
      )
    } finally {
      globalThis.fetch = original
    }
  })
})
