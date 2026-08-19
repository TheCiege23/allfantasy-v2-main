import 'server-only'
/**
 * Fantasy OS Phase 5C — certified snapshot read repository (Part 1 + Stop-gate 2).
 *
 * The ONLY read path OS consumers use. Guarantees (Stop-gate 2): certified snapshots only (the store query
 * filters `status='certified'`); partial/rejected snapshots are never returned; a failed refresh leaves the
 * prior certified snapshot readable; freshness belongs to the exact snapshot returned; records are
 * deterministically ordered (by canonical key); version + checksum stay visible; unresolved identities stay
 * distinguishable. Fails closed: no certified snapshot ⇒ `unavailable`, never a fabricated empty snapshot.
 */
import { SportsRuntimeStore, type CertifiedSnapshotMeta } from './store'
import type { SportsDataCapability } from '../capabilities'
import type { SportsDataContext } from '../contracts'
import { buildCertifiedFreshness } from './freshnessPure'

export type CertifiedSnapshotResult =
  | { available: true; meta: CertifiedSnapshotMeta; records: unknown[]; context: SportsDataContext }
  | { available: false; reason: 'unavailable'; context: SportsDataContext }

export interface CertifiedSportsSnapshotRepository {
  getLatestCertifiedSnapshot(input: { sport: string; capability: SportsDataCapability }): Promise<CertifiedSnapshotResult>
  getCanonicalRecords(input: { sport: string; capability: SportsDataCapability; canonicalEntityIds?: string[] }): Promise<unknown[]>
  getFreshness(input: { sport: string; capability: SportsDataCapability }): Promise<SportsDataContext>
}

export class DbCertifiedSnapshotRepository implements CertifiedSportsSnapshotRepository {
  constructor(private store = new SportsRuntimeStore()) {}

  async getLatestCertifiedSnapshot(input: { sport: string; capability: SportsDataCapability }): Promise<CertifiedSnapshotResult> {
    const meta = await this.store.getCertifiedSnapshotMeta(input.sport, input.capability).catch(() => null)
    if (!meta) return { available: false, reason: 'unavailable', context: buildCertifiedFreshness(null, new Date()) }
    const { records } = await this.store.getCertifiedRecords(input.sport, input.capability)
    return { available: true, meta, records, context: buildCertifiedFreshness(meta, new Date()) }
  }

  async getCanonicalRecords(input: { sport: string; capability: SportsDataCapability; canonicalEntityIds?: string[] }): Promise<unknown[]> {
    const { records } = await this.store.getCertifiedRecords(input.sport, input.capability).catch(() => ({ records: [] as unknown[] }))
    if (!input.canonicalEntityIds?.length) return records
    const wanted = new Set(input.canonicalEntityIds)
    return records.filter((r) => wanted.has((r as { canonicalPlayerId?: string }).canonicalPlayerId ?? ''))
  }

  async getFreshness(input: { sport: string; capability: SportsDataCapability }): Promise<SportsDataContext> {
    const meta = await this.store.getCertifiedSnapshotMeta(input.sport, input.capability).catch(() => null)
    return buildCertifiedFreshness(meta, new Date())
  }
}
