/**
 * Persists import audit rows + entity mappings after `persistImportedLeagueFromNormalization`.
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { ImportProvider, ImportWarningRecord, NormalizedImportResult } from '@/lib/league-import/types'
import type { CanonicalImportBundle } from '@/lib/league-import/types'
import {
  persistImportedLeagueFromNormalization,
  type PersistImportedLeagueResult,
} from '@/lib/league-import/ImportedLeagueCommitService'

function hashPayload(normalized: NormalizedImportResult): string {
  return createHash('sha256').update(JSON.stringify(normalized.source)).digest('hex').slice(0, 32)
}

function buildImportIdempotencyKey(input: {
  userId: string
  provider: ImportProvider
  sourceLeagueId: string
  season: number
}): string {
  return `${input.userId}:${input.provider}:${input.sourceLeagueId}:${input.season}`
}

function buildExistingLeagueImportIdempotencyKey(input: {
  userId: string
  provider: ImportProvider
  sourceLeagueId: string
  season: number
  leagueId: string
}): string {
  return `${input.userId}:${input.provider}:${input.sourceLeagueId}:${input.season}:into:${input.leagueId}`
}

/** Allows safe retry after a failed import without violating `idempotencyKey` uniqueness. */
async function deleteFailedImportRunIfPresent(idempotencyKey: string): Promise<void> {
  const row = await prisma.importRun.findUnique({ where: { idempotencyKey } })
  if (row?.status === 'failed') {
    await prisma.importRun.delete({ where: { id: row.id } })
  }
}

export async function persistImportWithCanonicalAudit(input: {
  userId: string
  provider: ImportProvider
  normalized: NormalizedImportResult
  canonical: CanonicalImportBundle
  allowUpdateExisting?: boolean
  additionalWarnings?: ImportWarningRecord[]
  /** From the commissioner gate — lets the bootstrap claim the importer's own team. */
  importerSourceManagerId?: string | null
}): Promise<{
  persisted: PersistImportedLeagueResult
  /** True only when a completed run was matched and nothing was re-read. */
  skipped: boolean
  runId: string
}> {
  const seasonYear =
    typeof input.normalized.league.season === 'number' && Number.isFinite(input.normalized.league.season)
      ? input.normalized.league.season
      : new Date().getFullYear()

  const idempotencyKey = buildImportIdempotencyKey({
    userId: input.userId,
    provider: input.provider,
    sourceLeagueId: input.normalized.source.source_league_id,
    season: seasonYear,
  })

  await deleteFailedImportRunIfPresent(idempotencyKey)

  const existingRun = await prisma.importRun.findUnique({ where: { idempotencyKey } })

  /*
   * ⚠ `force` EXISTED AND COULD NOT REACH ANYTHING, because this short-circuit runs
   * BEFORE `allowUpdateExisting` is consulted (it is passed to the persist call ~35
   * lines below). A previously-completed run returned `existed: true` here and the
   * import never re-ran — so "re-import" was answerable only by deleting rows by hand.
   *
   * That is not academic: the self-claim added in ImportedLeagueCommitService only runs
   * inside `persistImportedLeagueFromNormalization`, which this return skips entirely.
   * Every league imported before that fix would have stayed unclaimed and invisible on
   * Portfolio forever, with a re-import cheerfully reporting success and changing
   * nothing — the same "33 imported / 0 imported" shape this repo has already been bitten
   * by once.
   */
  const force = input.allowUpdateExisting === true
  if (!force && existingRun?.status === 'completed' && existingRun.leagueId) {
    const league = await prisma.league.findUnique({
      where: { id: existingRun.leagueId },
      select: { id: true, name: true, sport: true },
    })
    if (league) {
      /*
       * ⚠ `existed` AND `skipped` ARE NOT THE SAME QUESTION, and conflating them made
       * the import screen lie. `existed` is `Boolean(existing)` on the LEAGUE row, so it
       * is true on a forced re-import too — the league does still exist. Only this
       * branch means "nothing was re-read", and only it should say so.
       */
      return {
        persisted: {
          league: { id: league.id, name: league.name ?? '', sport: String(league.sport) },
          historicalBackfill: null,
          existed: true,
        },
        skipped: true,
        runId: existingRun.id,
      }
    }
  }

  /*
   * A forced re-run REUSES the existing audit row rather than deleting it or mutating the
   * key. `idempotencyKey` is unique, so a fresh `create` would collide; deleting would
   * throw away the audit trail this table exists to keep, and salting the key would leave
   * an unbounded set of near-duplicate rows. Reusing records the latest attempt against
   * the same logical import, which is what it is.
   */
  const run =
    force && existingRun
      ? await prisma.importRun.update({
          where: { idempotencyKey },
          data: {
            status: 'running',
            completedAt: null,
            error: null,
            rawPayloadHash: hashPayload(input.normalized),
            canonicalSummary: input.canonical as object,
          },
        })
      : await prisma.importRun.create({
          data: {
            userId: input.userId,
            provider: input.provider,
            sourceLeagueId: input.normalized.source.source_league_id,
            season: seasonYear,
            status: 'running',
            idempotencyKey,
            rawPayloadHash: hashPayload(input.normalized),
            canonicalSummary: input.canonical as object,
          },
        })

  try {
    const persisted = await persistImportedLeagueFromNormalization({
      userId: input.userId,
      provider: input.provider,
      normalized: input.normalized,
      allowUpdateExisting: input.allowUpdateExisting ?? false,
      canonicalBundle: input.canonical,
      importerSourceManagerId: input.importerSourceManagerId ?? null,
    })

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        leagueId: persisted.league.id,
        status: 'completed',
        completedAt: new Date(),
      },
    })

    for (const w of [...input.canonical.warnings, ...(input.additionalWarnings ?? [])]) {
      await prisma.importWarning.create({
        data: {
          runId: run.id,
          leagueId: persisted.league.id,
          code: w.code,
          message: w.message,
          severity: w.severity,
          metadata: (w.metadata ?? {}) as object,
        },
      })
    }

    for (const m of input.normalized.identity_mappings ?? []) {
      await prisma.externalEntityMapping.upsert({
        where: {
          leagueId_provider_entityType_sourceId: {
            leagueId: persisted.league.id,
            provider: m.source_provider,
            entityType: m.entity_type,
            sourceId: m.source_id,
          },
        },
        create: {
          leagueId: persisted.league.id,
          runId: run.id,
          provider: m.source_provider,
          entityType: m.entity_type,
          sourceId: m.source_id,
          internalId: m.af_id ?? undefined,
          confidence: m.af_id ? 1 : 0.5,
          metadata: { stable_key: m.stable_key },
        },
        update: {
          runId: run.id,
          internalId: m.af_id ?? undefined,
          confidence: m.af_id ? 1 : 0.5,
          metadata: { stable_key: m.stable_key },
        },
      })
    }

    if (input.canonical.reviewRequired) {
      await prisma.importReviewTask.create({
        data: {
          leagueId: persisted.league.id,
          userId: input.userId,
          runId: run.id,
          taskType: 'import_review',
          status: 'open',
          payload: { reasons: input.canonical.reviewReasons } as object,
        },
      })
    }

    // Phase 3.1 Rankings wiring — turn on the previously-dormant import→rank
    // bridge. Sleeper only, schema-free: (a) derive `LegacyEvidenceRecord` rows
    // from imported standings + previous-season chain, (b) trigger a rank
    // recompute for the league. Wrapped in a single try/catch so a legacy-engine
    // hiccup can NEVER fail the import — the import is already committed above.
    if (input.provider === 'sleeper') {
      try {
        const { deriveEvidenceRowsFromImport } = await import(
          '@/lib/legacy-score-engine/importedFactsToEvidence'
        )
        const { runLegacyScoreEngineForLeague } = await import(
          '@/lib/legacy-score-engine/LegacyScoreEngine'
        )
        const playoffTeamCount =
          (input.normalized.league as { playoff_team_count?: number | null } | null)
            ?.playoff_team_count ?? null
        const previousSeasonCount = input.normalized.previous_seasons?.length ?? 0
        const rows = deriveEvidenceRowsFromImport(input.normalized, {
          playoffTeamCount,
          previousSeasonCount,
        })
        if (rows.length > 0) {
          await prisma.legacyEvidenceRecord.createMany({ data: rows })
        }
        // Fire-and-forget recompute: `void` marks the promise as intentionally
        // unawaited. If it throws asynchronously, the outer try/catch below on
        // this iteration path won't see it — the recompute failing is not a
        // failed import and must never block or corrupt the run.
        void runLegacyScoreEngineForLeague(persisted.league.id).catch(() => undefined)
      } catch (rankErr) {
        // Non-fatal: log via a warning row so it's traceable, but the import
        // remains 'completed' — the imported data itself is intact.
        await prisma.importWarning
          .create({
            data: {
              runId: run.id,
              leagueId: persisted.league.id,
              code: 'legacy_evidence_wiring_failed',
              message:
                rankErr instanceof Error ? rankErr.message : String(rankErr),
              severity: 'warn',
              metadata: {},
            },
          })
          .catch(() => undefined)
      }
    }

    return { persisted, skipped: false, runId: run.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: msg, completedAt: new Date() },
    })
    throw e
  }
}

/**
 * Audit trail for commissioner import into an **existing** league (no new League row).
 * Uses a distinct idempotency key suffix `:into:{leagueId}` so it does not collide with fresh imports.
 */
export async function recordCanonicalImportAuditForExistingLeague(input: {
  userId: string
  leagueId: string
  provider: ImportProvider
  normalized: NormalizedImportResult
  canonical: CanonicalImportBundle
}): Promise<{ runId: string }> {
  const seasonYear =
    typeof input.normalized.league.season === 'number' && Number.isFinite(input.normalized.league.season)
      ? input.normalized.league.season
      : new Date().getFullYear()

  const idempotencyKey = buildExistingLeagueImportIdempotencyKey({
    userId: input.userId,
    provider: input.provider,
    sourceLeagueId: input.normalized.source.source_league_id,
    season: seasonYear,
    leagueId: input.leagueId,
  })

  await deleteFailedImportRunIfPresent(idempotencyKey)

  const existingRun = await prisma.importRun.findUnique({ where: { idempotencyKey } })
  if (existingRun?.status === 'completed') {
    return { runId: existingRun.id }
  }

  const run = await prisma.importRun.create({
    data: {
      userId: input.userId,
      leagueId: input.leagueId,
      provider: input.provider,
      sourceLeagueId: input.normalized.source.source_league_id,
      season: seasonYear,
      status: 'running',
      idempotencyKey,
      rawPayloadHash: hashPayload(input.normalized),
      canonicalSummary: input.canonical as object,
    },
  })

  try {
    for (const w of input.canonical.warnings) {
      await prisma.importWarning.create({
        data: {
          runId: run.id,
          leagueId: input.leagueId,
          code: w.code,
          message: w.message,
          severity: w.severity,
          metadata: (w.metadata ?? {}) as object,
        },
      })
    }

    for (const m of input.normalized.identity_mappings ?? []) {
      await prisma.externalEntityMapping.upsert({
        where: {
          leagueId_provider_entityType_sourceId: {
            leagueId: input.leagueId,
            provider: m.source_provider,
            entityType: m.entity_type,
            sourceId: m.source_id,
          },
        },
        create: {
          leagueId: input.leagueId,
          runId: run.id,
          provider: m.source_provider,
          entityType: m.entity_type,
          sourceId: m.source_id,
          internalId: m.af_id ?? undefined,
          confidence: m.af_id ? 1 : 0.5,
          metadata: { stable_key: m.stable_key },
        },
        update: {
          runId: run.id,
          internalId: m.af_id ?? undefined,
          confidence: m.af_id ? 1 : 0.5,
          metadata: { stable_key: m.stable_key },
        },
      })
    }

    if (input.canonical.reviewRequired) {
      await prisma.importReviewTask.create({
        data: {
          leagueId: input.leagueId,
          userId: input.userId,
          runId: run.id,
          taskType: 'import_review',
          status: 'open',
          payload: { reasons: input.canonical.reviewReasons } as object,
        },
      })
    }

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    })

    return { runId: run.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: msg, completedAt: new Date() },
    })
    throw e
  }
}
