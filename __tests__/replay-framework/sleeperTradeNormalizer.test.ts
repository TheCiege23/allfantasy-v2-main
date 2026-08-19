/**
 * Decision OS Replay Framework — Sleeper trade normalizer coverage.
 * Proves real-shaped Sleeper transactions normalize correctly: give/receive
 * split, manager identity resolution, dynasty/SuperFlex derivation, and
 * status mapping.
 */
import { describe, it, expect } from 'vitest'
import { mapSleeperStatusToOutcome, normalizeSleeperTrade } from '@/lib/replay-framework/normalize/sleeperTradeNormalizer'
import type { SleeperLeague, SleeperRoster, SleeperTransaction, SleeperUser } from '@/lib/sleeper-client'

const LEAGUE: SleeperLeague = {
  league_id: 'league-1',
  name: 'Test League',
  season: '2025',
  sport: 'nfl',
  status: 'in_season',
  total_rosters: 12,
  scoring_settings: { rec: 1 },
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX', 'BN'],
  settings: { type: 2 }, // 2 = dynasty
  draft_id: 'draft-1',
  previous_league_id: null,
}

const ROSTERS: SleeperRoster[] = [
  { roster_id: 1, owner_id: 'user-a', players: ['1001', '1003'], starters: ['1001'], reserve: [], taxi: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 } },
  { roster_id: 2, owner_id: 'user-b', players: ['1002', '1004'], starters: ['1002'], reserve: [], taxi: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 } },
]

const USERS: SleeperUser[] = [
  { user_id: 'user-a', username: 'alice', display_name: 'Alice', avatar: null },
  { user_id: 'user-b', username: 'bob', display_name: 'Bob', avatar: null },
]

const PLAYERS = {
  '1001': { full_name: 'Real Player One', position: 'RB' },
  '1002': { full_name: 'Real Player Two', position: 'WR' },
  '1003': { full_name: 'Bench Player Three', position: 'QB' }, // on roster 1, not part of the traded assets
  '1004': { full_name: 'Bench Player Four', position: 'TE' }, // on roster 2, not part of the traded assets
}

function makeTrade(overrides: Partial<SleeperTransaction> = {}): SleeperTransaction {
  return {
    type: 'trade',
    transaction_id: 'tx-1',
    status: 'complete',
    roster_ids: [1, 2],
    adds: { '1001': 1, '1002': 2 },
    drops: { '1002': 1, '1001': 2 },
    draft_picks: [],
    waiver_budget: [],
    leg: 1,
    created: 1735689600000,
    creator: 'user-a',
    consenter_ids: [1, 2],
    status_updated: 1735693200000,
    ...overrides,
  }
}

describe('normalizeSleeperTrade', () => {
  it('splits assets given/received from roster 1 (the canonical proposer)', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const payload = result.payload as { assetsGiven: Array<{ name: string }>; assetsReceived: Array<{ name: string }> }
    // Roster 1 dropped player 1002 (given away) and received player 1001 (added).
    expect(payload.assetsGiven.map((a) => a.name)).toContain('Real Player Two')
    expect(payload.assetsReceived.map((a) => a.name)).toContain('Real Player One')
  })

  it('resolves manager identity via the roster -> owner -> display name join', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const displayNames = result.managerDisplayNames as Array<{ rosterId: number; displayName: string | null }>
    expect(displayNames).toEqual(
      expect.arrayContaining([
        { rosterId: 1, displayName: 'Alice' },
        { rosterId: 2, displayName: 'Bob' },
      ]),
    )
  })

  it('derives isDynasty and isSuperFlex from the league scoring/roster context', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    expect(result.isDynasty).toBe(true)
    expect(result.isSuperFlex).toBe(true) // roster_positions has both QB and SUPER_FLEX
  })

  it('preserves both real timestamps: proposedAt (created) and resolvedAt (status_updated)', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    expect(result.proposedAt.getTime()).toBe(1735689600000)
    expect(result.resolvedAt?.getTime()).toBe(1735693200000)
  })

  it('leaves resolvedAt null for a pending trade — no unearned assumption of resolution', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade({ status: 'pending' }),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    expect(result.resolvedAt).toBeNull()
    expect(result.providerStatus).toBe('pending')
  })

  it('stores the raw provider payload verbatim for reprocessing', () => {
    const tx = makeTrade()
    const result = normalizeSleeperTrade({
      transaction: tx,
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    expect(result.rawProviderPayload).toEqual(tx)
  })

  it('resolves each side\'s full real roster (Phase 6), not just the traded assets', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const payload = result.payload as { proposerRoster?: Array<{ name: string; pos?: string }>; counterpartyRoster?: Array<{ name: string; pos?: string }> }
    // Roster 1 (proposer) owns players 1001 and 1003 — including the
    // bench player 1003 that was never part of the traded assets.
    expect(payload.proposerRoster?.map((a) => a.name)).toEqual(expect.arrayContaining(['Real Player One', 'Bench Player Three']))
    expect(payload.counterpartyRoster?.map((a) => a.name)).toEqual(expect.arrayContaining(['Real Player Two', 'Bench Player Four']))
  })

  it('resolves position for roster context (required for computeTradeDrivers()\'s lineup math)', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const payload = result.payload as { proposerRoster?: Array<{ name: string; pos?: string }> }
    const benchPlayer = payload.proposerRoster?.find((a) => a.name === 'Bench Player Three')
    expect(benchPlayer?.pos).toBe('QB')
  })

  it('omits roster context gracefully when a roster is not found (backward-compatible with pre-Phase-6 behavior)', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade({ roster_ids: [1, 99] }), // roster 99 doesn't exist in ROSTERS
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [],
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const payload = result.payload as { counterpartyRoster?: unknown }
    expect(payload.counterpartyRoster).toBeUndefined()
  })

  it('Phase 7: populates vorpValue via the real VORP resolver when a player resolves against FantasyCalc', () => {
    const fcPlayers = [
      {
        player: { name: 'Real Player One', position: 'RB', sleeperId: '1001' },
        value: 5000, overallRank: 10, positionRank: 3, trend30Day: 0,
        redraftDynastyValueDifference: 0, redraftDynastyValuePercDifference: 0,
        redraftValue: 4500, combinedValue: 5000,
        maybeMovingStandardDeviation: null, maybeMovingStandardDeviationPerc: null, maybeMovingStandardDeviationAdjusted: null,
        displayTrend: false, maybeOwner: null, starter: true, maybeTier: null, maybeAdp: null, maybeTradeFrequency: null,
      },
    ] as any

    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers,
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const payload = result.payload as { assetsReceived: Array<{ name: string; vorpValue?: number }> }
    const receivedPlayerOne = payload.assetsReceived.find((a) => a.name === 'Real Player One')
    expect(receivedPlayerOne?.vorpValue).toBeTypeOf('number')
    expect(receivedPlayerOne?.vorpValue).toBeGreaterThanOrEqual(0)
  })

  it('Phase 7: defaults vorpValue to 0 when no FantasyCalc data is available — never fabricated, never throws', () => {
    const result = normalizeSleeperTrade({
      transaction: makeTrade(),
      league: LEAGUE,
      rosters: ROSTERS,
      users: USERS,
      players: PLAYERS,
      fcPlayers: [], // no FantasyCalc data at all
      ingestSourceUserId: 'ingest-user-1',
      providerWeek: 1,
    })

    const payload = result.payload as { assetsGiven: Array<{ vorpValue?: number }>; assetsReceived: Array<{ vorpValue?: number }> }
    expect(payload.assetsGiven.every((a) => a.vorpValue === 0)).toBe(true)
    expect(payload.assetsReceived.every((a) => a.vorpValue === 0)).toBe(true)
  })
})

describe('mapSleeperStatusToOutcome', () => {
  it('maps complete -> ACCEPTED, failed -> REJECTED, anything else -> UNKNOWN', () => {
    expect(mapSleeperStatusToOutcome('complete')).toBe('ACCEPTED')
    expect(mapSleeperStatusToOutcome('failed')).toBe('REJECTED')
    expect(mapSleeperStatusToOutcome('pending')).toBe('UNKNOWN')
    expect(mapSleeperStatusToOutcome('something_new_sleeper_adds_later')).toBe('UNKNOWN')
  })
})
