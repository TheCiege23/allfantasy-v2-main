import { describe, it, expect } from 'vitest'
import { resolveTeam, certifyNflTeamMapping, NFL_TEAMS } from '@/lib/sports-data-gateway/teamIdentity'
import { resolvePlayerGame } from '@/lib/sports-data-gateway/runtime/playerGameResolution'
import { evaluateAutoSwitchSafety, lockEvidenceFrom, buildLockEvidence, assembleLiveLineupContext } from '@/lib/sports-data-gateway/runtime/lineupSafety'
import { normalizeDraftStatus, normalizeDraftPick, reconcilePickOwnership } from '@/lib/sports-data-gateway/runtime/draftRuntime'
import type { CanonicalGameSchedule } from '@/lib/sports-data-gateway/contracts'
import type { MappingSource } from '@/lib/sports-data-gateway/resolution'
import { buildCertifiedFreshness } from '@/lib/sports-data-gateway/runtime/freshnessPure'

const source: MappingSource = { byProviderId: (_p, id) => (id.endsWith('1') ? `canon:${id}` : null), candidatesBySignals: () => [] }

describe('canonical team identity (Parts 1-3)', () => {
  it('resolves ESPN id → canonical', () => expect(resolveTeam({ provider: 'espn', ref: '12', sport: 'NFL' })).toMatchObject({ status: 'resolved', canonicalTeamId: 'nfl:KC' }))
  it('resolves Sleeper abbreviation → canonical', () => expect(resolveTeam({ provider: 'sleeper', ref: 'KC', sport: 'NFL' })).toMatchObject({ status: 'resolved', canonicalTeamId: 'nfl:KC' }))
  it('bridges the WAS↔WSH divergence to one canonical team', () => {
    expect(resolveTeam({ provider: 'sleeper', ref: 'WAS', sport: 'NFL' }).status === 'resolved' && resolveTeam({ provider: 'sleeper', ref: 'WAS', sport: 'NFL' })).toMatchObject({ canonicalTeamId: 'nfl:WAS' })
    expect(resolveTeam({ provider: 'espn', ref: '28', sport: 'NFL' })).toMatchObject({ status: 'resolved', canonicalTeamId: 'nfl:WAS' })
  })
  it('resolves a historical alias (OAK → LV)', () => expect(resolveTeam({ provider: 'sleeper', ref: 'OAK', sport: 'NFL' })).toMatchObject({ status: 'resolved', canonicalTeamId: 'nfl:LV' }))
  it('free-agent / empty is unresolved by design', () => {
    expect(resolveTeam({ provider: 'sleeper', ref: null, sport: 'NFL' }).status).toBe('unresolved')
    expect(resolveTeam({ provider: 'sleeper', ref: 'FA', sport: 'NFL' }).status).toBe('unresolved')
  })
  it('an abbreviation without the right sport does not resolve', () => expect(resolveTeam({ provider: 'sleeper', ref: 'KC', sport: 'NBA' }).status).toBe('unresolved'))
  it('certifies 32 active teams with no duplicates + a stable checksum', () => {
    const c = certifyNflTeamMapping()
    expect(c.certified).toBe(true)
    expect(c.resolvedCount).toBe(32)
    expect(c.providerCoverage).toEqual({ espn: 32, sleeper: 32 })
    expect(certifyNflTeamMapping().checksum).toBe(c.checksum) // deterministic
    expect(NFL_TEAMS).toHaveLength(32)
  })
})

const game = (home: string, away: string, start: string, status: CanonicalGameSchedule['status'] = 'scheduled'): CanonicalGameSchedule => ({ canonicalGameId: `espn:nfl:${home}-${away}`, sport: 'NFL', season: '2026', weekOrRound: '1', homeTeamId: `espn:nfl:team:${home}`, awayTeamId: `espn:nfl:team:${away}`, scheduledStart: start, status, venue: null, source: { primaryProvider: 'espn', providerRecordId: '1', fetchedAt: 't', sourceUpdatedAt: null, snapshotVersion: 'v1' } })
const START = '2026-11-15T18:00:00Z'

describe('player → game resolution (Part 4)', () => {
  const games = [game('12', '25', START)] // KC vs SF
  it('resolves a single eligible game', () => expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'KC', sport: 'NFL', at: START, games, scheduleComplete: true }).status).toBe('resolved'))
  it('bye only when schedule is certified complete', () => {
    expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'BUF', sport: 'NFL', at: START, games, scheduleComplete: true }).status).toBe('bye')
    expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'BUF', sport: 'NFL', at: START, games, scheduleComplete: false }).status).toBe('missing_schedule')
  })
  it('free-agent is not a bye; unresolved team fails closed', () => {
    expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: null, sport: 'NFL', at: START, games, scheduleComplete: true }).status).toBe('free_agent')
    expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'ZZZ', sport: 'NFL', at: START, games, scheduleComplete: true }).status).toBe('unresolved_team')
  })
  it('multiple games conflict; differing starts is a conflicting schedule', () => {
    expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'KC', sport: 'NFL', at: START, games: [game('12', '25', START), game('17', '12', START)], scheduleComplete: true }).status).toBe('multiple_games')
    expect(resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'KC', sport: 'NFL', at: START, games: [game('12', '25', START), game('17', '12', '2026-11-16T18:00:00Z')], scheduleComplete: true }).status).toBe('conflicting_schedule')
  })
})

describe('auto-switch safety + lock evidence (Parts 5,7,8)', () => {
  const resolved = (status: CanonicalGameSchedule['status'], start: string) => resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'KC', sport: 'NFL', at: start, games: [game('12', '25', START, status)], scheduleComplete: true })
  const ok = { authorized: true, rosterLegal: true, scheduleFresh: true }
  it('allows only a verified-unlocked (before start) player', () => {
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: resolved('scheduled', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: true, reason: 'verified_unlocked' })
  })
  it('rejects after start (already_locked), postponed, suspended, final', () => {
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: resolved('scheduled', START), now: new Date(START) }).allowed).toBe(false)
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: resolved('postponed', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: false, reason: 'game_postponed' })
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: resolved('suspended', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: false, reason: 'game_suspended' })
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: resolved('final', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: false, reason: 'game_final' })
  })
  it('fails closed on missing schedule, unresolved team, unauthorized, illegal roster, stale schedule', () => {
    const games = [game('12', '25', START)]
    const missing = resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'BUF', sport: 'NFL', at: START, games, scheduleComplete: false })
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: missing, now: new Date() })).toMatchObject({ allowed: false, reason: 'schedule_unavailable' })
    expect(evaluateAutoSwitchSafety({ ...ok, resolution: resolvePlayerGame({ canonicalPlayerId: 'p', playerTeamReference: 'ZZZ', sport: 'NFL', at: START, games, scheduleComplete: true }), now: new Date() })).toMatchObject({ allowed: false, reason: 'team_unresolved' })
    expect(evaluateAutoSwitchSafety({ authorized: false, rosterLegal: true, scheduleFresh: true, resolution: resolved('scheduled', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: false, reason: 'authorization_failed' })
    expect(evaluateAutoSwitchSafety({ authorized: true, rosterLegal: false, scheduleFresh: true, resolution: resolved('scheduled', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: false, reason: 'roster_illegal' })
    expect(evaluateAutoSwitchSafety({ authorized: true, rosterLegal: true, scheduleFresh: false, resolution: resolved('scheduled', START), now: new Date('2026-11-15T17:00:00Z') })).toMatchObject({ allowed: false, reason: 'schedule_stale' })
  })
  it('produces a lock evidence record (no raw payloads)', () => {
    const fresh = buildCertifiedFreshness({ snapshotId: 's', version: 'nfl-games-v1', checksum: 'c', provider: 'espn', generatedAt: new Date().toISOString(), sourceUpdatedAt: null, recordCount: 1, resolvedCount: 1, ambiguousCount: 0, unresolvedCount: 0, rejectedCount: 0, limitations: [] }, new Date())
    const ctx = assembleLiveLineupContext({ canonicalPlayerId: 'p', resolution: resolved('scheduled', START), now: new Date('2026-11-15T17:00:00Z'), freshness: fresh })
    const ev = buildLockEvidence({ context: ctx, leagueLockPolicyVersion: 'std.v1', finalDecision: 'allowed', reason: 'before_start', now: new Date() })
    expect(ev.finalDecision).toBe('allowed')
    expect(ev.leagueLockPolicyVersion).toBe('std.v1')
    expect(ctx.sportsDataLockEvidence).toBe('before_start')
  })
})

describe('Sleeper draft normalization + pick ownership (Parts 9-11)', () => {
  it('normalizes draft status + a pick (resolved vs quarantined)', () => {
    expect(normalizeDraftStatus('complete')).toBe('complete')
    const resolvedPick = normalizeDraftPick({ pick_no: 1, round: 1, roster_id: 3, player_id: '1', draft_slot: 3 }, 'D1', 'L1', source, 't', 'v1')
    expect(resolvedPick.canonicalDraftPickId).toBe('sleeper:L1:D1:1')
    expect(resolvedPick.identityStatus).toBe('resolved')
    expect(resolvedPick.canonicalPlayerId).toBe('canon:1')
    const unresolvedPick = normalizeDraftPick({ pick_no: 2, round: 1, roster_id: 4, player_id: '2' }, 'D1', 'L1', source, 't', 'v1')
    expect(unresolvedPick.identityStatus).toBe('unresolved')
  })
  it('reconciles pick ownership: agreement resolves, disagreement stays conflicting', () => {
    expect(reconcilePickOwnership({ canonicalDraftPickId: 'p', draftSnapshotOwner: 'r1', transactionEvidenceOwner: 'r1', currentProviderOwner: 'r1' }).status).toBe('resolved')
    expect(reconcilePickOwnership({ canonicalDraftPickId: 'p', draftSnapshotOwner: 'r1', transactionEvidenceOwner: 'r2', currentProviderOwner: null }).status).toBe('conflicting')
    expect(reconcilePickOwnership({ canonicalDraftPickId: 'p', draftSnapshotOwner: null, transactionEvidenceOwner: null, currentProviderOwner: null }).status).toBe('insufficient_evidence')
  })
})
