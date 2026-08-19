/**
 * Tier 0 — canonical normalizer regression tests for Block B fixes:
 *   - taxi_slots no longer hardcoded to 4 (uses imported value)
 *   - reserve_slots surfaced as `rosterSettings.irSlots`
 *   - benchSlots derives from actual starter-slot count, not rosterSize - 9
 *   - waiverSettings + playoffSettings + commissionerSettings propagate imported values
 */
import { describe, expect, it } from 'vitest'

import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function baseNormalized(overrides: Partial<NormalizedImportResult['league']> = {}): NormalizedImportResult {
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: '1313584523757260800',
      imported_at: new Date().toISOString(),
    },
    league: {
      name: 'Not 4 the Weak!',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      rosterSize: 24,
      scoring: 'PPR Superflex TEP',
      isDynasty: true,
      // Mapper output — Tier 0 fields the mapper now provides:
      waiver_type: 'faab',
      faab_budget: 200,
      waiver_bid_min: 1,
      playoff_start_week: 15,
      playoff_teams: 6,
      playoff_team_count: 6,
      trade_deadline_week: 13,
      trade_review_days: 0,
      pick_trading: true,
      reserve_slots: 6,
      taxi_slots: 6,
      taxi_years: 1,
      taxi_allow_vets: true,
      taxi_deadline_week: 4,
      max_keepers: 1,
      reserve_allow_cov: true,
      reserve_allow_sus: true,
      roster_positions: [
        'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX',
        'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
      ],
      ...overrides,
    } as NormalizedImportResult['league'],
    rosters: [],
    scoring: { scoring_format: 'ppr_superflex_tep', rules: [] },
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
      playoffSettings: { state: 'full' },
      currentStandings: { state: 'missing' },
      currentSchedule: { state: 'missing' },
      draftHistory: { state: 'missing' },
      tradeHistory: { state: 'missing' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'missing' },
    },
  }
}

describe('canonicalImportNormalizer — Tier 0 Block B fixes', () => {
  const bundle = buildCanonicalImportBundle(baseNormalized())

  it('respects imported taxi_slots (6), does NOT hardcode 4', () => {
    expect(bundle.settingsSnapshot.rosterSettings?.taxiSlots).toBe(6)
  })

  it('surfaces imported reserve_slots as rosterSettings.irSlots', () => {
    expect(bundle.settingsSnapshot.rosterSettings?.irSlots).toBe(6)
  })

  it('bench = rosterSize - non-bench slots (24 - 10 = 14), not the old hardcoded 24 - 9 = 15', () => {
    expect(bundle.settingsSnapshot.rosterSettings?.benchSlots).toBe(14)
  })

  it('propagates waiverType from mapper (not defaulting to rolling)', () => {
    expect(bundle.settingsSnapshot.waiverSettings?.waiverType).toBe('faab')
  })

  it('propagates faabBudget from mapper', () => {
    expect(bundle.settingsSnapshot.waiverSettings?.faabBudget).toBe(200)
  })

  it('propagates playoffTeams (6) and playoffStartWeek (15) from mapper', () => {
    expect(bundle.settingsSnapshot.playoffSettings?.playoffTeams).toBe(6)
    expect(bundle.settingsSnapshot.playoffSettings?.playoffStartWeek).toBe(15)
  })

  it('surfaces tradeDeadlineWeek in commissionerSettings', () => {
    expect(bundle.settingsSnapshot.commissionerSettings?.tradeDeadlineWeek).toBe(13)
  })
})

describe('canonicalImportNormalizer — backward compatibility', () => {
  it('legacy mapper output (no Tier 0 fields) still yields a valid bundle without throwing', () => {
    const bundle = buildCanonicalImportBundle(
      baseNormalized({
        waiver_type: undefined,
        faab_budget: undefined,
        waiver_bid_min: undefined,
        playoff_start_week: undefined,
        playoff_teams: undefined,
        trade_deadline_week: undefined,
        pick_trading: undefined,
        reserve_slots: undefined,
        taxi_slots: undefined,
      } as unknown as Partial<NormalizedImportResult['league']>),
    )
    // Defaults kick in as before (rolling, playoffTeams from format resolver, etc.)
    expect(bundle.settingsSnapshot.waiverSettings?.waiverType).toBe('rolling')
    expect(bundle.settingsSnapshot.rosterSettings?.irSlots).toBeUndefined()
    // playoffTeams falls back to the format-resolver default (6 for redraft)
    expect(typeof bundle.settingsSnapshot.playoffSettings?.playoffTeams).toBe('number')
  })
})
