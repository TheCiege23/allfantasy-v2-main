/**
 * Tier 0 (Block C) — integration test proving the persisted League row payload
 * matches the Sleeper source of truth.
 *
 * This test doesn't hit the database. Instead it locks in the deterministic
 * transformation:
 *   raw Sleeper payload
 *     → SleeperLeagueMapper
 *     → NormalizedLeagueSettings
 *     → buildTier0LeagueColumnPatch
 *     → the exact object spread into `prisma.league.create({ data })`
 *
 * That last object is what the runtime writes to the DB (via the existing
 * `persistImportedLeagueFromNormalization` path — see
 * `lib/league-import/ImportedLeagueCommitService.ts`). Asserting its contents
 * proves the persisted row matches Sleeper without needing a Prisma mock or
 * a live DB round-trip.
 */
import { describe, expect, it } from 'vitest'

import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import { buildTier0LeagueColumnPatch } from '@/lib/league-import/ImportedLeagueCommitService'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import type { NormalizedImportResult } from '@/lib/league-import/types'

const AUDIT_LEAGUE_PAYLOAD: SleeperImportPayload = {
  league: {
    league_id: '1313584523757260800',
    name: 'Not 4 the Weak!',
    sport: 'nfl',
    season: '2026',
    total_rosters: 12,
    metadata: { co_commissioners: null },
    roster_positions: [
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX',
      'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
    ],
    scoring_settings: { rec: 1, bonus_rec_te: 0.75, pass_td: 6, rush_td: 6 },
    settings: {
      waiver_type: 2,
      waiver_budget: 200,
      waiver_bid_min: 1,
      playoff_week_start: 15,
      playoff_teams: 6,
      trade_deadline: 13,
      trade_review_days: 0,
      pick_trading: 1,
      reserve_slots: 6,
      taxi_slots: 6,
      taxi_years: 1,
      taxi_allow_vets: 1,
      taxi_deadline: 4,
      max_keepers: 1,
      reserve_allow_cov: 1,
      reserve_allow_sus: 1,
      reserve_allow_out: 1,
      reserve_allow_na: 0,
      reserve_allow_dnr: 0,
      reserve_allow_doubtful: 0,
      type: 2,
      num_teams: 12,
    } as unknown as SleeperImportPayload['league']['settings'],
  },
}

function normalizedFromPayload(payload: SleeperImportPayload): NormalizedImportResult {
  const league = SleeperLeagueMapper.map(payload)!
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: payload.league.league_id,
      imported_at: new Date().toISOString(),
    },
    league,
    rosters: [],
    scoring: null,
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

describe('Tier 0 end-to-end — persisted League row payload matches Sleeper', () => {
  const normalized = normalizedFromPayload(AUDIT_LEAGUE_PAYLOAD)
  const patch = buildTier0LeagueColumnPatch(normalized)

  it('waiverType: Sleeper 2 → "faab" (fidelity audit: was "rolling")', () => {
    expect(patch.waiverType).toBe('faab')
  })

  it('waiverBudget: 200 (fidelity audit: was 100)', () => {
    expect(patch.waiverBudget).toBe(200)
  })

  it('waiverMinBid: 1 (fidelity audit: was 0)', () => {
    expect(patch.waiverMinBid).toBe(1)
  })

  it('tradeDeadlineWeek: 13 (fidelity audit: was null)', () => {
    expect(patch.tradeDeadlineWeek).toBe(13)
  })

  it('tradeReviewHours: 0 hours (Sleeper trade_review_days: 0) — fidelity audit: was 48', () => {
    expect(patch.tradeReviewHours).toBe(0)
  })

  it('draftPickTrading: true (fidelity audit: was false)', () => {
    expect(patch.draftPickTrading).toBe(true)
  })

  it('playoffStartWeek: 15 (fidelity audit: was 14)', () => {
    expect(patch.playoffStartWeek).toBe(15)
  })

  it('playoffTeams: 6 (fidelity audit: was 4)', () => {
    expect(patch.playoffTeams).toBe(6)
  })

  it('irSlots: 6 (fidelity audit: was 0)', () => {
    expect(patch.irSlots).toBe(6)
  })

  it('taxiSlots: 6 (fidelity audit: was 0)', () => {
    expect(patch.taxiSlots).toBe(6)
  })

  it('taxiAllowNonRookies: true (fidelity audit: was false)', () => {
    expect(patch.taxiAllowNonRookies).toBe(true)
  })

  it('taxiYearsLimit: 1 (fidelity audit: was 2)', () => {
    expect(patch.taxiYearsLimit).toBe(1)
  })

  it('taxiDeadlineWeek: 4 (fidelity audit: was 0)', () => {
    expect(patch.taxiDeadlineWeek).toBe(4)
  })

  it('keeperCount: 1 (fidelity audit: was 3)', () => {
    expect(patch.keeperCount).toBe(1)
  })

  it('irAllowCovid: true (fidelity audit: was false)', () => {
    expect(patch.irAllowCovid).toBe(true)
  })

  it('irAllowSuspended: true (fidelity audit: was false)', () => {
    expect(patch.irAllowSuspended).toBe(true)
  })

  it('irAllowOut: true', () => {
    expect(patch.irAllowOut).toBe(true)
  })

  it('irAllowNA: false', () => {
    expect(patch.irAllowNA).toBe(false)
  })

  it('irAllowDNR: false', () => {
    expect(patch.irAllowDNR).toBe(false)
  })

  it('irAllowDoubtful: false', () => {
    expect(patch.irAllowDoubtful).toBe(false)
  })

  it('produces NO keys for absent fields (preserves defaults for legacy providers)', () => {
    const bareNormalized = normalizedFromPayload({
      league: {
        league_id: '99',
        name: 'x',
        sport: 'nfl',
        season: '2024',
        total_rosters: 10,
        roster_positions: [],
      } as SleeperImportPayload['league'],
    })
    const barePatch = buildTier0LeagueColumnPatch(bareNormalized)
    // Only fields the mapper actually populated should be present.
    expect(barePatch.waiverType).toBeUndefined()
    expect(barePatch.waiverBudget).toBeUndefined()
    expect(barePatch.playoffTeams).toBeUndefined()
    expect(barePatch.taxiSlots).toBeUndefined()
    expect(barePatch.draftPickTrading).toBeUndefined()
  })
})
