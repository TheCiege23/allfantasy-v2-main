import 'server-only'
import crypto from 'node:crypto'
/**
 * Fantasy OS Phase 5B — Sleeper runtime scope fetchers + orchestrator (Parts 4–5).
 *
 * Connects the verified Sleeper adapter (via the gateway) to the existing Phase 4 season-aware runner. The
 * `players` scope: gateway fetch → normalize → resolve identity → diff vs last certified snapshot → persist
 * changed records → emit only changed events → certify → runner advances checkpoint + freshness on success.
 * No unrestricted historical discovery.
 */
import { runSync, type ScopeFetchResult, type ScopeFetcher, type SyncStore, type RunResult } from '@/lib/fantasy-os/sync/runner'
import { resolveSeasonState } from '@/lib/fantasy-os/sync/season'
import { SportsDataGateway } from '../gateway'
import { SleeperAdapter } from '../providers/sleeper'
import { resolveIdentity, type MappingSource } from '../resolution'
import type { ProviderPriorityRule } from '../selection'
import type { CanonicalPlayer } from '../contracts'
import { SportsRuntimeStore, asSyncLock, asSyncStore } from './store'
import { canonicalKeyFor, recordContentHash } from './checksum'
import { countSnapshot, type SnapshotDraft, type SnapshotRecordDraft } from './snapshot'
import { diffSnapshot } from './events'

const RULES: ProviderPriorityRule[] = [
  { sport: 'NFL', capability: 'players', primary: 'sleeper', fallbacks: [], minimumFreshnessMinutes: 30 },
]

export function buildGateway(lastSuccessfulSyncAt: string | null): SportsDataGateway {
  return new SportsDataGateway([new SleeperAdapter()], { rules: RULES, lastSuccessfulSyncAt })
}

/** ScopeFetcher for `players`: one logical gateway request; returns canonical players as records. */
export function makeSleeperPlayersFetcher(gateway: SportsDataGateway, limit: number): ScopeFetcher {
  return async (_scope, _checkpoint, _now): Promise<ScopeFetchResult> => {
    const read = await gateway.getPlayers({ sport: 'NFL', limit })
    if (!read.result.ok) throw new Error(`players fetch failed: ${read.result.error.code} ${read.result.error.message}`)
    const players = read.result.data
    const records = players.map((p) => ({ id: canonicalKeyFor(p), __player: p }))
    return { records, nextCheckpoint: read.result.snapshotVersion, attempts: 1, logical: 1, notFound: 0, cacheHits: 0 }
  }
}

/** persistScope for `players`: resolve → build certifiable snapshot → diff vs previous → persist + emit events. */
export function makePlayersPersistScope(store: SportsRuntimeStore, mappingSource: MappingSource): SyncStore['persistScope'] {
  return async (_runKey, _scope, records) => {
    const now = new Date().toISOString()
    const drafts: SnapshotRecordDraft[] = (records as { id: string; __player: CanonicalPlayer }[]).map(({ __player: p }) => {
      const resolution = resolveIdentity(
        {
          provider: p.source.primaryProvider,
          providerId: p.providerIds[p.source.primaryProvider] ?? p.source.providerRecordId,
          sport: p.sport,
          team: p.teamId,
          position: p.position,
          displayName: p.displayName,
          birthDate: (p.metadata?.birthDate as string | null) ?? null,
        },
        mappingSource,
      )
      const canonicalRecord = { ...p, canonicalPlayerId: resolution.canonicalPlayerId ?? canonicalKeyFor(p) }
      return {
        canonicalKey: canonicalKeyFor(p),
        resolutionStatus: resolution.status,
        contentHash: recordContentHash(canonicalRecord),
        record: canonicalRecord,
        schemaValid: Boolean(p.displayName),
      }
    })

    const version = `nfl-players-${now.slice(0, 10)}`
    const { snapshotId: prevId, hashes: prevHashes } = await store.previousCertifiedHashes('NFL', 'players')
    // Deterministic snapshot id from the content checksum → reruns with identical data create no new snapshot.
    const checksumKey = drafts.map((d) => `${d.canonicalKey}:${d.contentHash}`).sort().join('|')
    const snapshotId = `nfl-players-${crypto.createHash('sha256').update(checksumKey).digest('hex').slice(0, 24)}`

    const draft: SnapshotDraft = {
      snapshotId,
      version,
      sport: 'NFL',
      capability: 'players',
      provider: 'sleeper',
      generatedAt: now,
      sourceUpdatedAt: null,
      records: drafts,
      rejectedCount: drafts.filter((d) => !d.schemaValid).length,
      runPartial: false,
      scopeComplete: true,
      previousSnapshotId: prevId,
      limitations: drafts.some((d) => !d.schemaValid) ? ['Some provider records lacked a usable name and were rejected.'] : [],
    }

    const persisted = await store.persistCertifiedSnapshot(draft)
    if (!persisted.certified) throw new Error(`snapshot not certifiable: ${(persisted.reasons ?? []).join('; ')}`)

    const diff = diffSnapshot(draft.records, prevHashes, { eventType: 'player_status_changed', sport: 'NFL', snapshotVersion: version })
    await store.insertEvents(diff.events, { sport: 'NFL', provider: 'sleeper', snapshotVersion: version, occurredAt: now })

    const counts = countSnapshot(draft)
    return { imported: diff.added + diff.changed, unchanged: diff.unchangedSuppressed, rejected: counts.rejectedCount }
  }
}

/** Run one season-aware Sleeper players sync through the real Phase 4 runner. */
export async function runSleeperPlayersSync(opts: { limit: number; mappingSource: MappingSource; runKey?: string }): Promise<RunResult> {
  const runKey = opts.runKey ?? 'sports:nfl:players'
  const store = new SportsRuntimeStore()
  const gateway = buildGateway(await store.getLastSuccessfulSyncAt(runKey))
  const { state: seasonState } = resolveSeasonState({ sport: 'nfl', provider: 'sleeper', now: new Date() })
  const persistScope = makePlayersPersistScope(store, opts.mappingSource)

  return runSync({
    runKey,
    seasonState,
    scopes: ['players'],
    lock: asSyncLock(store),
    store: asSyncStore(store, persistScope),
    clock: { now: () => new Date() },
    rng: { next: () => Math.random() },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fetchScope: makeSleeperPlayersFetcher(gateway, opts.limit),
    leaseMs: 60_000,
    maxRetries: 2,
    runTimeoutMs: 60_000,
  })
}
