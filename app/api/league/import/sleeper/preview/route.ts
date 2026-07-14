import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'
import { buildSleeperImportStatusReport } from '@/lib/league-import/sleeper/SleeperImportStatusReport'
import { runSleeperImportValidation } from '@/lib/league-import/sleeper/SleeperImportValidation'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import { assertImportCommissioner } from '@/lib/league-import/commissionerGate'

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

  // This route pre-dates the unified /api/leagues/import/preview gate and had no
  // membership check at all — any authenticated user could preview any Sleeper
  // league's real data by ID. No live UI calls this route today, but it's still
  // deployed and reachable by URL, so it gets the same gate the unified route has.
  const gate = await assertImportCommissioner({
    appUserId: session.user.id,
    provider: 'sleeper',
    sourceLeagueId: leagueId,
  })
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.reason ?? 'You are not a member of that Sleeper league.' },
      { status: gate.notFound ? 404 : 403 },
    )
  }

  const result = await runImportedLeagueNormalizationPipeline({
    provider: 'sleeper',
    sourceId: leagueId,
    userId: session.user.id,
  })
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === 'LEAGUE_NOT_FOUND' ? 404 : 500 }
    )
  }

  const preview = buildImportedLeaguePreview(result.normalized)

  // Additive, honest status/validation reporting layered on top of the existing
  // preview response — never allowed to break the preview itself if it fails.
  let importStatus: ReturnType<typeof buildSleeperImportStatusReport> | undefined
  let validation: Awaited<ReturnType<typeof runSleeperImportValidation>> | undefined
  try {
    importStatus = buildSleeperImportStatusReport(result.normalized)
    validation = await runSleeperImportValidation(
      result.rawPayload as SleeperImportPayload,
      session.user.id
    )
  } catch (err) {
    console.warn('[sleeper preview] status/validation reporting failed (preview still returned):', err)
  }

  return NextResponse.json({ ...preview, importStatus, validation })
}
