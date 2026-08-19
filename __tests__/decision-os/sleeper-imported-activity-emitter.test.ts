import { describe, it, expect } from 'vitest'
import type { ExternalIdentityMapping } from '@/lib/league-import/types'
import type {
  SleeperTransactionRaw,
  SleeperDraftPickRaw,
  SleeperRosterRaw,
} from '@/lib/league-import/adapters/sleeper/types'
import { buildManagerIdentityIndex } from '@/lib/decision-os/ingestion/importedActivityNormalizer'
import { InMemoryImportedActivityStore, type PersistedActivityRecord } from '@/lib/decision-os/ingestion/importedActivityStore'
import {
  buildRosterOwnerMap,
  emitSleeperTransactionActivity,
  emitSleeperDraftPickActivity,
  ingestSleeperImportedActivity,
} from '@/lib/decision-os/ingestion/sleeperActivityEmitter'
import { mapImportedActivityRowsToEvents, type ImportedActivityEventRow } from '@/lib/decision-os/behavioral/importedActivityToEvents'
import { assembleLeagueBehavioralFacts } from '@/lib/decision-os/behavioral/assemble'

// ── Realistically-shaped Sleeper fixtures (same types the production adapter uses) ──────────
const rosters: SleeperRosterRaw[] = [
  { roster_id: 1, owner_id: 'sleeper_owner_1' }, // has an AF account
  { roster_id: 2, owner_id: 'sleeper_owner_2' }, // external-only manager, no AF account
  { roster_id: 3, owner_id: undefined },         // orphan roster — never fabricate a manager for it
]

const tradeTx: SleeperTransactionRaw = {
  transaction_id: 'txn_trade_1',
  type: 'trade',
  status: 'complete',
  created: 1735689600000, // 2025-01-01T00:00:00.000Z
  roster_ids: [1, 2],
  adds: { '4046': '1', '5892': '2' },
  drops: { '4046': '2', '5892': '1' },
}

const waiverTx: SleeperTransactionRaw = {
  transaction_id: 'txn_waiver_1',
  type: 'waiver',
  status: 'complete',
  created: 1735776000000, // 2025-01-02T00:00:00.000Z
  roster_ids: [2],
  adds: { '1234': '2' },
}

const afManager: ExternalIdentityMapping = { source_provider: 'sleeper', source_id: 'sleeper_owner_1', entity_type: 'manager', af_id: 'af_1' }
const externalOnly: ExternalIdentityMapping = { source_provider: 'sleeper', source_id: 'sleeper_owner_2', entity_type: 'manager', af_id: null, stable_key: 'sleeper:user:sleeper_owner_2' }
const identityIndex = buildManagerIdentityIndex([afManager, externalOnly])

/** Test-only glue: adapt the persisted-record shape to the behavioral reader's row shape. */
function toEventRow(r: PersistedActivityRecord): ImportedActivityEventRow {
  return {
    externalSourceKey: r.naturalKey,
    provider: r.provider,
    afLeagueId: null,
    providerLeagueId: r.leagueId,
    activityType: r.activityType,
    occurredAt: r.occurredAt,
    createdAt: r.occurredAt,
    normalized: { managerKeys: r.managerKeys, hasExternalOnlyManager: r.hasExternalOnlyManager },
    appUserId: null,
  }
}

describe('Decision OS Increment 4 — Sleeper imported-activity emitter', () => {
  describe('trade transaction → imported activity row → behavioral event (Deliverable)', () => {
    it('end to end: emit → normalize → write → persisted row → BehavioralEvent → league facts', async () => {
      const store = new InMemoryImportedActivityStore()
      const result = await ingestSleeperImportedActivity(
        { leagueId: 'sleeper_league_1', transactions: [tradeTx], rosters },
        identityIndex,
        store,
      )
      expect(result.writer.created).toBe(1)
      expect(result.writer.persistedByActivityType.trade).toBe(1)
      expect(result.emitterSkipped).toEqual([])
      expect(result.normalizerSkipped).toEqual([])

      const persisted = await store.getByNaturalKey('dos:act:sleeper:sleeper_league_1:trade:txn_trade_1')
      expect(persisted).not.toBeNull()
      expect(persisted!.managerKeys).toEqual(['af_1', 'sleeper:user:sleeper_owner_2']) // both sides attributed
      expect(persisted!.hasExternalOnlyManager).toBe(true)

      const { events } = mapImportedActivityRowsToEvents([toEventRow(persisted!)])
      expect(events).toHaveLength(2) // proposer trade_created + counterparty trade_accepted
      expect(events.map((e) => e.eventType).sort()).toEqual(['trade_accepted', 'trade_created'])

      const facts = assembleLeagueBehavioralFacts({ leagueId: 'sleeper_league_1', events })
      expect(facts.totalTradeCount).toBe(1) // one league trade, not double-counted
      expect(facts.activeManagerIds.sort()).toEqual(['af_1', 'sleeper:user:sleeper_owner_2'])
    })
  })

  describe('waiver transaction → imported activity row → behavioral event (Deliverable)', () => {
    it('end to end for a waiver claim', async () => {
      const store = new InMemoryImportedActivityStore()
      const result = await ingestSleeperImportedActivity(
        { leagueId: 'sleeper_league_1', transactions: [waiverTx], rosters },
        identityIndex,
        store,
      )
      expect(result.writer.created).toBe(1)
      expect(result.writer.persistedByActivityType.waiver).toBe(1)

      const persisted = await store.getByNaturalKey('dos:act:sleeper:sleeper_league_1:waiver:txn_waiver_1')
      const { events } = mapImportedActivityRowsToEvents([toEventRow(persisted!)])
      expect(events).toHaveLength(1)
      expect(events[0].eventType).toBe('waiver_claim_created')
      expect(events[0].managerId).toBe('sleeper:user:sleeper_owner_2')

      const facts = assembleLeagueBehavioralFacts({ leagueId: 'sleeper_league_1', events })
      expect(facts.totalWaiverClaimCount).toBe(1)
    })
  })

  describe('idempotent repeated ingestion (Do #10)', () => {
    it('re-ingesting the same Sleeper payload converges to a stable row count', async () => {
      const store = new InMemoryImportedActivityStore()
      const input = { leagueId: 'sleeper_league_1', transactions: [tradeTx, waiverTx], rosters }

      const run1 = await ingestSleeperImportedActivity(input, identityIndex, store)
      expect(run1.writer.created).toBe(2)
      expect(await store.count()).toBe(2)

      const run2 = await ingestSleeperImportedActivity(input, identityIndex, store)
      expect(run2.writer.created).toBe(0)
      expect(run2.writer.updated).toBe(2)
      expect(await store.count()).toBe(2) // stable — no duplicates

      const run3 = await ingestSleeperImportedActivity(input, identityIndex, store)
      expect(await store.count()).toBe(2) // still stable on a third pass
      void run3
    })
  })

  describe('external-only managers remain supported (Do #11)', () => {
    it('a waiver by a manager with no AllFantasy account persists and is attributable', async () => {
      const store = new InMemoryImportedActivityStore()
      await ingestSleeperImportedActivity({ leagueId: 'L', transactions: [waiverTx], rosters }, identityIndex, store)
      const persisted = await store.getByNaturalKey('dos:act:sleeper:L:waiver:txn_waiver_1')
      expect(persisted?.managerKeys).toEqual(['sleeper:user:sleeper_owner_2'])
      expect(persisted?.hasExternalOnlyManager).toBe(true)
    })

    it('an orphan roster (no owner_id) never fabricates a manager attribution', () => {
      const rosterOwnerMap = buildRosterOwnerMap(rosters)
      expect(rosterOwnerMap.get(3)).toBeNull()
    })
  })

  describe('honest degradation — unsupported / not-complete / ambiguous (Do #9)', () => {
    it('skips an unsupported Sleeper transaction type with a clear reason', () => {
      const commissionerTx: SleeperTransactionRaw = { transaction_id: 'c1', type: 'commissioner', status: 'complete', created: 1735689600000, roster_ids: [1] }
      const { raws, skipped } = emitSleeperTransactionActivity([commissionerTx], { leagueId: 'L', rosterOwnerMap: buildRosterOwnerMap(rosters) })
      expect(raws).toEqual([])
      expect(skipped).toEqual([{ providerEventId: 'c1', reason: 'UNSUPPORTED_TRANSACTION_TYPE' }])
    })

    it('skips a non-complete (pending/vetoed) transaction — never treats it as having happened', () => {
      const pendingTx: SleeperTransactionRaw = { transaction_id: 'p1', type: 'trade', status: 'pending', created: 1735689600000, roster_ids: [1, 2] }
      const { raws, skipped } = emitSleeperTransactionActivity([pendingTx], { leagueId: 'L', rosterOwnerMap: buildRosterOwnerMap(rosters) })
      expect(raws).toEqual([])
      expect(skipped).toEqual([{ providerEventId: 'p1', reason: 'TRANSACTION_NOT_COMPLETE' }])
    })

    it('a transaction with no rosters involved is emitted but the NORMALIZER skips it (no attributable manager) — never fabricated', () => {
      const orphanTx: SleeperTransactionRaw = { transaction_id: 'o1', type: 'waiver', status: 'complete', created: 1735689600000, roster_ids: [] }
      const { raws, skipped: emitterSkipped } = emitSleeperTransactionActivity([orphanTx], { leagueId: 'L', rosterOwnerMap: buildRosterOwnerMap(rosters) })
      expect(emitterSkipped).toEqual([])
      expect(raws).toHaveLength(1)
      expect(raws[0].managerSourceIds).toEqual([])
    })

    it('skips a draft pick with no draft_id or season — ambiguous natural key, never guessed', () => {
      const ambiguousPick: SleeperDraftPickRaw = { round: 1, roster_id: 1, player_id: '4046', pick_no: 1 }
      const { raws, skipped } = emitSleeperDraftPickActivity([ambiguousPick], { leagueId: 'L', rosterOwnerMap: buildRosterOwnerMap(rosters), occurredAt: '2025-08-01T00:00:00Z' })
      expect(raws).toEqual([])
      expect(skipped).toEqual([{ providerEventId: null, reason: 'MISSING_DRAFT_CONTEXT' }])
    })

    it('a draft pick with real context but NO caller-supplied timestamp is passed through with occurredAt null (never fabricated) and the normalizer skips it', async () => {
      const pick: SleeperDraftPickRaw = { round: 1, roster_id: 1, player_id: '4046', pick_no: 1, draft_id: 'draft_123', picked_by: 'sleeper_owner_1' }
      const store = new InMemoryImportedActivityStore()
      const result = await ingestSleeperImportedActivity(
        { leagueId: 'L', draftPicks: [pick], rosters, draftPicksOccurredAt: null },
        identityIndex,
        store,
      )
      expect(result.writer.created).toBe(0)
      expect(result.normalizerSkipped).toEqual([{ skipped: true, reason: 'MISSING_OCCURRED_AT', provider: 'sleeper', leagueId: 'L', activityType: 'draft_pick' }])
    })

    it('a draft pick WITH a real supplied timestamp persists correctly (draft_pick_made)', async () => {
      // providerEventId is `${draft_id}:${pick_no}` = 'draft_123:1'; the natural key escapes the
      // embedded ':' (collision-safety proven in Increment 1) — so look the row up via the store's
      // snapshot rather than hand-guessing the escaped key string.
      const pick: SleeperDraftPickRaw = { round: 1, roster_id: 1, player_id: '4046', pick_no: 1, draft_id: 'draft_123', picked_by: 'sleeper_owner_1' }
      const store = new InMemoryImportedActivityStore()
      const result = await ingestSleeperImportedActivity(
        { leagueId: 'L', draftPicks: [pick], rosters, draftPicksOccurredAt: '2025-08-01T00:00:00.000Z' },
        identityIndex,
        store,
      )
      expect(result.writer.created).toBe(1)
      const [persisted] = store.snapshot()
      expect(persisted.activityType).toBe('draft_pick')
      expect(persisted.naturalKey.startsWith('dos:act:sleeper:L:draft_pick:draft_123')).toBe(true)
      expect(persisted.managerKeys).toEqual(['af_1'])
    })
  })
})
