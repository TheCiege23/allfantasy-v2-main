/**
 * POST: Apply an IDP scoring preset (balanced | tackle_heavy | big_play_heavy).
 * Commissioner only. Optionally clear per-league overrides (default: keep).
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isIdpLeague, getIdpLeagueConfig, upsertIdpLeagueConfig } from '@/lib/idp'
import { writeIdpSettingsAudit } from '@/lib/idp/IdpSettingsAudit'
import type { IdpScoringPreset } from '@/lib/idp/types'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'

export async function POST(
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
  const body = (await req.json().catch(() => ({}))) as { preset?: string; clearOverrides?: boolean }
  const preset = (body.preset ?? 'balanced') as IdpScoringPreset
  if (!['balanced', 'tackle_heavy', 'big_play_heavy'].includes(preset)) {
    return NextResponse.json({ error: 'Invalid preset. Use balanced, tackle_heavy, or big_play_heavy.' }, { status: 400 })
  }
  const clearOverrides = body.clearOverrides === true

  const current = await getIdpLeagueConfig(leagueId)
  if (!current?.configId) return NextResponse.json({ error: 'IDP config not found' }, { status: 404 })

  const updated = await upsertIdpLeagueConfig(leagueId, {
    scoringPreset: preset,
    ...(clearOverrides && { scoringOverrides: null }),
  })
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await writeIdpSettingsAudit({
    leagueId,
    configId: updated.configId,
    actorId: session.user.id,
    action: 'scoring_preset_apply',
    before: { scoringPreset: current.scoringPreset, scoringOverrides: current.scoringOverrides },
    after: { scoringPreset: updated.scoringPreset, scoringOverrides: clearOverrides ? null : updated.scoringOverrides },
  })

  return NextResponse.json({
    config: {
      scoringPreset: updated.scoringPreset,
      scoringOverrides: updated.scoringOverrides,
    },
  })
}
