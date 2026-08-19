import { describe, it, expect } from 'vitest'
import { mapEspnStatus, normalizeEspnGame } from '@/lib/sports-data-gateway/providers/espn'
import { diffGames, gameContentHash } from '@/lib/sports-data-gateway/runtime/scheduleRuntime'
import { normalizeTxnType, normalizeTxnStatus, normalizeSleeperTransaction, txnContentHash } from '@/lib/sports-data-gateway/runtime/transactionRuntime'
import type { CanonicalGameSchedule } from '@/lib/sports-data-gateway/contracts'
import type { MappingSource } from '@/lib/sports-data-gateway/resolution'

const source: MappingSource = { byProviderId: (_p, id) => (id.endsWith('1') ? `canon:${id}` : null), candidatesBySignals: () => [] }

describe('ESPN schedule normalization (Parts 5-6)', () => {
  const ev = { id: '401', date: '2026-09-10T00:20Z', season: { year: 2026 }, week: { number: 1 }, competitions: [{ venue: { fullName: 'Lumen Field' }, status: { type: { name: 'STATUS_SCHEDULED' } }, competitors: [{ homeAway: 'home', team: { id: '26', abbreviation: 'SEA' } }, { homeAway: 'away', team: { id: '17', abbreviation: 'NE' } }] }] }
  it('maps provider statuses to canonical', () => {
    expect(mapEspnStatus('STATUS_FINAL')).toBe('final')
    expect(mapEspnStatus('STATUS_POSTPONED')).toBe('postponed')
    expect(mapEspnStatus('STATUS_SUSPENDED')).toBe('suspended')
    expect(mapEspnStatus('STATUS_IN_PROGRESS')).toBe('live')
    expect(mapEspnStatus('weird')).toBe('unknown')
  })
  it('normalizes a game to canonical (ids, teams, status, provenance)', () => {
    const g = normalizeEspnGame(ev, 't', 'v1')!
    expect(g.canonicalGameId).toBe('espn:nfl:401')
    expect(g.homeTeamId).toBe('espn:nfl:team:26')
    expect(g.status).toBe('scheduled')
    expect(g.source.primaryProvider).toBe('espn')
  })
  it('rejects a malformed game missing required identity', () => {
    expect(normalizeEspnGame({ id: '1', date: '2026-09-10T00:20Z', competitions: [{ competitors: [] }] }, 't', 'v1')).toBeNull()
  })
})

describe('game status events (dedup + suppression)', () => {
  const g = (status: CanonicalGameSchedule['status']): CanonicalGameSchedule => ({ canonicalGameId: 'espn:nfl:1', sport: 'NFL', season: '2026', weekOrRound: '1', homeTeamId: 'h', awayTeamId: 'a', scheduledStart: '2026-09-10T00:20Z', status, venue: null, source: { primaryProvider: 'espn', providerRecordId: '1', fetchedAt: 't', sourceUpdatedAt: null, snapshotVersion: 'v1' } })
  it('new game → game_created', () => {
    const d = diffGames([g('scheduled')], new Map(), 'v1')
    expect(d.created).toBe(1)
    expect(d.events[0].eventType).toBe('game_created')
  })
  it('status change → status-mapped event', () => {
    const prev = new Map([['espn:nfl:1', gameContentHash(g('scheduled'))]])
    const d = diffGames([g('final')], prev, 'v1')
    expect(d.changed).toBe(1)
    expect(d.events[0].eventType).toBe('game_final')
  })
  it('unchanged game suppressed', () => {
    const prev = new Map([['espn:nfl:1', gameContentHash(g('scheduled'))]])
    expect(diffGames([g('scheduled')], prev, 'v1').suppressed).toBe(1)
  })
})

describe('Sleeper transaction normalization (Parts 1-2)', () => {
  it('classifies type + status deterministically; retains unknown', () => {
    expect(normalizeTxnType('trade')).toBe('trade')
    expect(normalizeTxnType('waiver')).toBe('waiver')
    expect(normalizeTxnType('free_agent')).toBe('free_agent')
    expect(normalizeTxnType('mystery')).toBe('unknown') // retained, not dropped
    expect(normalizeTxnStatus('complete')).toBe('complete')
    expect(normalizeTxnStatus('failed')).toBe('failed')
    expect(normalizeTxnStatus('weird')).toBe('unknown')
  })
  it('normalizes a trade to canonical with resolved/quarantined players + pick transfers', () => {
    const raw = { transaction_id: 'tx9', type: 'trade', status: 'complete', status_updated: 1700000000000, roster_ids: [1, 2], adds: { '1': 1, '2': 2 }, drops: { '3': 2 }, waiver_budget: [{ sender: 1, receiver: 2, amount: 5 }], draft_picks: [{ season: '2026', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }] }
    const t = normalizeSleeperTransaction(raw, 'L1', source)
    expect(t.canonicalTransactionId).toBe('sleeper:L1:tx9')
    expect(t.type).toBe('trade')
    expect(t.status).toBe('complete')
    expect(t.playerAdds['canon:1']).toBe('sleeper:L1:1') // player 1 resolved
    expect(Object.keys(t.playerAdds)).toContain('unresolved:sleeper:2') // player 2 quarantined
    expect(t.faabTransfers[0]).toMatchObject({ fromRosterId: 'sleeper:L1:1', toRosterId: 'sleeper:L1:2', amount: 5 })
    expect(t.draftPickTransfers[0]).toMatchObject({ season: '2026', round: 1, newOwnerRosterId: 'sleeper:L1:1' })
    expect(t.unresolvedPlayerCount).toBe(2) // players 2 and 3
  })
  it('content hash is deterministic', () => {
    const raw = { transaction_id: 't', type: 'waiver', status: 'complete', adds: { '1': 1 } }
    expect(txnContentHash(normalizeSleeperTransaction(raw, 'L1', source))).toBe(txnContentHash(normalizeSleeperTransaction(raw, 'L1', source)))
  })
})
