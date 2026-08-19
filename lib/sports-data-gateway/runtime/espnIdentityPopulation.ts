import 'server-only'
/**
 * Fantasy OS Phase 5F-c — deterministic ESPN↔canonical player identity population.
 *
 * Populates PlayerIdentityMap with ESPN athlete ids using Sleeper's OWN player directory as a Tier-1 direct
 * cross-reference (each Sleeper record carries both its `player_id` AND an `espn_id`). This is deterministic —
 * a single trusted provider record holds both ids. NO name-only matching, NO fuzzy matching, NO LLM matching,
 * NO invented mappings. Conflicts (one espn id ↔ multiple sleeper ids, or a sleeper row whose stored espn id
 * differs) are quarantined and never written. Idempotent, conflict-safe upserts; never a destructive replace.
 *
 * Provider access lives ONLY in the Sleeper adapter (fetchSleeperEspnCrosswalk). This module never calls a
 * provider directly.
 */
import { fetchSleeperEspnCrosswalk, type SleeperEspnCrosswalkRow } from '../providers/sleeper'
import { normalizePlayerNameForResolution } from '@/lib/shared-services/player-identity'

export type IdentityCandidate = { espnId: string; sleeperId: string; canonicalName: string; normalizedName: string; position: string | null; team: string | null }
export type IdentityConflict = { reason: 'espn_id_multiple_sleeper' | 'sleeper_id_espn_mismatch'; espnId: string; sleeperIds?: string[]; existingEspnId?: string }

export type IdentityPopulationSummary = {
  provider: 'sleeper_crosswalk'
  totalPlayers: number
  candidatesDiscovered: number
  tier1Direct: number
  conflicts: number
  conflictExamples: IdentityConflict[]
  created: number
  updated: number
  unchanged: number
  skippedConflict: number
  dryRun: boolean
  error?: string
}

/** Existing PlayerIdentityMap persistence seam (injectable for tests; default is prisma-backed, non-prod). */
export type IdentityStore = {
  findExistingBySleeperIds(sleeperIds: string[]): Promise<Map<string, { id: string; espnId: string | null }>>
  createMappings(rows: IdentityCandidate[]): Promise<number>
  updateEspnId(sleeperId: string, patch: { espnId: string; canonicalName: string; normalizedName: string; position: string | null; currentTeam: string | null }): Promise<void>
  coverage(): Promise<{ identityMapRows: number; withEspnId: number; withSleeperId: number }>
}

export type CrosswalkFetcher = () => Promise<{ rows: SleeperEspnCrosswalkRow[]; totalPlayers: number; withEspn: number } | { error: string }>

/**
 * Pure classifier: split candidates into deterministically-verified (Tier-1) vs quarantined conflicts.
 * A conflict = one espn id claimed by >1 distinct sleeper id (ambiguous cross-reference).
 */
export function classifyCrosswalkCandidates(rows: SleeperEspnCrosswalkRow[]): { verified: IdentityCandidate[]; conflicts: IdentityConflict[] } {
  const bySleeper = new Map<string, IdentityCandidate>()
  const espnToSleepers = new Map<string, Set<string>>()
  for (const r of rows) {
    const cand: IdentityCandidate = { espnId: r.espnId, sleeperId: r.sleeperId, canonicalName: r.fullName, normalizedName: normalizePlayerNameForResolution(r.fullName), position: r.position, team: r.team }
    bySleeper.set(r.sleeperId, cand) // sleeper directory is keyed by sleeper id (unique) — last wins deterministically
    if (!espnToSleepers.has(r.espnId)) espnToSleepers.set(r.espnId, new Set())
    espnToSleepers.get(r.espnId)!.add(r.sleeperId)
  }
  const conflictedEspn = new Set<string>()
  const conflicts: IdentityConflict[] = []
  for (const [espnId, sleepers] of espnToSleepers) {
    if (sleepers.size > 1) { conflictedEspn.add(espnId); conflicts.push({ reason: 'espn_id_multiple_sleeper', espnId, sleeperIds: [...sleepers] }) }
  }
  const verified = [...bySleeper.values()].filter((c) => !conflictedEspn.has(c.espnId))
  return { verified, conflicts }
}

/**
 * Discover deterministic candidates, quarantine conflicts, and idempotently upsert verified mappings into
 * PlayerIdentityMap. Never overwrites a populated, DIFFERENT espn id (that is a conflict). Resumable/idempotent.
 */
export async function runEspnIdentityPopulation(opts: { fetch?: CrosswalkFetcher; store?: IdentityStore; limit?: number; dryRun?: boolean } = {}): Promise<IdentityPopulationSummary> {
  const dryRun = opts.dryRun === true
  const fetcher = opts.fetch ?? fetchSleeperEspnCrosswalk
  const base: IdentityPopulationSummary = { provider: 'sleeper_crosswalk', totalPlayers: 0, candidatesDiscovered: 0, tier1Direct: 0, conflicts: 0, conflictExamples: [], created: 0, updated: 0, unchanged: 0, skippedConflict: 0, dryRun }

  const fetched = await fetcher()
  if ('error' in fetched) return { ...base, error: fetched.error }
  base.totalPlayers = fetched.totalPlayers

  let rows = fetched.rows
  if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit)
  const { verified, conflicts } = classifyCrosswalkCandidates(rows)
  base.candidatesDiscovered = verified.length + conflicts.length
  base.tier1Direct = verified.length
  base.conflicts = conflicts.length
  base.conflictExamples = conflicts.slice(0, 10)

  if (dryRun || verified.length === 0) return base

  const store = opts.store ?? (await defaultIdentityStore())
  // Batch existence check (chunked) → decide create / update / skip-conflict / unchanged.
  const CHUNK = 500
  const toCreate: IdentityCandidate[] = []
  for (let i = 0; i < verified.length; i += CHUNK) {
    const chunk = verified.slice(i, i + CHUNK)
    const existing = await store.findExistingBySleeperIds(chunk.map((c) => c.sleeperId))
    for (const c of chunk) {
      const ex = existing.get(c.sleeperId)
      if (!ex) { toCreate.push(c); continue }
      if (ex.espnId == null) { await store.updateEspnId(c.sleeperId, { espnId: c.espnId, canonicalName: c.canonicalName, normalizedName: c.normalizedName, position: c.position, currentTeam: c.team }); base.updated++ }
      else if (ex.espnId === c.espnId) { base.unchanged++ }
      else { base.skippedConflict++; base.conflictExamples.push({ reason: 'sleeper_id_espn_mismatch', espnId: c.espnId, existingEspnId: ex.espnId, sleeperIds: [c.sleeperId] }) } // never silently overwrite
    }
  }
  if (toCreate.length > 0) base.created = await store.createMappings(toCreate)
  return base
}

/** Default prisma-backed store (non-production via DATABASE_URL). Idempotent; conflict-safe. */
async function defaultIdentityStore(): Promise<IdentityStore> {
  const { prisma } = await import('@/lib/prisma')
  return {
    async findExistingBySleeperIds(sleeperIds) {
      const rows = await prisma.playerIdentityMap.findMany({ where: { sleeperId: { in: sleeperIds } }, select: { id: true, sleeperId: true, espnId: true } })
      const m = new Map<string, { id: string; espnId: string | null }>()
      for (const r of rows) if (r.sleeperId) m.set(r.sleeperId, { id: r.id, espnId: r.espnId })
      return m
    },
    async createMappings(rows) {
      const res = await prisma.playerIdentityMap.createMany({ data: rows.map((c) => ({ espnId: c.espnId, sleeperId: c.sleeperId, canonicalName: c.canonicalName, normalizedName: c.normalizedName, position: c.position, currentTeam: c.team, sport: 'NFL' })), skipDuplicates: true })
      return res.count
    },
    async updateEspnId(sleeperId, patch) {
      await prisma.playerIdentityMap.updateMany({ where: { sleeperId }, data: { espnId: patch.espnId, canonicalName: patch.canonicalName, normalizedName: patch.normalizedName, position: patch.position, currentTeam: patch.currentTeam } })
    },
    async coverage() {
      const [identityMapRows, withEspnId, withSleeperId] = await Promise.all([
        prisma.playerIdentityMap.count(),
        prisma.playerIdentityMap.count({ where: { espnId: { not: null } } }),
        prisma.playerIdentityMap.count({ where: { sleeperId: { not: null } } }),
      ])
      return { identityMapRows, withEspnId, withSleeperId }
    },
  }
}

/** Safe identity coverage summary for operator observability (counts only — no player rows, no payloads). */
export async function describeEspnIdentityCoverage(store?: IdentityStore): Promise<{ identityMapRows: number; withEspnId: number; withSleeperId: number }> {
  const s = store ?? (await defaultIdentityStore())
  return s.coverage()
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Phase 5F-d — multi-source deterministic enrichment (Sleeper + FantasyCalc, both Tier-1 direct cross-refs).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A named trusted crosswalk source. `sources` order = precedence (index 0 = highest). */
export type CrosswalkSource = { name: string; fetch: CrosswalkFetcher }
export type SourceReport = { name: string; totalPlayers: number; withEspn: number; contributed: number; error?: string }
export type MultiSourcePopulationSummary = IdentityPopulationSummary & { sources: SourceReport[]; crossSourceConflicts: number }

/**
 * Pure multi-source classifier. Precedence = `sourceRows` order. Cross-source conflict when one sleeper id is
 * claimed with DIFFERENT espn ids by different sources, or one espn id maps to >1 sleeper id. Verified mappings
 * are attributed to the HIGHEST-precedence source that provided them (so a secondary source's `contributed`
 * count reflects only the NEW mappings the primary lacked). No name matching anywhere.
 */
export function classifyMultiSourceCandidates(sourceRows: Array<{ name: string; rows: SleeperEspnCrosswalkRow[] }>): {
  verified: Array<IdentityCandidate & { attributedSource: string }>
  conflicts: IdentityConflict[]
  contributionBySource: Record<string, number>
} {
  const sleeperToEspn = new Map<string, Set<string>>()
  const espnToSleepers = new Map<string, Set<string>>()
  // best (highest-precedence) candidate per sleeper id + which source it came from
  const bestBySleeper = new Map<string, { cand: IdentityCandidate; source: string; precedence: number }>()
  sourceRows.forEach(({ name, rows }, precedence) => {
    for (const r of rows) {
      if (!sleeperToEspn.has(r.sleeperId)) sleeperToEspn.set(r.sleeperId, new Set())
      sleeperToEspn.get(r.sleeperId)!.add(r.espnId)
      if (!espnToSleepers.has(r.espnId)) espnToSleepers.set(r.espnId, new Set())
      espnToSleepers.get(r.espnId)!.add(r.sleeperId)
      const existing = bestBySleeper.get(r.sleeperId)
      if (!existing || precedence < existing.precedence) {
        bestBySleeper.set(r.sleeperId, { cand: { espnId: r.espnId, sleeperId: r.sleeperId, canonicalName: r.fullName, normalizedName: normalizePlayerNameForResolution(r.fullName), position: r.position, team: r.team }, source: name, precedence })
      }
    }
  })
  const conflicts: IdentityConflict[] = []
  const conflicted = new Set<string>() // sleeper ids to quarantine
  for (const [sleeperId, espnIds] of sleeperToEspn) {
    if (espnIds.size > 1) { conflicted.add(sleeperId); conflicts.push({ reason: 'sleeper_id_espn_mismatch', espnId: [...espnIds].join('|'), sleeperIds: [sleeperId] }) }
  }
  for (const [espnId, sleepers] of espnToSleepers) {
    if (sleepers.size > 1) { for (const s of sleepers) conflicted.add(s); conflicts.push({ reason: 'espn_id_multiple_sleeper', espnId, sleeperIds: [...sleepers] }) }
  }
  const verified: Array<IdentityCandidate & { attributedSource: string }> = []
  const contributionBySource: Record<string, number> = {}
  for (const s of sourceRows) contributionBySource[s.name] = 0
  for (const [sleeperId, best] of bestBySleeper) {
    if (conflicted.has(sleeperId)) continue
    verified.push({ ...best.cand, attributedSource: best.source })
    contributionBySource[best.source] = (contributionBySource[best.source] ?? 0) + 1
  }
  return { verified, conflicts, contributionBySource }
}

/**
 * Discover candidates from multiple trusted sources, quarantine cross-source conflicts, and idempotently upsert
 * verified deterministic mappings (reuses the conflict-safe persistence). Reports per-source contribution.
 */
export async function runMultiSourceIdentityPopulation(opts: { sources: CrosswalkSource[]; store?: IdentityStore; limit?: number; dryRun?: boolean }): Promise<MultiSourcePopulationSummary> {
  const dryRun = opts.dryRun === true
  const sourceRows: Array<{ name: string; rows: SleeperEspnCrosswalkRow[] }> = []
  const sources: SourceReport[] = []
  for (const src of opts.sources) {
    const fetched = await src.fetch()
    if ('error' in fetched) { sources.push({ name: src.name, totalPlayers: 0, withEspn: 0, contributed: 0, error: fetched.error }); sourceRows.push({ name: src.name, rows: [] }); continue }
    let rows = fetched.rows
    if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit)
    sourceRows.push({ name: src.name, rows })
    sources.push({ name: src.name, totalPlayers: fetched.totalPlayers, withEspn: fetched.withEspn, contributed: 0 })
  }

  const { verified, conflicts, contributionBySource } = classifyMultiSourceCandidates(sourceRows)
  for (const s of sources) s.contributed = contributionBySource[s.name] ?? 0

  const base: MultiSourcePopulationSummary = {
    provider: 'sleeper_crosswalk', totalPlayers: sources.reduce((a, s) => a + s.totalPlayers, 0), candidatesDiscovered: verified.length + conflicts.length,
    tier1Direct: verified.length, conflicts: conflicts.length, conflictExamples: conflicts.slice(0, 10),
    created: 0, updated: 0, unchanged: 0, skippedConflict: 0, dryRun, sources, crossSourceConflicts: conflicts.length,
  }
  if (dryRun || verified.length === 0) return base

  const store = opts.store ?? (await defaultIdentityStore())
  const CHUNK = 500
  const toCreate: IdentityCandidate[] = []
  for (let i = 0; i < verified.length; i += CHUNK) {
    const chunk = verified.slice(i, i + CHUNK)
    const existing = await store.findExistingBySleeperIds(chunk.map((c) => c.sleeperId))
    for (const c of chunk) {
      const ex = existing.get(c.sleeperId)
      if (!ex) { toCreate.push(c); continue }
      if (ex.espnId == null) { await store.updateEspnId(c.sleeperId, { espnId: c.espnId, canonicalName: c.canonicalName, normalizedName: c.normalizedName, position: c.position, currentTeam: c.team }); base.updated++ }
      else if (ex.espnId === c.espnId) { base.unchanged++ }
      else { base.skippedConflict++ }
    }
  }
  if (toCreate.length > 0) base.created = await store.createMappings(toCreate)
  return base
}
