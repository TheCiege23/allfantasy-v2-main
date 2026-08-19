import { describe, it, expect } from 'vitest'
import { normalizeSleeperRoster, rosterContentHash, diffRosterPlayers, type CanonicalRosterSnapshot } from '@/lib/sports-data-gateway/runtime/rosterRuntime'
import { routeFor, isLiveEligible, CAPABILITY_ROUTES } from '@/lib/sports-data-gateway/capabilityRoutes'
import type { MappingSource } from '@/lib/sports-data-gateway/resolution'

const source: MappingSource = { byProviderId: (_p, id) => (id.endsWith('1') ? `canon:${id}` : null), candidatesBySignals: () => [] }

describe('capability routing matrix (Stop-gate 2)', () => {
  it('Sleeper-native scopes are verified; supporting-provider scopes are not', () => {
    expect(routeFor('NFL', 'rosters')?.verificationStatus).toBe('verified')
    expect(routeFor('NFL', 'transactions')?.verificationStatus).toBe('verified')
    expect(routeFor('NFL', 'schedules')?.verificationStatus).toBe('configured_not_verified')
    expect(routeFor('NFL', 'injuries')?.verificationStatus).toBe('configured_not_verified')
    expect(routeFor('NFL', 'projections')?.verificationStatus).toBe('configured_not_verified')
  })
  it('only verified capabilities are live-eligible', () => {
    expect(isLiveEligible('NFL', 'rosters')).toBe(true)
    expect(isLiveEligible('NFL', 'games')).toBe(false) // needs a verified provider before Lineup lock can advance
  })
  it('every route declares a cadence + staleness bound', () => {
    for (const r of CAPABILITY_ROUTES) {
      expect(r.refreshCadenceMinutes).toBeGreaterThan(0)
      expect(r.maximumStalenessMinutes).toBeGreaterThan(0)
    }
  })
})

describe('Sleeper roster normalization (Part 1)', () => {
  const raw = { roster_id: 5, owner_id: 'u9', players: ['1', '2', '3', '0'], starters: ['1'], reserve: ['3'], taxi: [] }
  it('maps canonical ids + starter/bench/IR buckets; quarantines unresolved once', () => {
    const r = normalizeSleeperRoster(raw, 'L1', '2025', source)
    expect(r.canonicalRosterId).toBe('sleeper:L1:5')
    expect(r.canonicalManagerId).toBe('sleeper:u9')
    expect(r.playerIds).toEqual(['canon:1', 'unresolved:sleeper:2', 'unresolved:sleeper:3'])
    expect(r.starterIds).toEqual(['canon:1'])
    expect(r.injuredReserveIds).toEqual(['unresolved:sleeper:3'])
    expect(r.reserveIds).toEqual(['unresolved:sleeper:2']) // bench = players - starters - IR - taxi
    expect(r.unresolvedCount).toBe(2) // players 2 and 3 (counted once each, not per list)
  })
  it('content hash is deterministic + order-insensitive but changes on membership change', () => {
    const a = normalizeSleeperRoster(raw, 'L1', '2025', source)
    const b = normalizeSleeperRoster({ ...raw, players: ['3', '2', '1'] }, 'L1', '2025', source)
    expect(rosterContentHash(a)).toBe(rosterContentHash(b))
    const c = normalizeSleeperRoster({ ...raw, players: ['1', '2'] }, 'L1', '2025', source)
    expect(rosterContentHash(a)).not.toBe(rosterContentHash(c))
  })
})

describe('roster player diff events', () => {
  const roster = (players: string[], starters: string[]): CanonicalRosterSnapshot => ({
    canonicalLeagueId: 'sleeper:L1', canonicalRosterId: 'sleeper:L1:1', canonicalManagerId: null, season: '2025',
    playerIds: players, starterIds: starters, reserveIds: [], taxiIds: [], injuredReserveIds: [], providerRosterId: '1', unresolvedCount: 0, sourceUpdatedAt: null,
  })
  it('emits added/removed/moved with deterministic ids', () => {
    const prev = [roster(['a', 'b'], ['a'])]
    const next = [roster(['a', 'c'], ['c'])] // b removed, c added, a benched→? a not in next starters so no move for a (a removed from starters but also present→moved), c is new starter
    const ev = diffRosterPlayers(prev, next, 'v1')
    const types = ev.map((e) => e.eventType).sort()
    expect(ev.some((e) => e.eventType === 'roster_player_added' && e.playerId === 'c')).toBe(true)
    expect(ev.some((e) => e.eventType === 'roster_player_removed' && e.playerId === 'b')).toBe(true)
    // deterministic
    expect(diffRosterPlayers(prev, next, 'v1')[0].eventId).toBe(ev[0].eventId)
    expect(types.length).toBeGreaterThan(0)
  })
  it('no events when roster unchanged (suppression)', () => {
    const same = [roster(['a', 'b'], ['a'])]
    expect(diffRosterPlayers(same, same, 'v1')).toEqual([])
  })
  it('emits moved when a retained player changes starter status', () => {
    const prev = [roster(['a', 'b'], ['a'])]
    const next = [roster(['a', 'b'], ['b'])] // a: starter→bench, b: bench→starter
    const moved = diffRosterPlayers(prev, next, 'v1').filter((e) => e.eventType === 'roster_player_moved')
    expect(moved.map((m) => m.playerId).sort()).toEqual(['a', 'b'])
  })
})
