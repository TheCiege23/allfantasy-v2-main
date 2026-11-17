/**
 * Import orchestrator — fetch → normalize → canonical bundle → preview payload.
 */

import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle, toCanonicalImportPreviewJson } from '@/lib/league-import/canonicalImportNormalizer'
import { validateCanonicalBundle, validateNormalizedImport } from '@/lib/league-import/importValidationService'
import type { ImportProvider, NormalizedImportResult } from '@/lib/league-import/types'
import type { CanonicalImportBundle } from '@/lib/league-import/types'

type ImportOrchestratorPreviewSuccess = {
  ok: true
  normalized: NormalizedImportResult
  canonical: CanonicalImportBundle
  preview: ReturnType<typeof buildImportedLeaguePreview>
  canonicalPreview: ReturnType<typeof toCanonicalImportPreviewJson>
}

type ImportOrchestratorPreviewFailure = {
  ok: false
  error: string
  code?: string
}

export async function orchestrateImportPreview(input: {
  provider: ImportProvider
  sourceId: string
  userId: string
}): Promise<ImportOrchestratorPreviewSuccess | ImportOrchestratorPreviewFailure> {
  const result = await runImportedLeagueNormalizationPipeline({
    provider: input.provider,
    sourceId: input.sourceId,
    userId: input.userId,
  })
  if (!result.success) {
    return { ok: false, error: result.error, code: result.code }
  }

  const v = validateNormalizedImport(result.normalized)
  if (!v.ok) {
    return { ok: false, error: v.message, code: v.code }
  }

  const canonical = buildCanonicalImportBundle(result.normalized)
  const cv = validateCanonicalBundle(canonical)
  if (!cv.ok) {
    return { ok: false, error: cv.message, code: cv.code }
  }

  const preview = buildImportedLeaguePreview(result.normalized)
  return {
    ok: true,
    normalized: result.normalized,
    canonical,
    preview,
    canonicalPreview: toCanonicalImportPreviewJson(canonical),
  }
}
