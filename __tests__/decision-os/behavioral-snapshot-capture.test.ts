import { describe, it, expect } from 'vitest'
import type { ExternalIdentityMapping } from '@/lib/league-import/types'
import type { SleeperTransactionRaw, SleeperRosterRaw } from '@/lib/league-import/adapters/sleeper/types'
import { buildManagerIdentityIndex } from '@/lib/decision-os/ingestion/importedActivityNormalizer'
import { InMemoryImportedActivityStore } from '@/lib/decision-os/ingestion/importedActivityStore'
import { ingestSleeperImportedActivity } from '@/lib/decision-os/ingestion/sleeperActivityEmitter'
import { mapImportedActivityRowsToEvents, type ImportedActivityEventRow } from '@/lib/decision-os/behavioral/importedActivityToEvents'
import type { BehavioralEvent } from '@/lib/decision-os/behavioral/events/types'
import {
  captureLeagueBehavioralSnapshot,
  captureBehavioralSnapshots,
  derivePeriodKey,
} from '@/lib/decision-os/snapshot/behavioralSnapshotCapture'
import { InMemoryBehavioralSnapshotStore } from '@/lib/decision-os/snapshot/behavioralSnapshotStore'
import { captureAndWriteBehavioralSnapshots } from '@/lib/decision-os/snapshot/behavioralSnapshotWriter'
import { deriveBehavioralTrend, deriveEventCountDelta } from '@/lib/decision-os/snapshot/behavioralTrend'
import {
  PrismaBehavioralSnapshotStore,
  toBehavioralSnapshotCreateInput,
  LEAGUE_SCOPE_SENTINEL,
  type DecisionOsBehavioralSnapshotDelegate,
  type DecisionOsBehavioralSnapshotRow,
} from '@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore'

const day1 = new Date('2026-07-08T12:00:00.000Z')
const day2 = new Date('2026-07-09T09:00:00.000Z')

function nativeTrade(managerId: string, occurredAt: string): BehavioralEvent {
  return {
    eventId: `e_${managerId}_${occurredAt}`,
    eventType: 'trade_created',
    occurredAt,
    recordedAt: occurredAt,
    leagueId: 'L1',
    managerId,
    source: 'api',
    provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: [] },
    completeness: 100,
    uncertainty: { sources: [], timestampConfidence: 'exact', actorConfidence: 'confirmed' },
    metadata: { proposalId: 'p1', proposerRosterId: 'r1', receiverRosterId: 'r2', assetCount: 1, vetoMode: null, expiresAt: null },
  }
}

describe('Decision OS Increment 5 — behavioral snapshot capture + trend history', () => {
  describe('cadence assumption', () => {
    it('buckets by UTC calendar day for the daily cadence', () => {
      expect(derivePeriodKey(new Date('2026-07-08T00:00:00.001Z'))).toBe('2026-07-08')
      expect(derivePeriodKey(new Date('2026-07-08T23:59:59.999Z'))).toBe('2026-07-08')
      expect(derivePeriodKey(new Date('2026-07-09T00:00:00.000Z'))).toBe('2026-07-09')
    })
  })

  describe('deterministic pure capture (idempotency at the capture layer)', () => {
    it('the same events + capturedAt ALWAYS produce a structurally identical snapshot', () => {
      const events = [nativeTrade('af_1', '2026-07-08T10:00:00.000Z')]
      const a = captureLeagueBehavioralSnapshot({ leagueId: 'L1', events, capturedAt: day1 })
      const b = captureLeagueBehavioralSnapshot({ leagueId: 'L1', events, capturedAt: day1 })
      expect(a).toEqual(b)
    })
  })

  describe('empty-data behavior (Requirement: prove empty-data behavior)', () => {
    it('an empty event stream yields an honestly-zeroed league snapshot and ZERO manager snapshots', () => {
      const { league, managers } = captureBehavioralSnapshots({ leagueId: 'L_empty', events: [], capturedAt: day1 })
      expect(league.eventCount).toBe(0)
      expect(league.completeness).toBe(0)
      expect(league.facts.warnings).toContain('no_events')
      expect(league.facts.totalTradeCount).toBe(0)
      expect(managers).toEqual([]) // never fabricates a manager for a quiet league
    })
  })

  describe('idempotent store persistence + re-run safety (Requirements)', () => {
    it('re-running capture+write for the SAME period converges to one row per scope (no duplicates)', async () => {
      const store = new InMemoryBehavioralSnapshotStore()
      const events = [nativeTrade('af_1', '2026-07-08T10:00:00.000Z'), nativeTrade('af_2', '2026-07-08T11:00:00.000Z')]
      const input = { leagueId: 'L1', events, capturedAt: day1 }

      const run1 = await captureAndWriteBehavioralSnapshots(input, store)
      expect(run1.created).toBe(3) // 1 league + 2 managers
      expect(await store.count()).toBe(3)

      const run2 = await captureAndWriteBehavioralSnapshots(input, store)
      expect(run2.updated).toBe(3)
      expect(run2.created).toBe(0)
      expect(await store.count()).toBe(3) // stable — re-run safe

      const run3 = await captureAndWriteBehavioralSnapshots(input, store)
      expect(await store.count()).toBe(3) // still stable on a third pass
      void run3
    })

    it('a NEW period (a later day) appends new rows instead of overwriting — this IS the trend history', async () => {
      const store = new InMemoryBehavioralSnapshotStore()
      await captureAndWriteBehavioralSnapshots({ leagueId: 'L1', events: [nativeTrade('af_1', '2026-07-08T10:00:00.000Z')], capturedAt: day1 }, store)
      await captureAndWriteBehavioralSnapshots({ leagueId: 'L1', events: [nativeTrade('af_1', '2026-07-08T10:00:00.000Z'), nativeTrade('af_1', '2026-07-09T08:00:00.000Z')], capturedAt: day2 }, store)

      const leagueTrend = await store.listTrend({ leagueId: 'L1' }) // league scope
      expect(leagueTrend.map((r) => r.periodKey)).toEqual(['2026-07-08', '2026-07-09'])

      const managerTrend = await store.listTrend({ leagueId: 'L1', managerId: 'af_1' })
      expect(managerTrend.map((r) => r.periodKey)).toEqual(['2026-07-08', '2026-07-09']) // the manager's own trend grows too

      // 2 periods x 2 scopes (league + the one active manager) = 4 distinct rows, no duplicates.
      expect(await store.count()).toBe(4)
    })
  })

  describe('trend derivation (Requirement: add trend derivation tests)', () => {
    it('derives a chronological trend and an honest delta across periods', async () => {
      const store = new InMemoryBehavioralSnapshotStore()
      await captureAndWriteBehavioralSnapshots({ leagueId: 'L1', events: [nativeTrade('af_1', '2026-07-08T10:00:00.000Z')], capturedAt: day1 }, store)
      await captureAndWriteBehavioralSnapshots({ leagueId: 'L1', events: [nativeTrade('af_1', '2026-07-08T10:00:00.000Z'), nativeTrade('af_1', '2026-07-09T08:00:00.000Z')], capturedAt: day2 }, store)

      const leagueRows = await store.listTrend({ leagueId: 'L1' })
      const trend = deriveBehavioralTrend(leagueRows)
      expect(trend.map((p) => p.periodKey)).toEqual(['2026-07-08', '2026-07-09'])
      expect(trend[0].eventCount).toBe(1)
      expect(trend[1].eventCount).toBe(2)
      expect(deriveEventCountDelta(trend)).toBe(1)
    })

    it('dedupes by periodKey (last write wins) and never fabricates a point for empty input', () => {
      const s1 = captureLeagueBehavioralSnapshot({ leagueId: 'L1', events: [], capturedAt: day1 })
      const s2 = captureLeagueBehavioralSnapshot({ leagueId: 'L1', events: [nativeTrade('af_1', '2026-07-08T10:00:00.000Z')], capturedAt: day1 })
      const trend = deriveBehavioralTrend([s1, s2]) // same periodKey twice
      expect(trend).toHaveLength(1)
      expect(trend[0].eventCount).toBe(1) // last write (s2) wins

      expect(deriveBehavioralTrend([])).toEqual([])
      expect(deriveEventCountDelta([])).toBeNull()
    })
  })

  describe('Prisma adapter idempotency (Requirement: prove idempotency at the persistence layer)', () => {
    class FakeSnapshotDelegate implements DecisionOsBehavioralSnapshotDelegate {
      rows = new Map<string, DecisionOsBehavioralSnapshotRow>()
      private key(leagueId: string, managerId: string, periodKey: string) {
        return `${leagueId}::${managerId}::${periodKey}`
      }
      async findUnique({ where }: Parameters<DecisionOsBehavioralSnapshotDelegate['findUnique']>[0]) {
        const k = this.key(where.leagueId_managerId_periodKey.leagueId, where.leagueId_managerId_periodKey.managerId, where.leagueId_managerId_periodKey.periodKey)
        return this.rows.has(k) ? { id: k } : null
      }
      async upsert({ where, create, update }: Parameters<DecisionOsBehavioralSnapshotDelegate['upsert']>[0]) {
        const k = this.key(where.leagueId_managerId_periodKey.leagueId, where.leagueId_managerId_periodKey.managerId, where.leagueId_managerId_periodKey.periodKey)
        const now = new Date()
        const existing = this.rows.get(k)
        const row: DecisionOsBehavioralSnapshotRow = existing
          ? { ...existing, ...update, updatedAt: now }
          : { ...create, createdAt: now, updatedAt: now }
        this.rows.set(k, row)
        return row
      }
      async findMany({ where, take }: Parameters<DecisionOsBehavioralSnapshotDelegate['findMany']>[0]) {
        const rows = [...this.rows.values()]
          .filter((r) => r.leagueId === where.leagueId && r.managerId === where.managerId)
          .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
        return typeof take === 'number' ? rows.slice(-take) : rows
      }
      async count() {
        return this.rows.size
      }
    }

    it('upsertByPeriod converges to one row on re-ingest; league-scope uses the non-null sentinel', async () => {
      const delegate = new FakeSnapshotDelegate()
      const store = new PrismaBehavioralSnapshotStore(delegate)
      const league = captureLeagueBehavioralSnapshot({ leagueId: 'L1', events: [nativeTrade('af_1', '2026-07-08T10:00:00.000Z')], capturedAt: day1 })

      expect((await store.upsertByPeriod(league)).status).toBe('created')
      expect((await store.upsertByPeriod(league)).status).toBe('updated')
      expect(await store.count()).toBe(1) // converged, no duplicate

      const [row] = [...delegate.rows.values()]
      expect(row.managerId).toBe(LEAGUE_SCOPE_SENTINEL) // never a raw null in the DB column

      const trend = await store.listTrend({ leagueId: 'L1' }) // managerId omitted = league scope
      expect(trend).toHaveLength(1)
      expect(trend[0].managerId).toBeNull() // domain layer sees null, not the sentinel
    })

    it('toBehavioralSnapshotCreateInput never fabricates ids and preserves the raw facts payload', () => {
      const league = captureLeagueBehavioralSnapshot({ leagueId: 'L1', events: [], capturedAt: day1 })
      const input = toBehavioralSnapshotCreateInput(league)
      expect(input.managerId).toBe(LEAGUE_SCOPE_SENTINEL)
      expect(input.leagueId).toBe('L1')
      expect(input.eventCount).toBe(0)
    })
  })

  describe('Sleeper preserved as the first validation source (end-to-end: Sleeper → imported activity → BehavioralEvent → snapshot)', () => {
    const rosters: SleeperRosterRaw[] = [
      { roster_id: 1, owner_id: 'sleeper_owner_1' }, // AF-linked
      { roster_id: 2, owner_id: 'sleeper_owner_2' }, // external-only, no AF account
    ]
    const tradeTx: SleeperTransactionRaw = {
      transaction_id: 'txn_trade_snap_1',
      type: 'trade',
      status: 'complete',
      created: 1735689600000,
      roster_ids: [1, 2],
    }
    const afManager: ExternalIdentityMapping = { source_provider: 'sleeper', source_id: 'sleeper_owner_1', entity_type: 'manager', af_id: 'af_1' }
    const externalOnly: ExternalIdentityMapping = { source_provider: 'sleeper', source_id: 'sleeper_owner_2', entity_type: 'manager', af_id: null, stable_key: 'sleeper:user:sleeper_owner_2' }
    const identityIndex = buildManagerIdentityIndex([afManager, externalOnly])

    it('a real Sleeper trade produces a league snapshot with the correct trade count and BOTH managers, including the external-only one', async () => {
      const activityStore = new InMemoryImportedActivityStore()
      await ingestSleeperImportedActivity({ providerLeagueId: 'sleeper_league_1', transactions: [tradeTx], rosters }, identityIndex, activityStore)

      const persisted = activityStore.snapshot()
      const eventRows: ImportedActivityEventRow[] = persisted.map((r) => ({
        externalSourceKey: r.naturalKey,
        provider: r.provider,
        afLeagueId: null,
        providerLeagueId: r.leagueId,
        activityType: r.activityType,
        occurredAt: r.occurredAt,
        createdAt: r.occurredAt,
        normalized: { managerKeys: r.managerKeys, hasExternalOnlyManager: r.hasExternalOnlyManager },
        appUserId: null,
      }))
      const { events } = mapImportedActivityRowsToEvents(eventRows)

      const snapshotStore = new InMemoryBehavioralSnapshotStore()
      const summary = await captureAndWriteBehavioralSnapshots({ leagueId: 'sleeper_league_1', events, capturedAt: day1 }, snapshotStore)

      expect(summary.managerCount).toBe(2) // both trade participants snapshotted
      const leagueTrend = await snapshotStore.listTrend({ leagueId: 'sleeper_league_1' })
      expect(leagueTrend[0].facts.totalTradeCount).toBe(1) // not double-counted (proposer+acceptor collapse to 1 league trade)
      expect(leagueTrend[0].facts.activeManagerIds.sort()).toEqual(['af_1', 'sleeper:user:sleeper_owner_2'])

      const externalManagerTrend = await snapshotStore.listTrend({ leagueId: 'sleeper_league_1', managerId: 'sleeper:user:sleeper_owner_2' })
      expect(externalManagerTrend).toHaveLength(1) // the external-only manager gets their own trend row, no AF account needed
    })
  })
})
