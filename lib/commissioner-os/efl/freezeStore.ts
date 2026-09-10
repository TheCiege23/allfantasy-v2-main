/**
 * Durable persistence for the Max PF freeze, and the audited correction path.
 *
 * 🛑 THE FREEZE IS WRITTEN ONCE AND NEVER UPDATED. `freezeMaxPf` is idempotent by construction: the
 * unique key is (leagueId, season, metric, computationVersion), and a rerun that finds an existing
 * row RETURNS IT UNCHANGED rather than upserting. That is the difference between a freeze and a
 * cache — a value that silently refreshes on every read is not frozen, whatever the column is
 * called.
 *
 * ⚠ A RERUN AFTER A STAT CORRECTION IS THE CASE THIS PROTECTS. Stat corrections legitimately move a
 * week-9 score in week 12. The stored fingerprint will then disagree with a fresh computation, and
 * that is reported as DRIFT by `resolveMaxPfFreezeStatus` — a fact for a human, never a trigger to
 * rewrite. The draft order does not move because somebody's Tuesday reprocessing did.
 *
 * ## Corrections are append-only, and the original survives
 *
 * Nothing here mutates `values`. A correction is a row in `LeagueMaxPfFreezeCorrection` carrying the
 * previous value, the new one, the reason, the actor and the timestamp. The effective snapshot is
 * (computed + latest correction per team), derived on read. So the originally computed number stays
 * recoverable forever, which is what lets Commissioner OS answer "why did my pick move?".
 *
 * ## 🛑 THE TABLES DO NOT EXIST YET, AND THIS MODULE DEGRADES RATHER THAN THROWS
 *
 * The migration is PARKED in `prisma/migrations-pending/20260910120000_league_max_pf_freeze/` and
 * applying it is a separate decision belonging to the user — a migration is not pushable work in
 * this repo. Until it is applied, `readStoredMaxPfFreeze` returns null on Prisma's
 * "table does not exist" errors, so the freeze status reads `ready` (computable, not yet frozen)
 * instead of every Commissioner OS surface erroring.
 *
 * ⚠ THE CATCH IS NARROW ON PURPOSE. Only P2021 (table missing) and P2022 (column missing) are
 * swallowed. A connection failure, a timeout or a constraint violation still throws — swallowing
 * those would turn a real outage into a permanent, quiet "not frozen yet".
 */

import { prisma } from '@/lib/prisma'
import {
  applyMaxPfCorrections,
  type MaxPfCorrection,
  type MaxPfFreezeRow,
  type MaxPfFreezeSnapshot,
  type MaxPfMetric,
} from '@/lib/commissioner-os/efl/maxPfFreeze'

/** Prisma's codes for "the migration has not been applied here". */
function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  if (code === 'P2021' || code === 'P2022') return true
  const msg = e instanceof Error ? e.message : String(e)
  return /does not exist in the current database|relation .* does not exist/i.test(msg)
}

export type StoredCorrection = {
  id: string
  teamId: string
  previousValue: number
  value: number
  reason: string
  correctedByUserId: string
  correctedAt: string
}

export type StoredMaxPfFreeze = {
  freezeId: string
  /** Exactly as computed at freeze time. Immutable. */
  original: MaxPfFreezeSnapshot
  /** The effective snapshot: original with the latest correction per team applied. */
  snapshot: MaxPfFreezeSnapshot
  hasCorrection: boolean
  corrections: StoredCorrection[]
  createdAt: string
}

export type FreezeKey = {
  leagueId: string
  season: number
  metric: MaxPfMetric
  computationVersion: string
}

function toSnapshot(row: {
  leagueId: string
  season: number
  regularSeasonFinalWeek: number
  metric: string
  computationVersion: string
  values: unknown
  fingerprint: string
}): MaxPfFreezeSnapshot {
  return {
    leagueId: row.leagueId,
    season: row.season,
    regularSeasonFinalWeek: row.regularSeasonFinalWeek,
    metric: row.metric as MaxPfMetric,
    computationVersion: row.computationVersion,
    rows: Array.isArray(row.values) ? (row.values as MaxPfFreezeRow[]) : [],
    fingerprint: row.fingerprint,
  }
}

/**
 * The stored freeze, with corrections applied.
 *
 * ⚠ ONLY THE LATEST CORRECTION PER TEAM IS EFFECTIVE, and the earlier ones stay on the record. A
 * commissioner who corrects twice has a history, not a contradiction.
 */
export async function readStoredMaxPfFreeze(key: FreezeKey): Promise<StoredMaxPfFreeze | null> {
  let row
  try {
    row = await prisma.leagueMaxPfFreeze.findUnique({
      where: {
        uniq_max_pf_freeze: {
          leagueId: key.leagueId,
          season: key.season,
          metric: key.metric,
          computationVersion: key.computationVersion,
        },
      },
      include: { corrections: { orderBy: { correctedAt: 'asc' } } },
    })
  } catch (e) {
    if (isMissingRelation(e)) return null
    throw e
  }
  if (!row) return null

  const original = toSnapshot(row)
  const corrections: StoredCorrection[] = row.corrections.map((c) => ({
    id: c.id,
    teamId: c.teamId,
    previousValue: c.previousValue,
    value: c.value,
    reason: c.reason,
    correctedByUserId: c.correctedByUserId,
    correctedAt: c.correctedAt.toISOString(),
  }))

  /* Latest per team wins; ordered ascending above, so a later entry overwrites an earlier one. */
  const latestByTeam = new Map<string, StoredCorrection>()
  for (const c of corrections) latestByTeam.set(c.teamId, c)

  const asCorrections: MaxPfCorrection[] = [...latestByTeam.values()]
    .sort((a, b) => (a.teamId < b.teamId ? -1 : 1))
    .map((c) => ({
      teamId: c.teamId,
      value: c.value,
      reason: c.reason,
      correctedByUserId: c.correctedByUserId,
      correctedAt: c.correctedAt,
    }))

  const effective =
    asCorrections.length > 0 ? applyMaxPfCorrections(original, asCorrections).snapshot : original

  return {
    freezeId: row.id,
    original,
    snapshot: effective,
    hasCorrection: corrections.length > 0,
    corrections,
    createdAt: row.createdAt.toISOString(),
  }
}

export type FreezeMaxPfResult =
  | { ok: true; created: boolean; stored: StoredMaxPfFreeze }
  | { ok: false; reason: 'not_persistable'; detail: string }

/**
 * Write the freeze, once.
 *
 * 🛑 `created: false` MEANS A FREEZE ALREADY EXISTED AND NOTHING WAS WRITTEN — including when the
 * incoming fingerprint differs. That is the whole contract. An existing freeze is the answer, and a
 * disagreeing recomputation is drift for a human to look at, not an update to apply.
 */
export async function freezeMaxPf(input: {
  snapshot: MaxPfFreezeSnapshot
  provenance?: Record<string, unknown> | null
  createdByUserId?: string | null
}): Promise<FreezeMaxPfResult> {
  const { snapshot } = input
  const key: FreezeKey = {
    leagueId: snapshot.leagueId,
    season: snapshot.season,
    metric: snapshot.metric,
    computationVersion: snapshot.computationVersion,
  }

  try {
    const existing = await readStoredMaxPfFreeze(key)
    if (existing) return { ok: true, created: false, stored: existing }

    await prisma.leagueMaxPfFreeze.create({
      data: {
        leagueId: snapshot.leagueId,
        season: snapshot.season,
        regularSeasonFinalWeek: snapshot.regularSeasonFinalWeek,
        metric: snapshot.metric,
        computationVersion: snapshot.computationVersion,
        values: snapshot.rows as unknown as object,
        fingerprint: snapshot.fingerprint,
        provenance: (input.provenance ?? undefined) as object | undefined,
        createdByUserId: input.createdByUserId ?? null,
      },
    })

    const stored = await readStoredMaxPfFreeze(key)
    if (!stored) {
      return { ok: false, reason: 'not_persistable', detail: 'Freeze written but not readable back.' }
    }
    return { ok: true, created: true, stored }
  } catch (e) {
    if (isMissingRelation(e)) {
      return {
        ok: false,
        reason: 'not_persistable',
        detail:
          'The league_max_pf_freezes table does not exist. The migration is parked in prisma/migrations-pending/20260910120000_league_max_pf_freeze/ and has not been applied.',
      }
    }
    /*
     * ⚠ A UNIQUE-CONSTRAINT VIOLATION HERE IS A RACE, NOT AN ERROR: two callers froze at once and
     * one lost. The winner's row is the freeze. Re-read rather than surfacing a failure.
     */
    if ((e as { code?: string } | null)?.code === 'P2002') {
      const stored = await readStoredMaxPfFreeze(key)
      if (stored) return { ok: true, created: false, stored }
    }
    throw e
  }
}

export type RecordCorrectionResult =
  | { ok: true; stored: StoredMaxPfFreeze; correctionId: string }
  | { ok: false; reason: 'no_freeze' | 'unknown_team' | 'not_persistable'; detail: string }

/**
 * Record an explicit commissioner correction.
 *
 * ⚠ `previousValue` IS READ FROM THE STORED RECORD, NOT SUPPLIED BY THE CALLER. A caller-supplied
 * "previous" value can be wrong — stale UI, a retry, a copy-paste — and an audit trail whose
 * before-value was asserted by the same person making the change is not an audit trail.
 */
export async function recordMaxPfCorrection(input: {
  key: FreezeKey
  teamId: string
  value: number
  reason: string
  correctedByUserId: string
}): Promise<RecordCorrectionResult> {
  if (!input.reason.trim()) {
    return { ok: false, reason: 'unknown_team', detail: 'A correction must state a reason.' }
  }

  const stored = await readStoredMaxPfFreeze(input.key)
  if (!stored) {
    return {
      ok: false,
      reason: 'no_freeze',
      detail: 'There is no frozen snapshot to correct. Freeze first.',
    }
  }

  const current = stored.snapshot.rows.find((r) => r.teamId === input.teamId)
  if (!current) {
    return {
      ok: false,
      reason: 'unknown_team',
      detail: `${input.teamId} is not in this freeze. A correction cannot add a team.`,
    }
  }

  try {
    const created = await prisma.leagueMaxPfFreezeCorrection.create({
      data: {
        freezeId: stored.freezeId,
        teamId: input.teamId,
        previousValue: current.value,
        value: input.value,
        reason: input.reason.trim(),
        correctedByUserId: input.correctedByUserId,
      },
      select: { id: true },
    })
    const after = await readStoredMaxPfFreeze(input.key)
    if (!after) {
      return { ok: false, reason: 'not_persistable', detail: 'Correction written but not readable back.' }
    }
    return { ok: true, stored: after, correctionId: created.id }
  } catch (e) {
    if (isMissingRelation(e)) {
      return {
        ok: false,
        reason: 'not_persistable',
        detail: 'The correction table does not exist; the migration has not been applied.',
      }
    }
    throw e
  }
}
