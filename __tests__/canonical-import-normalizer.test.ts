import { describe, expect, it } from 'vitest'

import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
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
      scoring: 'half ppr',
      isDynasty: false,
      league_type: 'redraft',
    },
    rosters: [],
    scoring: { scoring_format: 'half ppr', rules: [] },
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

describe('buildCanonicalImportBundle', () => {
  it('includes derivedFlags and importMetadata', () => {
    const b = buildCanonicalImportBundle(baseNormalized())
    expect(b.importMetadata.importSource).toBe('sleeper')
    expect(b.importMetadata.externalLeagueId).toBe('abc')
    expect(b.derivedFlags.dynasty).toBe(false)
    expect(b.settingsSnapshot.metadata?.importMetadata).toBeDefined()
  })

  it('surfaces fetchWarnings as persisted import warnings (Phase 2.4 §5)', () => {
    const b = buildCanonicalImportBundle(
      baseNormalized({
        fetchWarnings: ['matchups week 3: Sleeper returned 500 after 3 attempts — data may be incomplete.'],
      }),
    )
    const w = b.warnings.find((x) => x.code === 'source_fetch_incomplete')
    expect(w).toBeDefined()
    expect(w!.severity).toBe('warn')
    expect(w!.message).toContain('matchups week 3')
  })

  it('adds no fetch warning when the source fetched cleanly', () => {
    const b = buildCanonicalImportBundle(baseNormalized())
    expect(b.warnings.some((x) => x.code === 'source_fetch_incomplete')).toBe(false)
  })

  it('detects devy signal from taxi rosters', () => {
    const b = buildCanonicalImportBundle(
      baseNormalized({
        rosters: [
          {
            source_team_id: 't1',
            source_manager_id: 'm1',
            owner_name: 'A',
            team_name: 'Team A',
            avatar_url: null,
            wins: 0,
            losses: 0,
            ties: 0,
            points_for: 0,
            player_ids: [],
            starter_ids: [],
            taxi_ids: ['p1'],
          },
        ],
      }),
    )
    expect(b.derivedFlags.devy).toBe(true)
  })

  it('uses a custom Fantrax league\'s actual reception and IDP rules', () => {
    const league = { ...baseNormalized().league, scoring: 'custom', rosterSize: 38, roster_positions: [] }
    const b = buildCanonicalImportBundle(baseNormalized({
      source: { source_provider: 'fantrax', source_league_id: 'nfl-public', imported_at: new Date().toISOString() },
      league,
      scoring: {
        scoring_format: 'custom',
        rules: [
          { stat_key: 'rec', points_value: 1 },
          { stat_key: 'idp_tkl', points_value: 0.5 },
        ],
      },
    }))
    expect(b.scoringPresetId).toBe('fb_ppr')
    expect(b.derivedFlags.idp).toBe(true)
    expect(b.settingsSnapshot.scoringSettings?.rules).toMatchObject({ rec: 1, idp_tkl: 0.5 })
    expect(b.warnings.some((warning) => warning.code === 'scoring_preset_inferred')).toBe(false)
  })

  it('uses the NBA points preset and preserves a Fantrax league\'s actual stat weights', () => {
    const b = buildCanonicalImportBundle(baseNormalized({
      source: { source_provider: 'fantrax', source_league_id: 'nba-public', imported_at: new Date().toISOString() },
      league: { ...baseNormalized().league, sport: 'NBA', scoring: 'HEAD_TO_HEAD_POINTS_BASED', rosterSize: 14 },
      scoring: {
        scoring_format: 'HEAD_TO_HEAD_POINTS_BASED',
        rules: [
          { stat_key: 'pts', points_value: 1 },
          { stat_key: 'reb', points_value: 1.25 },
          { stat_key: 'ast', points_value: 1.5 },
        ],
      },
    }))
    expect(b.scoringPresetId).toBe('nba_points')
    expect(b.settingsSnapshot.scoringSettings?.rules).toMatchObject({ pts: 1, reb: 1.25, ast: 1.5 })
    expect(b.warnings.some((warning) => warning.code === 'scoring_preset_inferred')).toBe(false)
  })
})
