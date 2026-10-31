import { toCanonicalImportPreviewJson } from '@/lib/league-import/canonicalImportNormalizer'
import { orchestrateImportPreview } from '@/lib/league-import/importOrchestrator'
import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'

export type SleeperImportPreviewFailureCode =
  | 'LEAGUE_NOT_FOUND'
  | 'NORMALIZATION_FAILED'
  | 'CONNECTION_REQUIRED'
  | 'UNAUTHORIZED'
  | 'UNSUPPORTED_SPORT'

export interface SleeperImportPreviewSuccess {
  success: true
  preview: ReturnType<typeof buildImportedLeaguePreview>
  canonical: ReturnType<typeof toCanonicalImportPreviewJson>
}

export interface SleeperImportPreviewFailure {
  success: false
  error: string
  code: SleeperImportPreviewFailureCode
}

export async function getSleeperImportPreview(args: {
  sourceId: string
  userId?: string
}): Promise<SleeperImportPreviewSuccess | SleeperImportPreviewFailure> {
  if (!args.userId) {
    return { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }
  }

  const out = await orchestrateImportPreview({
    provider: 'sleeper',
    sourceId: args.sourceId,
    userId: args.userId,
  })

  if (!out.ok) {
    return {
      success: false,
      error: out.error,
      code: (out.code as SleeperImportPreviewFailureCode) ?? 'NORMALIZATION_FAILED',
    }
  }

  return {
    success: true,
    preview: out.preview,
    canonical: out.canonicalPreview,
  }
}
