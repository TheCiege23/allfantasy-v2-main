/**
 * Tier 0 — SleeperLeagueMapper unit tests.
 *
 * Fixture is a minimal but real Sleeper `/v1/league/{id}` response for league
 * `1313584523757260800` ("Not 4 the Weak!"), captured during the runtime audit.
 * Every asserted value is the SLEEPER SOURCE OF TRUTH — the same numbers that
 * were audit-verified as previously being overwritten with Prisma defaults.
 */
import { describe, expect, it } from 'vitest'

import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

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
    scoring_settings: {
      rec: 1,
      bonus_rec_te: 0.75,
      pass_td: 6,
      rush_td: 6,
    },
    settings: {
      // Fields the audit verified as previously dropped:
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
      type: 2, // dynasty
      num_teams: 12,
    } as unknown as SleeperImportPayload['league']['settings'],
  },
}

describe('SleeperLeagueMapper — Tier 0 field extraction', () => {
  const result = SleeperLeagueMapper.map(AUDIT_LEAGUE_PAYLOAD)

  it('produces a non-null result', () => {
    expect(result).not.toBeNull()
  })

  it('preserves waiver_type as AF vocabulary (Sleeper 2 → faab)', () => {
    expect(result?.waiver_type).toBe('faab')
  })

  it('preserves waiver_budget (Sleeper 200)', () => {
    expect(result?.faab_budget).toBe(200)
  })

  it('preserves waiver_bid_min (Sleeper 1)', () => {
    expect(result?.waiver_bid_min).toBe(1)
  })

  it('preserves playoff_start_week (Sleeper 15)', () => {
    expect(result?.playoff_start_week).toBe(15)
  })

  it('preserves playoff_teams (Sleeper 6)', () => {
    expect(result?.playoff_teams).toBe(6)
    expect(result?.playoff_team_count).toBe(6)
  })

  it('preserves trade_deadline as trade_deadline_week (Sleeper 13)', () => {
    expect(result?.trade_deadline_week).toBe(13)
  })

  it('preserves trade_review_days (Sleeper 0 = commissioner-approve-only)', () => {
    expect(result?.trade_review_days).toBe(0)
  })

  it('preserves pick_trading as boolean (Sleeper 1 → true)', () => {
    expect(result?.pick_trading).toBe(true)
  })

  it('preserves reserve_slots (Sleeper 6 → irSlots eventually)', () => {
    expect(result?.reserve_slots).toBe(6)
  })

  it('preserves taxi_slots (Sleeper 6)', () => {
    expect(result?.taxi_slots).toBe(6)
  })

  it('preserves taxi_years (Sleeper 1)', () => {
    expect(result?.taxi_years).toBe(1)
  })

  it('preserves taxi_allow_vets as boolean (Sleeper 1 → true)', () => {
    expect(result?.taxi_allow_vets).toBe(true)
  })

  it('preserves taxi_deadline as taxi_deadline_week (Sleeper 4)', () => {
    expect(result?.taxi_deadline_week).toBe(4)
  })

  it('preserves max_keepers (Sleeper 1)', () => {
    expect(result?.max_keepers).toBe(1)
  })

  it('preserves reserve_allow_cov as boolean (Sleeper 1 → true)', () => {
    expect(result?.reserve_allow_cov).toBe(true)
  })

  it('preserves reserve_allow_sus as boolean (Sleeper 1 → true)', () => {
    expect(result?.reserve_allow_sus).toBe(true)
  })

  it('preserves reserve_allow_out as boolean (Sleeper 1 → true)', () => {
    expect(result?.reserve_allow_out).toBe(true)
  })

  it('preserves reserve_allow_na as boolean (Sleeper 0 → false)', () => {
    expect(result?.reserve_allow_na).toBe(false)
  })

  it('preserves reserve_allow_dnr as boolean (Sleeper 0 → false)', () => {
    expect(result?.reserve_allow_dnr).toBe(false)
  })

  it('preserves reserve_allow_doubtful as boolean (Sleeper 0 → false)', () => {
    expect(result?.reserve_allow_doubtful).toBe(false)
  })

  it('derives regular_season_length from playoff_start_week (15 → 14), NOT hardcoded 14', () => {
    // The old hardcode `regular_season_length: 14` was coincidentally correct for
    // this specific league but wrong in general. Prove the derivation actually
    // uses playoff_start_week by mutating the payload.
    expect(result?.regular_season_length).toBe(14)

    const shifted = SleeperLeagueMapper.map({
      ...AUDIT_LEAGUE_PAYLOAD,
      league: {
        ...AUDIT_LEAGUE_PAYLOAD.league,
        settings: {
          ...AUDIT_LEAGUE_PAYLOAD.league.settings,
          playoff_week_start: 17, // playoffs start week 17 → regular season = 16
        } as unknown as SleeperImportPayload['league']['settings'],
      },
    })
    expect(shifted?.regular_season_length).toBe(16)
  })

  it('preserves scoring settings (bonus_rec_te 0.75 TEP)', () => {
    expect((result?.scoring_settings as Record<string, number>)?.bonus_rec_te).toBe(0.75)
  })

  it('preserves roster_positions array verbatim', () => {
    const rp = (result?.roster_positions as string[]) ?? []
    expect(rp).toHaveLength(24)
    expect(rp[9]).toBe('SUPER_FLEX')
    expect(rp[10]).toBe('BN')
  })

  it('scoring string derives PPR + Superflex + TEP', () => {
    expect(result?.scoring).toBe('PPR Superflex TEP')
  })

  it('isDynasty = true when settings.type = 2', () => {
    expect(result?.isDynasty).toBe(true)
  })
})

describe('SleeperLeagueMapper — waiver_type enum coercion', () => {
  const withWaiverType = (n: number) =>
    SleeperLeagueMapper.map({
      ...AUDIT_LEAGUE_PAYLOAD,
      league: {
        ...AUDIT_LEAGUE_PAYLOAD.league,
        settings: {
          ...AUDIT_LEAGUE_PAYLOAD.league.settings,
          waiver_type: n,
        } as unknown as SleeperImportPayload['league']['settings'],
      },
    })

  it('Sleeper 2 → faab', () => {
    expect(withWaiverType(2)?.waiver_type).toBe('faab')
  })

  it('Sleeper 1 → rolling', () => {
    expect(withWaiverType(1)?.waiver_type).toBe('rolling')
  })

  it('Sleeper 0 → off', () => {
    expect(withWaiverType(0)?.waiver_type).toBe('off')
  })
})

describe('SleeperLeagueMapper — backward compatibility', () => {
  it('emits undefined for absent Tier 0 fields (does NOT hallucinate defaults)', () => {
    const bare = SleeperLeagueMapper.map({
      league: {
        league_id: '9',
        name: 'Bare',
        sport: 'nfl',
        season: '2024',
        total_rosters: 10,
        roster_positions: ['QB', 'RB', 'BN'],
      } as SleeperImportPayload['league'],
    })
    expect(bare).not.toBeNull()
    expect(bare?.waiver_type).toBeUndefined()
    expect(bare?.waiver_bid_min).toBeUndefined()
    expect(bare?.playoff_teams).toBeUndefined()
    expect(bare?.taxi_slots).toBeUndefined()
    expect(bare?.pick_trading).toBeUndefined()
    // faab_budget defaults to null (existing behavior contract)
    expect(bare?.faab_budget).toBeNull()
  })

  it('returns null when league missing entirely', () => {
    expect(SleeperLeagueMapper.map({ league: undefined as unknown as SleeperImportPayload['league'] })).toBeNull()
  })
})
