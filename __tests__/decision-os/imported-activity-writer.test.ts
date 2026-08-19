import { describe, it, expect } from 'vitest'
import type { ExternalIdentityMapping } from '@/lib/league-import/types'
import {
  buildManagerIdentityIndex,
  normalizeImportedActivityBatch,
  type RawImportedActivity,
} from '@/lib/decision-os/ingestion/importedActivityNormalizer'
import {
  InMemoryImportedActivityStore,
  toPersistedActivityRecord,
  type ImportedActivityStore,
  type PersistedActivityRecord,
  type UpsertResult,
} from '@/lib/decision-os/ingestion/importedActivityStore'
import { writeImportedActivity } from '@/lib/decision-os/ingestion/importedActivityWriter'

const afManager: ExternalIdentityMapping = {
  source_provider: 'sleeper',
  source_id: 'sleeper_1',
  entity_type: 'manager',
  af_id: 'af_user_1',
}
const externalOnly: ExternalIdentityMapping = {
  source_provider: 'sleeper',
  source_id: 'sleeper_2',
  entity_type: 'manager',
  af_id: null,
  stable_key: 'sleeper:user:2',
}
const index = buildManagerIdentityIndex([afManager, externalOnly])

/** A representative multi-type Sleeper activity batch (both managers AF + external-only). */
function rawBatch(): RawImportedActivity[] {
  const both = ['sleeper_1', 'sleeper_2']
  return [
    { provider: 'sleeper', leagueId: 'L1', activityType: 'trade', providerEventId: 'txn_1', occurredAt: '2026-01-01T00:00:00Z', managerSourceIds: both },
    { provider: 'sleeper', leagueId: 'L1', activityType: 'waiver', providerEventId: 'wv_1', occurredAt: '2026-01-02T00:00:00Z', managerSourceIds: ['sleeper_2'] },
    { provider: 'sleeper', leagueId: 'L1', activityType: 'roster_move', providerEventId: 'rm_1', occurredAt: '2026-01-03T00:00:00Z', managerSourceIds: ['sleeper_1'] },
    { provider: 'sleeper', leagueId: 'L1', activityType: 'draft_pick', providerEventId: 'dp_1', occurredAt: '2026-01-04T00:00:00Z', managerSourceIds: ['sleeper_1'] },
  ]
}

function normalize(raws: RawImportedActivity[]) {
  return normalizeImportedActivityBatch(raws, index).normalized
}

describe('Decision OS ingestion — importedActivityWriter (Increment 2)', () => {
  describe('idempotent persistence (Do #9/#10)', () => {
    it('first write creates; re-writing the same batch updates (no duplicates, count stable)', async () => {
      const store = new InMemoryImportedActivityStore()
      const records = normalize(rawBatch())

      const run1 = await writeImportedActivity(records, store)
      expect(run1.created).toBe(4)
      expect(run1.updated).toBe(0)
      expect(await store.count()).toBe(4)

      const run2 = await writeImportedActivity(records, store)
      expect(run2.created).toBe(0)
      expect(run2.updated).toBe(4)
      expect(await store.count()).toBe(4) // converged — no duplication
    })

    it('repeated ingestion (incl. duplicate events within a batch) converges to identical persisted state', async () => {
      const store = new InMemoryImportedActivityStore()
      const records = normalize(rawBatch())

      await writeImportedActivity(records, store)
      const afterRun1 = store.snapshot()

      // replay 3x with in-batch duplicates
      for (let i = 0; i < 3; i++) await writeImportedActivity([...records, ...records], store)
      const afterReplays = store.snapshot()

      expect(afterReplays).toEqual(afterRun1)
      expect(await store.count()).toBe(4)
    })

    it('persists per activity type (trade/waiver/roster_move/draft_pick)', async () => {
      const store = new InMemoryImportedActivityStore()
      const summary = await writeImportedActivity(normalize(rawBatch()), store)
      expect(summary.persistedByActivityType).toEqual({ trade: 1, waiver: 1, roster_move: 1, draft_pick: 1 })
    })
  })

  describe('external-only manager attribution (Do #11 — no AF account required)', () => {
    it('persists activity attributed only via provider stable_key and counts it', async () => {
      const store = new InMemoryImportedActivityStore()
      const waiverByExternal = normalize([
        { provider: 'sleeper', leagueId: 'L1', activityType: 'waiver', providerEventId: 'wv_ext', occurredAt: '2026-01-05T00:00:00Z', managerSourceIds: ['sleeper_2'] },
      ])
      const summary = await writeImportedActivity(waiverByExternal, store)

      expect(summary.created).toBe(1)
      expect(summary.externalOnlyManagerRecords).toBe(1)
      const persisted = await store.getByNaturalKey('dos:act:sleeper:L1:waiver:wv_ext')
      expect(persisted?.managerKeys).toEqual(['sleeper:user:2']) // attributed without an AllFantasy account
      expect(persisted?.hasExternalOnlyManager).toBe(true)
    })
  })

  describe('honest degradation (Do #8 — surface store-level skips, never fabricate)', () => {
    it('surfaces skips when the store cannot represent a record (simulating the afLeagueTrade AppUser-FK constraint)', async () => {
      const inner = new InMemoryImportedActivityStore()
      // A store that mirrors the real Prisma constraint: cannot write a trade that involves an
      // external-only manager into the AF-account-coupled afLeagueTrade table.
      const constrainedStore: ImportedActivityStore = {
        async upsertByNaturalKey(record: PersistedActivityRecord): Promise<UpsertResult> {
          if (record.activityType === 'trade' && record.hasExternalOnlyManager) {
            return { status: 'skipped', reason: 'AF_USER_FK_REQUIRED_FOR_TRADE' }
          }
          return inner.upsertByNaturalKey(record)
        },
        count: () => inner.count(),
        getByNaturalKey: (k) => inner.getByNaturalKey(k),
      }

      const summary = await writeImportedActivity(normalize(rawBatch()), constrainedStore)
      expect(summary.skipped).toBe(1)
      expect(summary.skippedReasons).toEqual({ AF_USER_FK_REQUIRED_FOR_TRADE: 1 })
      expect(summary.created).toBe(3) // waiver + roster_move + draft_pick still persisted
      expect(await inner.count()).toBe(3) // the blocked trade was NOT fabricated into the store
    })
  })

  describe('purity: persisted record mirrors the normalized seam', () => {
    it('toPersistedActivityRecord carries key, identity, and payload without inventing fields', () => {
      const [n] = normalize([
        { provider: 'yahoo', leagueId: 'L9', activityType: 'trade', providerEventId: 't9', occurredAt: '2026-02-01T00:00:00Z', managerSourceIds: ['sleeper_1', 'sleeper_2'], payload: { note: 'x' } },
      ])
      const rec = toPersistedActivityRecord(n)
      expect(rec).toMatchObject({
        naturalKey: 'dos:act:yahoo:L9:trade:t9',
        provider: 'yahoo',
        managerKeys: ['af_user_1', 'sleeper:user:2'],
        hasExternalOnlyManager: true,
        payload: { note: 'x' },
      })
    })
  })
})
