/**
 * PATCH: Update per-league IDP scoring overrides. Commissioner only.
 * Validates for outlier dominance (warnings only). Merged with preset at score time.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isIdpLeague, getIdpLeagueConfig, upsertIdpLeagueConfig } from '@/lib/idp'
import { writeIdpSettingsAudit } from '@/lib/idp/IdpSettingsAudit'
import { getIdpPresetScoring } from '@/lib/idp/IDPScoringPresets'
import { mergeScoringForValidation, validateScoringOutliers } from '@/lib/idp/IdpValidationService'
import type { IdpScoringOverrides } from '@/lib/idp/types'
import { prisma } from '@/lib/prisma'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissioner(leagueId, session.user.id)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const locked = await settingsLockedResponse(leagueId, 'scoring')

  if (locked) return locked
  const body = (await req.json().catch(() => ({}))) as { scoringOverrides?: IdpScoringOverrides | null }
  const scoringOverrides = body.scoringOverrides === null ? null : body.scoringOverrides

  const current = await getIdpLeagueConfig(leagueId)
  if (!current?.configId) return NextResponse.json({ error: 'IDP config not found' }, { status: 404 })
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })

  const presetValues = getIdpPresetScoring(current.scoringPreset, league?.sport)
  const merged = mergeScoringForValidation(presetValues, scoringOverrides ?? {})
  const { warnings } = validateScoringOutliers(merged)

  const updated = await upsertIdpLeagueConfig(leagueId, { scoringOverrides: scoringOverrides ?? undefined })
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await writeIdpSettingsAudit({
    leagueId,
    configId: updated.configId,
    actorId: session.user.id,
    action: 'scoring_change',
    before: { scoringOverrides: current.scoringOverrides },
    after: { scoringOverrides: updated.scoringOverrides },
  })

  return NextResponse.json({
    config: { scoringOverrides: updated.scoringOverrides },
    warnings: warnings.length > 0 ? warnings : undefined,
  })
}
