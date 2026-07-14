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

// Phase 38: real, code-verified provider-shape bug. Sleeper's roster_positions is a flat
// array (one entry per slot: 'QB','RB','BN','BN',...). ESPN/Yahoo/MFL's adapters instead
// build AGGREGATED "SLOT:count" strings (confirmed via direct code read:
// lib/league-import/adapters/{espn,yahoo,mfl}/*.ts — e.g. 'BE:6', 'IR:2'). The Tier 0 bench
// computation above exact-matches literal 'BN'/'IR'/'TAXI', which can never match a
// "SLOT:count" string — so benchSlots was silently wrong for every ESPN/Yahoo/MFL import.
// No real ESPN/Yahoo/MFL leagues exist in .env.test to validate against (0 real leagues for
// any provider except Sleeper, confirmed via direct query this phase) — these fixtures use
// the exact real aggregated-string shape and exact real reserve-slot labels each adapter is
// confirmed (by direct code read) to emit, not fabricated data.
describe('canonicalImportNormalizer — provider-specific roster_positions shapes (Phase 38)', () => {
  it('ESPN-shaped "SLOT:count" roster_positions: benchSlots correctly excludes BE/IR, not just counts all entries as starters', () => {
    // Real ESPN slot labels (EspnLeagueFetchService.ts's ESPN_SLOT_LABELS): BE=20, IR=21.
    const bundle = buildCanonicalImportBundle(
      baseNormalized({
        rosterSize: 18,
        roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:2', 'D/ST:1', 'K:1', 'BE:7', 'IR:1'],
      }),
    )
    // Real starters: 1+2+2+1+2+1+1 = 10. Bench = 18 - 10 = 8 (BE:7 + IR:1).
    expect(bundle.settingsSnapshot.rosterSettings?.benchSlots).toBe(8)
  })

  it('Yahoo-shaped "SLOT:count" roster_positions: recognizes Yahoo\'s real reserve label set (BN/BE/IR/IL/NA/DL)', () => {
    // Real Yahoo reserve labels (YahooLeagueFetchService.ts's YAHOO_RESERVE_POSITIONS).
    const bundle = buildCanonicalImportBundle(
      baseNormalized({
        rosterSize: 16,
        roster_positions: ['QB:1', 'RB:2', 'WR:3', 'TE:1', 'W/R/T:1', 'DEF:1', 'K:1', 'BN:5', 'IR:1'],
      }),
    )
    // Real starters: 1+2+3+1+1+1+1 = 10. Bench = 16 - 10 = 6 (BN:5 + IR:1).
    // (7 slot-TYPE entries summing to 10 starters, deliberately != the 9-entry array length,
    // so this case genuinely discriminates the "count array entries" bug from "sum counts".)
    expect(bundle.settingsSnapshot.rosterSettings?.benchSlots).toBe(6)
  })

  it('MFL-shaped "SLOT:count" roster_positions with an appended TAXI entry', () => {
    const bundle = buildCanonicalImportBundle(
      baseNormalized({
        rosterSize: 20,
        roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:1', 'PK:1', 'DEF:1', 'TAXI:4'],
      }),
    )
    // Real starters: 1+2+2+1+1+1+1 = 9. Bench = 20 - 9 = 11 (implicit MFL bench, not itemized,
    // plus the explicit TAXI:4 — the fix must not let TAXI count as a starter slot).
    expect(bundle.settingsSnapshot.rosterSettings?.benchSlots).toBe(11)
  })

  it('Sleeper\'s flat-array shape (unaffected by the provider-shape fix, regression check)', () => {
    const bundle = buildCanonicalImportBundle(baseNormalized())
    expect(bundle.settingsSnapshot.rosterSettings?.benchSlots).toBe(14)
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
