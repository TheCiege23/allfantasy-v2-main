/**
 * Decision OS Replay Framework Phase 13 — Sleeper lineup normalizer coverage.
 * Proves a real-shaped Sleeper matchup normalizes correctly: real actual
 * points preserved, roster identity resolution, the synthetic-but-
 * deterministic providerTransactionId, and dynasty/SuperFlex derivation.
 */
import { describe, it, expect } from 'vitest'
import { normalizeSleeperLineup } from '@/lib/replay-framework/normalize/lineupSleeperNormalizer'
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser } from '@/lib/sleeper-client'

const LEAGUE: SleeperLeague = {
  league_id: 'league-1',
  name: 'Test League',
  season: '2025',
  sport: 'nfl',
  status: 'in_season',
  total_rosters: 12,
  scoring_settings: { rec: 1 },
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
  settings: { type: 0 }, // 0 = redraft
  draft_id: 'draft-1',
  previous_league_id: null,
}

const ROSTERS: SleeperRoster[] = [
  { roster_id: 1, owner_id: 'user-a', players: ['1001', '1002', '1003'], starters: ['1001', '1002'], reserve: [], taxi: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 } },
]

const USERS: SleeperUser[] = [{ user_id: 'user-a', username: 'alice', display_name: 'Alice', avatar: null }]

const PLAYERS = {
  '1001': { full_name: 'Real QB', position: 'QB' },
  '1002': { full_name: 'Real RB', position: 'RB' },
  '1003': { full_name: 'Bench WR', position: 'WR' },
}

function makeMatchup(overrides: Partial<SleeperMatchup> = {}): SleeperMatchup {
  return {
    matchup_id: 1,
    roster_id: 1,
    points: 30,
    starters: ['1001', '1002'],
    starters_points: [20, 10],
    players: ['1001', '1002', '1003'],
    players_points: { '1001': 20, '1002': 10, '1003': 5 },
    ...overrides,
  }
}

describe('normalizeSleeperLineup', () => {
  it('produces a deterministic, idempotency-friendly providerTransactionId from league/roster/week', () => {
    const result = normalizeSleeperLineup({
      matchup: makeMatchup(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    expect(result.providerTransactionId).toBe('lineup-league-1-roster1-week3')
    expect(result.decisionType).toBe('lineup')
  })

  it('carries real actual points, never a projection, for every rostered player', () => {
    const result = normalizeSleeperLineup({
      matchup: makeMatchup(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    const payload = result.payload as { fullRoster: Array<{ providerAssetId: string; actualPoints: number }> }
    expect(payload.fullRoster).toEqual(
      expect.arrayContaining([
        { providerAssetId: '1001', name: 'Real QB', pos: ['QB'], actualPoints: 20 },
        { providerAssetId: '1002', name: 'Real RB', pos: ['RB'], actualPoints: 10 },
        { providerAssetId: '1003', name: 'Bench WR', pos: ['WR'], actualPoints: 5 },
      ]),
    )
  })

  it('preserves the real actual starter IDs and league roster slot positions', () => {
    const result = normalizeSleeperLineup({
      matchup: makeMatchup(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    const payload = result.payload as { actualStarterIds: string[]; slotPositions: string[] }
    expect(payload.actualStarterIds).toEqual(['1001', '1002'])
    expect(payload.slotPositions).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'])
  })

  it('resolves manager identity via the roster -> owner -> display name join', () => {
    const result = normalizeSleeperLineup({
      matchup: makeMatchup(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    expect(result.managerDisplayNames).toEqual([{ rosterId: 1, displayName: 'Alice' }])
  })

  it('derives isDynasty=false and isSuperFlex=false for a real single-QB redraft league', () => {
    const result = normalizeSleeperLineup({
      matchup: makeMatchup(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    expect(result.isDynasty).toBe(false)
    expect(result.isSuperFlex).toBe(false)
  })

  it('stores the raw provider matchup payload verbatim for reprocessing', () => {
    const matchup = makeMatchup()
    const result = normalizeSleeperLineup({
      matchup,
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    expect(result.rawProviderPayload).toEqual(matchup)
  })

  it('always resolves to a non-null resolvedAt -- a scored week is inherently resolved, unlike a pending trade', () => {
    const result = normalizeSleeperLineup({
      matchup: makeMatchup(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      ingestSourceUserId: 'ingest-user-1',
      week: 3,
    })

    expect(result.resolvedAt).not.toBeNull()
    expect(result.providerStatus).toBe('scored')
  })
})
