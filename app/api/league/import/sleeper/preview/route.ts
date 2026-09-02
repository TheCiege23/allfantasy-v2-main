import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'

/**
 * POST /api/league/import/sleeper/preview
 * Body: { leagueId: string }
 * Returns import preview (league, managers, data quality) for display before creating AF league.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'Sleeper League ID is required' }, { status: 400 })
  }

  const result = await runImportedLeagueNormalizationPipeline(leagueId)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      {
        status:
          result.code === 'LEAGUE_NOT_FOUND'
            ? 404
            : result.code === 'PROVIDER_UNAVAILABLE'
              ? 503
              : 500,
      }
    )
  }

  const preview = buildImportedLeaguePreview(result.normalized)
  return NextResponse.json(preview)
}
