/**
 * Persists import audit rows + entity mappings after `persistImportedLeagueFromNormalization`.
 */

import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { startImportAttempt, finishImportAttempt } from '@/lib/league-import/importRunAttempts'
import type { ImportProvider, ImportWarningRecord, NormalizedImportResult } from '@/lib/league-import/types'
import type { CanonicalImportBundle } from '@/lib/league-import/types'
import {
  persistImportedLeagueFromNormalization,
  type PersistImportedLeagueResult,
} from '@/lib/league-import/ImportedLeagueCommitService'

/**
 * Two requests for the same (user, provider, sourceLeagueId, season) can both pass the
 * `existingRun` check below before either has inserted a row — a double-tap submit, or a
 * mobile client retrying a slow response it gave up on. `idempotencyKey` is unique, so the
 * loser's `importRun.create` throws `P2002`, which used to bubble up as an unhandled 500
 * (Sentry ALLFANTASY-V2-MAIN-K). The winner is still mid-import at that point, so there is
 * nothing to adopt or return as success — surface it as a conflict the client can retry.
 */
export class ImportRunInFlightError extends Error {}

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

/**
 * Insert the audit row for a fresh import run, converting a concurrent-request collision on
 * `idempotencyKey` (P2002) into `ImportRunInFlightError` instead of letting it surface as an
 * unhandled 500. See the class doc comment above for why the row is not adopted.
 */
async function createImportRun(data: {
  userId: string
  provider: ImportProvider
  sourceLeagueId: string
  season: number
  idempotencyKey: string
  rawPayloadHash: string
  canonicalSummary: object
}) {
  try {
    return await prisma.importRun.create({
      data: {
        userId: data.userId,
        provider: data.provider,
        sourceLeagueId: data.sourceLeagueId,
        season: data.season,
        status: 'running',
        idempotencyKey: data.idempotencyKey,
        rawPayloadHash: data.rawPayloadHash,
        canonicalSummary: data.canonicalSummary,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ImportRunInFlightError(
        'This import is already in progress from another request. Please wait a moment and try again.'
      )
    }
    throw error
  }
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
  /** The user confirmed they want back a league they previously deleted. */
  confirmReimportOfDeleted?: boolean
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
          /* This is the SAME account's own prior run, short-circuited by idempotency key —
             not the cross-account join `claimExistingLeagueForMember` performs. */
          joinedExisting: false,
          /* Nothing ran, so nothing can be incomplete. Distinct from "every step succeeded"
             only in that `skipped: true` accompanies it — see this function's own note. */
          incompleteSteps: [],
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
      : await createImportRun({
          userId: input.userId,
          provider: input.provider,
          sourceLeagueId: input.normalized.source.source_league_id,
          season: seasonYear,
          idempotencyKey,
          rawPayloadHash: hashPayload(input.normalized),
          canonicalSummary: input.canonical as object,
        })

  /*
   * ⚠ OPENED AFTER THE RUN ROW IS SETTLED AND BEFORE ANY WORK, so a crash mid-import
   * leaves a `running` attempt rather than no record that the attempt happened. The
   * missing row is exactly what made a twice-failed import indistinguishable from a
   * clean one.
   */
  const attemptId = await startImportAttempt(run.id, {
    rawPayloadHash: run.rawPayloadHash,
    canonicalSummary: input.canonical as unknown,
  })

  try {
    const persisted = await persistImportedLeagueFromNormalization({
      userId: input.userId,
      provider: input.provider,
      normalized: input.normalized,
      allowUpdateExisting: input.allowUpdateExisting ?? false,
      canonicalBundle: input.canonical,
      importerSourceManagerId: input.importerSourceManagerId ?? null,
      confirmReimportOfDeleted: input.confirmReimportOfDeleted ?? false,
    })

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        leagueId: persisted.league.id,
        status: 'completed',
        completedAt: new Date(),
      },
    })
    /*
     * ⚠ THE RUN ROW IS OVERWRITTEN BY THE NEXT ATTEMPT; THIS ONE IS NOT. That is the
     * entire point — after this, "succeeded on the third try" and "succeeded first
     * time" stop looking identical.
     */
    await finishImportAttempt(attemptId, { status: 'completed' })

    /*
     * ⚠ `persisted.incompleteSteps` JOINS THE WARNINGS THAT ALREADY PERSIST HERE, rather than
     * getting its own channel. These rows are what `importReviewService` reads, so a bootstrap
     * step that failed now shows up in exactly the place a partial import was always meant to
     * be visible — and an import that wrote a league with no rosters stops being reported as
     * an unqualified success.
     */
    /*
     * 🛑 A FORCED RE-IMPORT REUSES THE RUN ROW, SO WARNINGS ACCUMULATED AGAINST IT FOREVER.
     *
     * The reuse above is deliberate and correct — deleting the run would discard the audit
     * trail, salting the key would leave unbounded near-duplicates. But nothing cleared what
     * HANGS OFF the reused row, and `ImportWarning` has no unique constraint and was written
     * with a bare `create`. So every refresh of a league appended another full copy of its
     * warnings to the same run: import twice, see each warning twice; ten times, ten times.
     *
     * Scoped to THIS run's id, so it is a no-op on a fresh run (nothing exists yet) and a
     * replacement on a reused one. That is the right semantics for a row that describes the
     * LATEST attempt of one logical import — which is exactly what the reuse comment above
     * says the run row means.
     *
     * ⚠ DELETE-THEN-CREATE RATHER THAN A UNIQUE CONSTRAINT ON PURPOSE. An `@@unique` would
     * need a migration, and a migration is not landable work — it is the user's to apply.
     * This converges with no schema change. If a constraint is added later, this becomes
     * redundant rather than wrong.
     */
    await prisma.importWarning.deleteMany({ where: { runId: run.id } })

    for (const w of [
      ...input.canonical.warnings,
      ...(input.additionalWarnings ?? []),
      ...persisted.incompleteSteps,
    ]) {
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
          metadata: { stable_key: m.stable_key, ...(m.external_ids ? { external_ids: m.external_ids } : {}) },
        },
        update: {
          runId: run.id,
          internalId: m.af_id ?? undefined,
          confidence: m.af_id ? 1 : 0.5,
          metadata: { stable_key: m.stable_key, ...(m.external_ids ? { external_ids: m.external_ids } : {}) },
        },
      })
    }

    /*
     * Same accumulation, same fix — but scoped far more narrowly, and the narrowing matters.
     *
     * ⚠ ONLY `open` `import_review` TASKS FOR THIS RUN. A RESOLVED task is history: somebody
     * looked at this import and made a decision, and re-importing must not erase that. Other
     * `taskType`s belong to other features entirely. Deleting by `runId` alone would take
     * both, which would turn a duplicate-row bug into a lost-audit bug — strictly worse than
     * what is being fixed.
     */
    await prisma.importReviewTask.deleteMany({
      where: { runId: run.id, taskType: 'import_review', status: 'open' },
    })

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
    /*
     * 🛑 THIS WAS `if (input.provider === 'sleeper')`, SO FIVE OF SIX PROVIDERS GOT NO
     * LEGACY EVIDENCE AT ALL — their imported history never moved a manager's rank.
     * `importedFactsToEvidence`'s own header called it "Phase 3.1 scope", and the only
     * Sleeper-specific thing in it was a hardcoded `sleeper:` prefix, now derived from
     * the real provider.
     *
     * ⚠ THE GATE WAS ALSO ACCIDENTALLY PROTECTING AGAINST A FABRICATED CHAMPIONSHIP,
     * which is why widening it needed a fix elsewhere first rather than being a
     * one-line change. `deriveEvidenceRowsFromImport` writes a `championships` row for
     * every `rank === 1`, and Fleaflicker's adapter synthesised rank from ARRAY
     * POSITION — so the first team in the response would have been crowned in every
     * league. Fixed in the same change; ESPN, Yahoo, MFL and Fantrax were already safe
     * because their unknown-rank fallback is LAST place.
     */
    {
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
          /*
           * ⚠ `LegacyEvidenceRecord` HAS NEITHER `runId` NOR `leagueId`, so neither of the
           * scopes used above is available here. What it does carry is `sourceReference`,
           * which `deriveEvidenceRowsFromImport` sets to `sleeper:<source_league_id>` — a
           * stable per-league key. Deleting by it clears exactly the rows a previous import
           * of THIS league wrote and nothing belonging to any other league.
           *
           * Derived from the rows about to be written rather than rebuilt from the input, so
           * the delete scope and the insert scope cannot drift apart.
           */
          const sourceRefs = [
            ...new Set(
              rows
                .map((r) => r.sourceReference)
                .filter((v): v is string => typeof v === 'string' && v.length > 0),
            ),
          ]
          if (sourceRefs.length > 0) {
            await prisma.legacyEvidenceRecord.deleteMany({
              where: { sourceReference: { in: sourceRefs } },
            })
          }
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
    /*
     * ⚠ THE FAILURE THAT USED TO VANISH. The next forced re-import overwrites the run
     * row's `status` and `error`, so a league that failed here and succeeded later kept
     * no trace of having failed. The attempt row survives that overwrite.
     */
    await finishImportAttempt(attemptId, { status: 'failed', error: msg })
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

  /* Same reasoning as the fresh-import path: opened before any work, so a crash
     leaves a `running` attempt rather than no record that it happened. */
  const attemptId = await startImportAttempt(run.id, {
    rawPayloadHash: run.rawPayloadHash,
    canonicalSummary: input.canonical as unknown,
  })

  try {
    /*
     * The existing-league path has the SAME accumulation for the same reason, and it is the
     * one that matters most: this path exists to import into a league that is already here,
     * so it is re-run by construction rather than by exception. See the fuller note on the
     * other path above.
     */
    await prisma.importWarning.deleteMany({ where: { runId: run.id } })

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
          metadata: { stable_key: m.stable_key, ...(m.external_ids ? { external_ids: m.external_ids } : {}) },
        },
        update: {
          runId: run.id,
          internalId: m.af_id ?? undefined,
          confidence: m.af_id ? 1 : 0.5,
          metadata: { stable_key: m.stable_key, ...(m.external_ids ? { external_ids: m.external_ids } : {}) },
        },
      })
    }

    /* Same narrow scope as the other path: open import_review tasks for this run only. */
    await prisma.importReviewTask.deleteMany({
      where: { runId: run.id, taskType: 'import_review', status: 'open' },
    })

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
    await finishImportAttempt(attemptId, { status: 'completed' })

    return { runId: run.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: msg, completedAt: new Date() },
    })
    await finishImportAttempt(attemptId, { status: 'failed', error: msg })
    throw e
  }
}
