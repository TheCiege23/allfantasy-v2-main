/**
 * Canonical decision persistence BOUNDARY (Phase 3A) — shadow-only.
 *
 * This is the single sanctioned way to persist canonical decisions. It is INERT by default and cannot become
 * live merely by being deployed/imported:
 *   1. Phase 3A supports ONLY `mode: 'shadow'`. Any other mode is refused (no write).
 *   2. Shadow writes require `DECISION_OS_CANONICAL_SHADOW_ENABLED === 'true'`. When absent/false the boundary
 *      returns immediately WITHOUT validating, touching the store, calling a provider, reserving a token, minting
 *      freshness, or activating any consumer.
 *   3. Only when both hold does it validate each decision and hand VALID ones to the injected store's atomic
 *      `persistBatch`. Invalid decisions are rejected (collected), never written.
 *
 * The store is DEPENDENCY-INJECTED (`CanonicalDecisionStore`) so this logic is exercised in tests with an
 * in-memory store — no DB, no provider, no tokens. The Prisma-backed store lives in `prismaDecisionStore.ts`
 * (server-only). This module is PURE and does no I/O of its own.
 *
 * Nothing here reads for the UI, notifications, or Chimmy; nothing charges tokens; nothing calls a provider.
 */
import type { CanonicalDecision, CanonicalDecisionRevision } from './contract'
import { canonicalShadowEnabled } from './shadowFlag'
import { computeRevisionContentHash, isNewerGeneration, toDecisionRevision } from './identity'
import { validateCanonicalDecision } from './validate'

/** Persistence mode. Phase 3A only accepts 'shadow'; 'live' is reserved for a later, separately-gated phase. */
export type DecisionPersistMode = 'shadow' | 'live'

export type SupersedeLink = { oldDecisionId: string; byDecisionId: string }

export type PersistBatchCounts = {
  /** New current-state rows. */
  created: number
  /** Current-state rows advanced to a strictly NEWER generation (see `isNewerGeneration`). */
  updated: number
  /** Writes whose generation was NOT newer than current state — current state left unchanged (stale/retry). */
  staleSkipped: number
  /** Prior decisions marked superseded. */
  superseded: number
  /** New immutable revision occurrences appended (one per (decisionId, runId)). */
  revised: number
  /** Same-run writes whose content differed from the stored occurrence — first occurrence preserved, no overwrite. */
  revisionConflicts: number
}

/** Injected persistence port. The Prisma impl runs `persistBatch` in ONE transaction (atomic) and is safe under
 *  concurrent callers: current state is written under an authoritative ordering rule (an older run can never
 *  regress a newer current decision) and an immutable revision is appended per (decisionId, runId) for audit. */
export interface CanonicalDecisionStore {
  /** Atomically apply ordering-gated current-state writes + append revisions + supersession. Counts only.
   *  No provider/token/freshness work. Safe under concurrent callers (one logical row per decisionId; one
   *  immutable revision per (decisionId, runId)). */
  persistBatch(input: {
    decisions: CanonicalDecision[]
    supersede: SupersedeLink[]
    now: Date
  }): Promise<PersistBatchCounts>
  /** Read-back for verification/tests only — NOT a UI/consumer read path. */
  get(decisionId: string): Promise<CanonicalDecision | null>
  /** Immutable revision history for a decision in deterministic order, for audit/verification. */
  getRevisions(decisionId: string): Promise<CanonicalDecisionRevision[]>
}

export type ShadowPersistResult = {
  mode: DecisionPersistMode
  enabled: boolean
  attempted: number
  persisted: number
  created: number
  updated: number
  /** Writes not applied to current state because their generation was not newer (stale/retry). */
  staleSkipped: number
  superseded: number
  /** New immutable revision rows appended (audit history). */
  revised: number
  /** Same-run writes with content differing from the stored occurrence (first preserved). */
  revisionConflicts: number
  rejected: Array<{ decisionId?: string; errors: string[] }>
  skippedReason?: 'shadow_disabled' | 'not_shadow_mode'
}

const INERT = (mode: DecisionPersistMode, attempted: number, reason: ShadowPersistResult['skippedReason']): ShadowPersistResult => ({
  mode,
  enabled: false,
  attempted,
  persisted: 0,
  created: 0,
  updated: 0,
  staleSkipped: 0,
  superseded: 0,
  revised: 0,
  revisionConflicts: 0,
  rejected: [],
  skippedReason: reason,
})

/**
 * The ONLY entry point to persist canonical decisions in Phase 3A. Shadow + flag gated (see file header).
 * Deterministically idempotent (upsert by decisionId), dedups within the batch, and applies supersession.
 */
export async function shadowPersistDecisions(args: {
  decisions: CanonicalDecision[]
  mode: DecisionPersistMode
  store: CanonicalDecisionStore
  env?: NodeJS.ProcessEnv
  now?: Date
}): Promise<ShadowPersistResult> {
  const attempted = args.decisions.length

  // (1) Phase 3A refuses any non-shadow mode — no write, no store touch.
  if (args.mode !== 'shadow') return INERT(args.mode, attempted, 'not_shadow_mode')

  // (2) Off-by-default flag gate — return BEFORE validating or touching the store.
  if (!canonicalShadowEnabled(args.env ?? process.env)) return INERT('shadow', attempted, 'shadow_disabled')

  // (3) Enabled shadow mode: validate, dedup, supersede, atomic upsert.
  const now = args.now ?? new Date()
  const rejected: ShadowPersistResult['rejected'] = []
  const byId = new Map<string, CanonicalDecision>()
  const supersede: SupersedeLink[] = []

  for (const candidate of args.decisions) {
    const res = validateCanonicalDecision(candidate)
    if (!res.ok) {
      rejected.push({ decisionId: (candidate as { decisionId?: string })?.decisionId, errors: res.errors })
      continue
    }
    // Occurrence identity is (decisionId, runId): shadow persistence requires a run to record an immutable
    // per-run revision. Reject a null-runId decision rather than record an unlabeled occurrence.
    if (res.decision.runId == null) {
      rejected.push({ decisionId: res.decision.decisionId, errors: ['runId is required for shadow persistence (per-run occurrence identity)'] })
      continue
    }
    byId.set(res.decision.decisionId, res.decision) // dedup within batch (last wins)
    if (res.decision.supersedes) supersede.push({ oldDecisionId: res.decision.supersedes, byDecisionId: res.decision.decisionId })
  }

  const decisions = [...byId.values()]
  if (decisions.length === 0) {
    return { mode: 'shadow', enabled: true, attempted, persisted: 0, created: 0, updated: 0, staleSkipped: 0, superseded: 0, revised: 0, revisionConflicts: 0, rejected }
  }

  const counts = await args.store.persistBatch({ decisions, supersede, now })
  return {
    mode: 'shadow',
    enabled: true,
    attempted,
    persisted: counts.created + counts.updated,
    created: counts.created,
    updated: counts.updated,
    staleSkipped: counts.staleSkipped,
    superseded: counts.superseded,
    revised: counts.revised,
    revisionConflicts: counts.revisionConflicts,
    rejected,
  }
}

/**
 * In-memory store for tests. Mirrors the Prisma store's contract exactly: ordering-gated current state (an older
 * generation never regresses a newer current row), immutable revisions with occurrence identity (decisionId,
 * runId) + content-hash conflict detection, and supersession. No I/O.
 */
export class InMemoryCanonicalDecisionStore implements CanonicalDecisionStore {
  readonly rows = new Map<string, CanonicalDecision>()
  /** decisionId → ordered immutable revisions (append order; at most one per runId). */
  readonly revisions = new Map<string, CanonicalDecisionRevision[]>()

  async persistBatch(input: { decisions: CanonicalDecision[]; supersede: SupersedeLink[]; now: Date }): Promise<PersistBatchCounts> {
    let created = 0
    let updated = 0
    let staleSkipped = 0
    let superseded = 0
    let revised = 0
    let revisionConflicts = 0
    for (const d of input.decisions) {
      // ── current state: ordering-gated (never regress a newer generation) ──
      const existingRow = this.rows.get(d.decisionId)
      if (!existingRow) {
        this.rows.set(d.decisionId, { ...d })
        created += 1
      } else if (isNewerGeneration(d, existingRow)) {
        this.rows.set(d.decisionId, { ...d })
        updated += 1
      } else {
        staleSkipped += 1 // older/equal generation → current state unchanged
      }
      // ── revision: occurrence identity (decisionId, runId); content-hash detects same-run conflicts ──
      const contentHash = computeRevisionContentHash(d)
      const list = this.revisions.get(d.decisionId) ?? []
      const existingRev = list.find((r) => r.runId === d.runId)
      if (!existingRev) {
        list.push({ ...toDecisionRevision(d), createdAt: input.now.toISOString() })
        this.revisions.set(d.decisionId, list)
        revised += 1
      } else if (existingRev.contentHash !== contentHash) {
        revisionConflicts += 1 // same run, different content → preserve first occurrence, never overwrite
      }
    }
    for (const link of input.supersede) {
      const old = this.rows.get(link.oldDecisionId)
      if (old && old.status !== 'superseded') {
        this.rows.set(link.oldDecisionId, { ...old, status: 'superseded' })
        superseded += 1
      }
    }
    return { created, updated, staleSkipped, superseded, revised, revisionConflicts }
  }

  async get(decisionId: string): Promise<CanonicalDecision | null> {
    const r = this.rows.get(decisionId)
    return r ? { ...r } : null
  }

  async getRevisions(decisionId: string): Promise<CanonicalDecisionRevision[]> {
    return (this.revisions.get(decisionId) ?? []).map((r) => ({ ...r }))
  }
}
