import { describe, it, expect } from 'vitest'
import type { ExternalIdentityMapping } from '@/lib/league-import/types'
import {
  buildManagerIdentityIndex,
  normalizeImportedActivityBatch,
  type RawImportedActivity,
} from '@/lib/decision-os/ingestion/importedActivityNormalizer'
import { toPersistedActivityRecord } from '@/lib/decision-os/ingestion/importedActivityStore'
import {
  PrismaImportedActivityStore,
  toImportedActivityCreateInput,
  type DecisionOsImportedActivityDelegate,
  type DecisionOsImportedActivityRow,
} from '@/lib/decision-os/ingestion/prismaImportedActivityStore'
import {
  mapImportedActivityRowsToEvents,
  type ImportedActivityEventRow,
} from '@/lib/decision-os/behavioral/importedActivityToEvents'
import { assembleLeagueBehavioralFacts } from '@/lib/decision-os/behavioral/assemble'
import type { BehavioralEvent } from '@/lib/decision-os/behavioral/events/types'

// ── Fake Prisma delegate (in-memory, keyed on the unique externalSourceKey) ──────
class FakeDelegate implements DecisionOsImportedActivityDelegate {
  rows = new Map<string, DecisionOsImportedActivityRow>()
  async findUnique({ where }: { where: { externalSourceKey: string } }) {
    return this.rows.get(where.externalSourceKey) ?? null
  }
  async upsert({ where, create, update }: {
    where: { externalSourceKey: string }
    create: Omit<DecisionOsImportedActivityRow, 'createdAt' | 'updatedAt'>
    update: Omit<DecisionOsImportedActivityRow, 'createdAt' | 'updatedAt' | 'externalSourceKey'>
  }): Promise<DecisionOsImportedActivityRow> {
    const now = new Date()
    const existing = this.rows.get(where.externalSourceKey)
    const row: DecisionOsImportedActivityRow = existing
      ? { ...existing, ...update, updatedAt: now }
      : { ...create, createdAt: now, updatedAt: now }
    this.rows.set(where.externalSourceKey, row)
    return row
  }
  async count() {
    return this.rows.size
  }
}

const afManager: ExternalIdentityMapping = { source_provider: 'sleeper', source_id: 's1', entity_type: 'manager', af_id: 'af_1' }
const externalOnly: ExternalIdentityMapping = { source_provider: 'sleeper', source_id: 's2', entity_type: 'manager', af_id: null, stable_key: 'sleeper:user:2' }
const index = buildManagerIdentityIndex([afManager, externalOnly])

function normalizedFrom(raws: RawImportedActivity[]) {
  return normalizeImportedActivityBatch(raws, index).normalized
}

describe('Decision OS Increment 3 — Prisma persistence + behavioral read', () => {
  describe('idempotent Prisma-adapter persistence (Deliverable: no duplicate rows)', () => {
    it('re-ingesting the same activity updates the row instead of inserting a duplicate', async () => {
      const store = new PrismaImportedActivityStore(new FakeDelegate())
      const records = normalizedFrom([
        { provider: 'sleeper', leagueId: 'L1', activityType: 'trade', providerEventId: 'txn_1', occurredAt: '2026-01-01T00:00:00Z', managerSourceIds: ['s1', 's2'] },
        { provider: 'sleeper', leagueId: 'L1', activityType: 'waiver', providerEventId: 'wv_1', occurredAt: '2026-01-02T00:00:00Z', managerSourceIds: ['s2'] },
      ])
      for (const r of records) expect((await store.upsertByNaturalKey(toPersistedActivityRecord(r))).status).toBe('created')
      expect(await store.count()).toBe(2)

      // second full pass
      for (const r of records) expect((await store.upsertByNaturalKey(toPersistedActivityRecord(r))).status).toBe('updated')
      expect(await store.count()).toBe(2) // converged, no duplication
    })

    it('external-only managers persist without an AppUser (appUserId stays null; stable_key attribution retained)', async () => {
      const delegate = new FakeDelegate()
      const store = new PrismaImportedActivityStore(delegate)
      const [rec] = normalizedFrom([
        { provider: 'sleeper', leagueId: 'L1', activityType: 'waiver', providerEventId: 'wv_ext', occurredAt: '2026-01-05T00:00:00Z', managerSourceIds: ['s2'] },
      ])
      await store.upsertByNaturalKey(toPersistedActivityRecord(rec))

      const persisted = await store.getByNaturalKey('dos:act:sleeper:L1:waiver:wv_ext')
      expect(persisted?.managerKeys).toEqual(['sleeper:user:2'])
      expect(persisted?.hasExternalOnlyManager).toBe(true)
      const row = delegate.rows.get('dos:act:sleeper:L1:waiver:wv_ext')!
      expect(row.appUserId).toBeNull() // no AppUser fabricated
      expect((row.normalized as { managerKeys: string[] }).managerKeys).toEqual(['sleeper:user:2'])
    })

    it('toImportedActivityCreateInput never fabricates AF ids (afLeagueId/appUserId/rosterId are null)', () => {
      const [rec] = normalizedFrom([
        { provider: 'sleeper', leagueId: 'L1', activityType: 'trade', providerEventId: 't', occurredAt: '2026-01-01T00:00:00Z', managerSourceIds: ['s2'] },
      ])
      const input = toImportedActivityCreateInput(toPersistedActivityRecord(rec))
      expect(input).toMatchObject({ externalSourceKey: 'dos:act:sleeper:L1:trade:t', afLeagueId: null, appUserId: null, rosterId: null })
    })
  })

  describe('imported activity appears in behavioral facts (Deliverable)', () => {
    function importedRows(): ImportedActivityEventRow[] {
      return [
        { externalSourceKey: 'k_trade', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'trade', occurredAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', normalized: { managerKeys: ['af_1', 'sleeper:user:2'], hasExternalOnlyManager: true }, appUserId: null },
        { externalSourceKey: 'k_waiver', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'waiver', occurredAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-02T00:00:00Z', normalized: { managerKeys: ['sleeper:user:2'] }, appUserId: null },
        { externalSourceKey: 'k_draft', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'draft_pick', occurredAt: '2026-01-03T00:00:00Z', createdAt: '2026-01-03T00:00:00Z', normalized: { managerKeys: ['af_1'] }, appUserId: null },
      ]
    }

    it('a 2-manager trade counts once at league level but attributes BOTH managers; external-only manager surfaces', () => {
      const { events } = mapImportedActivityRowsToEvents(importedRows())
      const facts = assembleLeagueBehavioralFacts({ leagueId: 'L1', events })

      expect(facts.totalTradeCount).toBe(1) // proposer trade_created only — not double counted
      expect(facts.totalWaiverClaimCount).toBe(1)
      expect(facts.totalDraftPickCount).toBe(1)
      // both trade managers + the waiver manager are active; external-only key is present
      expect(facts.activeManagerIds.sort()).toEqual(['af_1', 'sleeper:user:2'])
      expect(facts.eventCount).toBeGreaterThan(0)
    })
  })

  describe('AF-native behavior remains unchanged (additive)', () => {
    it('imported events add to, and never overwrite, AF-native counts', () => {
      const afNative: BehavioralEvent[] = [
        // A native trade_created (source: api) — the existing pipeline's shape.
        { eventId: 'af_t', eventType: 'trade_created', occurredAt: '2026-01-01T00:00:00Z', recordedAt: '2026-01-01T00:00:00Z', leagueId: 'L1', managerId: 'af_native_mgr', source: 'api', provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: [] }, completeness: 100, uncertainty: { sources: [], timestampConfidence: 'exact', actorConfidence: 'confirmed' }, metadata: { proposalId: 'p', proposerRosterId: 'r1', receiverRosterId: 'r2', assetCount: 2, vetoMode: null, expiresAt: null } },
      ]
      const nativeOnly = assembleLeagueBehavioralFacts({ leagueId: 'L1', events: afNative })
      expect(nativeOnly.totalTradeCount).toBe(1)

      const { events: imported } = mapImportedActivityRowsToEvents([
        { externalSourceKey: 'k', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'trade', occurredAt: '2026-02-01T00:00:00Z', createdAt: '2026-02-01T00:00:00Z', normalized: { managerKeys: ['sleeper:user:2', 'sleeper:user:9'] }, appUserId: null },
      ])
      const combined = assembleLeagueBehavioralFacts({ leagueId: 'L1', events: [...afNative, ...imported] })
      expect(combined.totalTradeCount).toBe(2) // 1 native + 1 imported (not doubled, not lost)
      expect(combined.activeManagerIds).toContain('af_native_mgr') // native manager preserved
      expect(combined.activeManagerIds).toContain('sleeper:user:2') // external manager added
    })

    it('empty imported rows contribute nothing (wiring is a no-op without imported activity)', () => {
      expect(mapImportedActivityRowsToEvents([]).events).toEqual([])
    })
  })

  describe('honest degradation (unrepresentable activity is skipped, not faked)', () => {
    it('skips unknown activity types, missing managers, and bad timestamps with reasons', () => {
      const { events, skipped } = mapImportedActivityRowsToEvents([
        { externalSourceKey: 'k1', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'commissioner_veto', occurredAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', normalized: { managerKeys: ['af_1'] }, appUserId: null },
        { externalSourceKey: 'k2', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'waiver', occurredAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', normalized: { managerKeys: [] }, appUserId: null },
        { externalSourceKey: 'k3', provider: 'sleeper', afLeagueId: null, providerLeagueId: 'L1', activityType: 'trade', occurredAt: 'not-a-date', createdAt: '2026-01-01T00:00:00Z', normalized: { managerKeys: ['af_1'] }, appUserId: null },
      ])
      expect(events).toEqual([])
      expect(skipped.map((s) => s.reason).sort()).toEqual(['BAD_TIMESTAMP', 'NO_MANAGER_KEYS', 'UNKNOWN_ACTIVITY_TYPE'])
    })
  })
})
