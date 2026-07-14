/**
 * POST /api/leagues/[leagueId]/import/commit
 *
 * Commissioner-scoped deterministic commit for importing external league data
 * into an existing league.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { recordCanonicalImportAuditForExistingLeague } from '@/lib/league-import/importPersistenceService'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { assertImportCommissioner } from '@/lib/league-import/commissionerGate'
import {
  applyImportedLeagueToExistingLeague,
  type ExistingLeagueImportApplyOptions,
} from '@/lib/league-import/LeagueImportToExistingService'
import {
  runSleeperImportValidation,
  toImportWarningRecords,
  type SleeperImportValidationResult,
} from '@/lib/league-import/sleeper/SleeperImportValidation'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

export const dynamic = 'force-dynamic'

function mapImportCommitErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
  return 500
}

function resolveApplyOptions(input: unknown): ExistingLeagueImportApplyOptions {
  const patch = (input && typeof input === 'object') ? (input as Partial<ExistingLeagueImportApplyOptions>) : {}
  return {
    leagueStructure: patch.leagueStructure !== false,
    rosters: patch.rosters !== false,
    draftPicks: patch.draftPicks !== false,
    scoringRules: patch.scoringRules !== false,
    leagueName: patch.leagueName !== false,
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const gate = await assertLeagueActionGate(leagueId, userId, 'import_sync')
  if (!gate.ok) {
    return NextResponse.json({ error: gate.err.error, code: gate.err.code }, { status: gate.err.status })
  }

  const body = await req.json().catch(() => ({}))
  const provider = resolveProvider(typeof body.provider === 'string' ? body.provider : '')
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''
  const apply = resolveApplyOptions(body.apply)

  if (!provider) {
    return NextResponse.json({ error: 'Unsupported import provider' }, { status: 400 })
  }
  if (!sourceId) {
    return NextResponse.json({ error: 'sourceId is required' }, { status: 400 })
  }
  if (!isImportProviderAvailable(provider)) {
    return NextResponse.json({ error: `Import from ${provider} is not yet available.` }, { status: 400 })
  }

  const importGate = await assertImportCommissioner({
    appUserId: userId,
    provider,
    sourceLeagueId: sourceId,
  })
  if (!importGate.ok) {
    return NextResponse.json({ error: importGate.reason ?? 'Only commissioners can import this league.' }, { status: 403 })
  }

  const result = await runImportedLeagueNormalizationPipeline({
    provider,
    sourceId,
    userId,
  })
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: mapImportCommitErrorStatus(result.code) }
    )
  }

  try {
    const canonical = buildCanonicalImportBundle(result.normalized)
    const applied = await applyImportedLeagueToExistingLeague({
      leagueId,
      provider,
      normalized: result.normalized,
      apply,
      canonicalBundle: canonical,
    })

    // Provider-specific validation, never gating the commit — see
    // SleeperImportValidation.ts. A reporting-layer failure here is logged and
    // swallowed so it can never block a real, valid import into this league.
    let validation: SleeperImportValidationResult | undefined
    if (provider === 'sleeper') {
      try {
        validation = await runSleeperImportValidation(result.rawPayload as SleeperImportPayload, userId)
      } catch (err) {
        console.warn('[import commit existing league] Sleeper validation failed (import still proceeds):', err)
      }
    }

    const audit = await recordCanonicalImportAuditForExistingLeague({
      userId,
      leagueId,
      provider,
      normalized: result.normalized,
      canonical,
      additionalWarnings: validation ? toImportWarningRecords(validation.findings) : undefined,
    })

    void import('@/lib/league-events/publisher')
      .then(({ publishLeagueFanoutEvent }) =>
        publishLeagueFanoutEvent({
          leagueId,
          eventType: 'import_completed',
          title: 'Import completed',
          message: `External league data was imported (${provider}).`,
          category: 'league_announcements',
          visibility: 'all_members',
          actorUserId: userId,
          meta: { provider, importRunId: audit.runId },
          dedupeKey: `import:${leagueId}:${audit.runId}`,
        }),
      )
      .catch(() => {})

    return NextResponse.json({
      ok: true,
      ...applied,
      importRunId: audit.runId,
      canonical: {
        inferredConcept: canonical.inferredConcept,
        inferredLeagueType: canonical.inferredLeagueType,
        scoringPresetId: canonical.scoringPresetId,
        draftType: canonical.draftType,
        presetKey: canonical.presetKey,
        reviewRequired: canonical.reviewRequired,
        reviewReasons: canonical.reviewReasons,
        warnings: canonical.warnings,
      },
      validation,
    })
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'Failed to apply imported league data' },
      { status: 500 }
    )
  }
}
