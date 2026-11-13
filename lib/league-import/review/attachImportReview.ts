/**
 * Server entry point: preview payload in, `ImportReview` out.
 *
 * 🛑 NEVER FAILS THE PREVIEW. The review is an aid; a thrown error here returns `null` and the
 * import screen falls back to its pre-review panel. A commissioner who cannot see warnings can
 * still import, exactly as before this existed.
 */

import type { ImportProvider } from '@/lib/league-import/types'
import { buildImportReview } from './buildImportReview'
import { loadPreviousImportSnapshot, matchImportedPlayers } from './loadImportReviewContext'
import type { ImportReview, ImportReviewCanonicalInput, ImportReviewPreviewInput } from './types'

export async function buildServerImportReview(input: {
  provider: ImportProvider
  userId: string
  sourceLeagueId: string
  preview: unknown
  canonical?: unknown
}): Promise<ImportReview | null> {
  try {
    const preview = input.preview as ImportReviewPreviewInput
    if (!preview || !preview.league || !Array.isArray(preview.managers)) return null
    const [playerMatches, previous] = await Promise.all([
      matchImportedPlayers({ provider: input.provider, sport: preview.league.sport, preview }),
      loadPreviousImportSnapshot({
        userId: input.userId,
        provider: input.provider,
        sourceLeagueId: input.sourceLeagueId,
        season: preview.league.season,
      }),
    ])
    return buildImportReview({
      platform: input.provider,
      preview,
      canonical: (input.canonical ?? null) as ImportReviewCanonicalInput | null,
      playerMatches,
      previous,
    })
  } catch (err) {
    // Logged without the league or player data — the code path is what matters.
    console.warn('[import-review] review build failed', err instanceof Error ? err.name : 'unknown')
    return null
  }
}
