/**
 * [NEW] IDP league config: GET (any member) / PATCH (commissioner only).
 * PROMPT 2/6 + 5/6: scoringOverrides, settingsLockedAt, audit on change.
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getIdpLeagueConfig, isIdpLeague, upsertIdpLeagueConfig, getRosterDefaultsForIdpLeague } from '@/lib/idp'
import { validateRosterSetup, validateScoringOutliers } from '@/lib/idp/IdpValidationService'
import { writeIdpSettingsAudit } from '@/lib/idp/IdpSettingsAudit'
import { getIdpPresetScoring } from '@/lib/idp/IDPScoringPresets'
import { mergeScoringForValidation } from '@/lib/idp/IdpValidationService'
import type { IdpScoringOverrides } from '@/lib/idp/types'
import { prisma } from '@/lib/prisma'
import { formatRulesLockedResponse, logFormatRulesChange } from '@/lib/league/formatRulesGuard'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const [config, rosterDefaults] = await Promise.all([
    getIdpLeagueConfig(leagueId),
    getRosterDefaultsForIdpLeague(leagueId),
  ])
  if (!config) return NextResponse.json({ config: null })

  const rosterPreview =
    rosterDefaults?.starter_slots != null
      ? {
          starterSlots: rosterDefaults.starter_slots,
          benchSlots: rosterDefaults.bench_slots ?? config.benchSlots,
          irSlots: rosterDefaults.IR_slots ?? config.irSlots,
        }
      : null

  return NextResponse.json({
    config: {
      positionMode: config.positionMode,
      rosterPreset: config.rosterPreset,
      slotOverrides: config.slotOverrides,
      scoringPreset: config.scoringPreset,
      scoringOverrides: config.scoringOverrides,
      bestBallEnabled: config.bestBallEnabled,
      draftType: config.draftType,
      benchSlots: config.benchSlots,
      irSlots: config.irSlots,
      settingsLockedAt: config.settingsLockedAt?.toISOString() ?? null,
    },
    rosterPreview,
  })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissionerAccess(leagueId, session.user.id, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const unlockOnly = body.unlockSettings === true
  // The league's settings lock (Format rules). Lifting IDP's own position lock is not a rule change, so it is not held.
  if (!unlockOnly) {
    const formatLocked = await formatRulesLockedResponse(leagueId)
    if (formatLocked) return formatLocked
  }

  const current = await getIdpLeagueConfig(leagueId)
  if (!current?.configId) return NextResponse.json({ error: 'IDP config not found' }, { status: 404 })
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })

  if (current.settingsLockedAt) {
    const wantPositionMode = typeof body.positionMode === 'string'
    const wantSlotOverrides = body.slotOverrides != null
    const wantRosterPreset = typeof body.rosterPreset === 'string'
    if (!unlockOnly && (wantPositionMode || wantSlotOverrides || wantRosterPreset)) {
      return NextResponse.json(
        { error: 'Settings are locked. Set unlockSettings: true to unlock before changing position mode or starter counts.' },
        { status: 400 }
      )
    }
  }

  if (unlockOnly) {
    await upsertIdpLeagueConfig(leagueId, { settingsLockedAt: null })
    await writeIdpSettingsAudit({
      leagueId,
      configId: current.configId,
      actorId: session.user.id,
      action: 'unlock',
      before: { settingsLockedAt: current.settingsLockedAt?.toISOString() ?? null },
      after: { settingsLockedAt: null },
    })
    const updated = await getIdpLeagueConfig(leagueId)
    return NextResponse.json({
      config: {
        positionMode: updated?.positionMode,
        rosterPreset: updated?.rosterPreset,
        slotOverrides: updated?.slotOverrides,
        scoringPreset: updated?.scoringPreset,
        scoringOverrides: updated?.scoringOverrides,
        bestBallEnabled: updated?.bestBallEnabled,
        draftType: updated?.draftType,
        benchSlots: updated?.benchSlots,
        irSlots: updated?.irSlots,
        settingsLockedAt: updated?.settingsLockedAt?.toISOString() ?? null,
      },
    })
  }

  const rosterPreset = typeof body.rosterPreset === 'string' ? body.rosterPreset : undefined
  const slotOverrides = body.slotOverrides != null ? (body.slotOverrides as object) : undefined
  const positionMode = typeof body.positionMode === 'string' ? body.positionMode : undefined
  if (rosterPreset !== undefined || slotOverrides !== undefined || positionMode !== undefined) {
    const check = validateRosterSetup(
      (rosterPreset ?? current.rosterPreset) as any,
      slotOverrides ?? current.slotOverrides,
      (positionMode ?? current.positionMode) as any
    )
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 })
  }

  const scoringOverrides =
    body.scoringOverrides !== undefined
      ? (body.scoringOverrides === null ? null : (body.scoringOverrides as IdpScoringOverrides))
      : undefined
  let scoringWarnings: string[] = []
  if (scoringOverrides !== undefined && scoringOverrides !== null) {
    const presetValues = getIdpPresetScoring(current.scoringPreset, league?.sport)
    const merged = mergeScoringForValidation(presetValues, scoringOverrides)
    scoringWarnings = validateScoringOutliers(merged).warnings
  }

  const before = {
    positionMode: current.positionMode,
    rosterPreset: current.rosterPreset,
    slotOverrides: current.slotOverrides,
    scoringPreset: current.scoringPreset,
    scoringOverrides: current.scoringOverrides,
    settingsLockedAt: current.settingsLockedAt?.toISOString() ?? null,
  }
  const updated = await upsertIdpLeagueConfig(leagueId, {
    positionMode,
    rosterPreset,
    slotOverrides,
    scoringPreset: typeof body.scoringPreset === 'string' ? body.scoringPreset : undefined,
    scoringOverrides,
    bestBallEnabled: typeof body.bestBallEnabled === 'boolean' ? body.bestBallEnabled : undefined,
    draftType: typeof body.draftType === 'string' ? body.draftType : undefined,
    benchSlots: typeof body.benchSlots === 'number' ? body.benchSlots : undefined,
    irSlots: typeof body.irSlots === 'number' ? body.irSlots : undefined,
    settingsLockedAt:
      body.lockSettings === true ? new Date() : undefined,
  })
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  const after = {
    positionMode: updated.positionMode,
    rosterPreset: updated.rosterPreset,
    slotOverrides: updated.slotOverrides,
    scoringPreset: updated.scoringPreset,
    scoringOverrides: updated.scoringOverrides,
    settingsLockedAt: updated.settingsLockedAt?.toISOString() ?? null,
  }
  let action: 'position_mode_change' | 'scoring_change' | 'starter_count_change' | 'scoring_preset_apply' | 'lock' = 'scoring_change'
  if (before.positionMode !== after.positionMode) action = 'position_mode_change'
  else if (before.rosterPreset !== after.rosterPreset || JSON.stringify(before.slotOverrides) !== JSON.stringify(after.slotOverrides))
    action = 'starter_count_change'
  else if (before.scoringPreset !== after.scoringPreset) action = 'scoring_preset_apply'
  else if (after.settingsLockedAt && !before.settingsLockedAt) action = 'lock'
  await writeIdpSettingsAudit({
    leagueId,
    configId: updated.configId,
    actorId: session.user.id,
    action,
    before,
    after,
  })
  await logFormatRulesChange({ leagueId, userId: session.user.id, format: 'idp', fields: Object.keys(body) })

  return NextResponse.json({
    config: {
      positionMode: updated.positionMode,
      rosterPreset: updated.rosterPreset,
      slotOverrides: updated.slotOverrides,
      scoringPreset: updated.scoringPreset,
      scoringOverrides: updated.scoringOverrides,
      bestBallEnabled: updated.bestBallEnabled,
      draftType: updated.draftType,
      benchSlots: updated.benchSlots,
      irSlots: updated.irSlots,
      settingsLockedAt: updated.settingsLockedAt?.toISOString() ?? null,
    },
    warnings: scoringWarnings.length > 0 ? scoringWarnings : undefined,
  })
}
