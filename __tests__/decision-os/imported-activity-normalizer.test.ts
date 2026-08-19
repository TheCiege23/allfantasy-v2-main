import { describe, it, expect } from 'vitest'
import type { ExternalIdentityMapping } from '@/lib/league-import/types'
import {
  deriveActivityNaturalKey,
  resolveManagerKey,
  buildManagerIdentityIndex,
  normalizeImportedActivity,
  normalizeImportedActivityBatch,
  type RawImportedActivity,
} from '@/lib/decision-os/ingestion/importedActivityNormalizer'

const afManager: ExternalIdentityMapping = {
  source_provider: 'sleeper',
  source_id: 'sleeper_user_1',
  entity_type: 'manager',
  af_id: 'af_user_1',
}
const externalOnlyManager: ExternalIdentityMapping = {
  source_provider: 'sleeper',
  source_id: 'sleeper_user_2',
  entity_type: 'manager',
  af_id: null,
  stable_key: 'sleeper:user:2',
}
const index = buildManagerIdentityIndex([afManager, externalOnlyManager])

function tradeActivity(overrides: Partial<RawImportedActivity> = {}): RawImportedActivity {
  return {
    provider: 'sleeper',
    leagueId: 'league_abc',
    activityType: 'trade',
    providerEventId: 'txn_100',
    occurredAt: '2026-01-02T03:04:05.000Z',
    managerSourceIds: ['sleeper_user_1', 'sleeper_user_2'],
    payload: { adds: {}, drops: {} },
    ...overrides,
  }
}

describe('Decision OS ingestion — importedActivityNormalizer', () => {
  describe('idempotency (Phase A Deliverable #2)', () => {
    it('produces an identical natural key for the same provider event across runs', () => {
      const a = normalizeImportedActivity(tradeActivity(), index)
      const b = normalizeImportedActivity(tradeActivity(), index)
      expect(a.skipped).toBe(false)
      expect(b.skipped).toBe(false)
      if (!a.skipped && !b.skipped) {
        expect(a.naturalKey).toBe(b.naturalKey)
        expect(a.naturalKey).toBe('dos:act:sleeper:league_abc:trade:txn_100')
      }
    })

    it('a re-run batch containing the same events yields the same key set (upsert converges, no dupes)', () => {
      const events = [tradeActivity(), tradeActivity({ providerEventId: 'txn_101' })]
      const run1 = normalizeImportedActivityBatch(events, index)
      const run2 = normalizeImportedActivityBatch([...events, ...events], index) // replay w/ duplicates
      const keys1 = new Set(run1.normalized.map((n) => n.naturalKey))
      const keys2 = new Set(run2.normalized.map((n) => n.naturalKey))
      expect([...keys2].sort()).toEqual([...keys1].sort())
      expect(keys1.size).toBe(2)
    })

    it('natural keys are stable, distinct per event, and collision-safe for ids containing the delimiter', () => {
      expect(deriveActivityNaturalKey('sleeper', 'L', 'trade', 'a:b')).not.toBe(
        deriveActivityNaturalKey('sleeper', 'L', 'trade', 'a'),
      )
      expect(deriveActivityNaturalKey('sleeper', 'L', 'trade', 'a')).not.toBe(
        deriveActivityNaturalKey('sleeper', 'L', 'waiver', 'a'),
      )
    })
  })

  describe('external-manager identity (Phase A Do #6 — reuses ExternalIdentityMapping)', () => {
    it('keys AF managers by af_id and non-AF managers by provider stable_key', () => {
      expect(resolveManagerKey(afManager)).toBe('af_user_1')
      expect(resolveManagerKey(externalOnlyManager)).toBe('sleeper:user:2')
    })

    it('attributes activity to ALL participants, flagging when a non-AF manager is present', () => {
      const r = normalizeImportedActivity(tradeActivity(), index)
      expect(r.skipped).toBe(false)
      if (!r.skipped) {
        expect(r.managerKeys).toEqual(['af_user_1', 'sleeper:user:2'])
        expect(r.hasExternalOnlyManager).toBe(true)
      }
    })

    it('resolves nothing for an unmapped source id (no fabricated identity)', () => {
      expect(resolveManagerKey(index.get('unknown'))).toBeNull()
    })
  })

  describe('honest degradation (Phase A Do #8 — never fabricate)', () => {
    it('skips when the provider event id is missing (cannot dedupe safely)', () => {
      const r = normalizeImportedActivity(tradeActivity({ providerEventId: null }), index)
      expect(r).toMatchObject({ skipped: true, reason: 'MISSING_PROVIDER_EVENT_ID' })
    })

    it('skips when the timestamp is missing or unparseable (cannot order trends)', () => {
      expect(normalizeImportedActivity(tradeActivity({ occurredAt: '' }), index)).toMatchObject({
        skipped: true,
        reason: 'MISSING_OCCURRED_AT',
      })
      expect(normalizeImportedActivity(tradeActivity({ occurredAt: 'not-a-date' }), index)).toMatchObject({
        skipped: true,
        reason: 'MISSING_OCCURRED_AT',
      })
    })

    it('skips when no participant can be attributed (never invents a manager)', () => {
      const r = normalizeImportedActivity(tradeActivity({ managerSourceIds: ['ghost_1', 'ghost_2'] }), index)
      expect(r).toMatchObject({ skipped: true, reason: 'NO_ATTRIBUTABLE_MANAGER' })
    })

    it('partitions a batch into normalized + skipped so ingestion can telemeter honestly', () => {
      const { normalized, skipped } = normalizeImportedActivityBatch(
        [tradeActivity(), tradeActivity({ providerEventId: undefined }), tradeActivity({ managerSourceIds: [] })],
        index,
      )
      expect(normalized).toHaveLength(1)
      expect(skipped.map((s) => s.reason).sort()).toEqual(['MISSING_PROVIDER_EVENT_ID', 'NO_ATTRIBUTABLE_MANAGER'])
    })
  })

  describe('provider-open (Phase A Do #7)', () => {
    it('normalizes the same shape for any provider (Yahoo example)', () => {
      const yahoo = normalizeImportedActivity(
        tradeActivity({ provider: 'yahoo', managerSourceIds: ['sleeper_user_1'] }),
        index,
      )
      expect(yahoo.skipped).toBe(false)
      if (!yahoo.skipped) expect(yahoo.naturalKey.startsWith('dos:act:yahoo:')).toBe(true)
    })
  })
})
