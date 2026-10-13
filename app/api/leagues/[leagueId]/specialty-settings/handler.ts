/**
 * /api/leagues/[leagueId]/specialty-settings — the Specialty tab of league settings.
 *
 * GET   → which gated formats this league runs, whether the caller may edit them and why, the token
 *         price of a one-season unlock, and the Guillotine config when the league is Guillotine.
 * POST  → `{ confirmTokenSpend }` — unlock THIS league for THIS season with AF Tokens. A commish
 *         whose plan already covers it gets `{ ok: true, alreadyCovered: true }` and pays nothing.
 * PATCH → `{ guillotine: {...} }` — Guillotine rules (GuillotineLeagueConfig + the endgame).
 *
 * Commish and co-commish only. Every other format's editor writes through its own route, and each
 * of those routes calls `specialtySettingsEditRefusal` itself.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { getGuillotineConfig, upsertGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { resolveGuillotineEndgame } from '@/lib/guillotine/endgameRules'
import {
  GUILLOTINE_ENDGAME_THRESHOLD,
  SPECIALTY_SETTINGS_FEATURE_ID,
  SPECIALTY_SETTINGS_TOKEN_RULE,
  SPECIALTY_UNLOCK_SETTINGS_KEY,
  detectGatedSpecialtyFormats,
  parseGuillotineSettingsPatch,
  resolveSpecialtySettingsAccess,
  specialtySettingsEditRefusal,
  specialtyUnlockIdempotencyKey,
  type SpecialtyUnlockRecord,
} from '@/lib/league/specialty-settings-access'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUser(): Promise<{ id: string; email: string | null } | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const id = session?.user?.id
  return id ? { id, email: session?.user?.email ?? null } : null
}

async function leagueIdFrom(ctx: Ctx): Promise<string> {
  const p = await ctx.params
  return (p?.leagueId ?? '').trim()
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = await leagueIdFrom(ctx)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const access = await resolveSpecialtySettingsAccess(leagueId, user.id, user.email)
  if (!access) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!access.isCommish) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can view these settings.' }, { status: 403 })
  }

  const formats = await detectGatedSpecialtyFormats(leagueId)
  let guillotine: Record<string, unknown> | null = null
  if (formats.includes('guillotine')) {
    const [config, league] = await Promise.all([
      getGuillotineConfig(leagueId),
      prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } }),
    ])
    guillotine = config
      ? { ...config, endgame: resolveGuillotineEndgame(league ?? {}).format }
      : null
  }

  return NextResponse.json({
    formats,
    canEdit: access.canEdit,
    coveredBySubscription: access.coveredBySubscription,
    unlock: access.unlock,
    season: access.season,
    tokenCost: access.tokenCost,
    paywallLive: access.paywallLive,
    paywallStartsAt: access.paywallStartsAt,
    featureId: SPECIALTY_SETTINGS_FEATURE_ID,
    upgradePath: `/commissioner-upgrade?feature=${SPECIALTY_SETTINGS_FEATURE_ID}`,
    guillotine,
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = await leagueIdFrom(ctx)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { confirmTokenSpend?: unknown }
  const access = await resolveSpecialtySettingsAccess(leagueId, user.id, user.email)
  if (!access) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!access.isCommish) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can unlock these settings.' }, { status: 403 })
  }
  if (access.coveredBySubscription) return NextResponse.json({ ok: true, alreadyCovered: true, unlock: null })
  // Nothing is sold before the paywall launch — there is nothing to unlock yet.
  if (!access.paywallLive) return NextResponse.json({ ok: true, prelaunch: true, unlock: null })
  if (access.unlock) return NextResponse.json({ ok: true, alreadyUnlocked: true, unlock: access.unlock })

  // Token path only: the plan check above already answered "covered". Idempotent per league and
  // season, so a double tap or a retried request returns the first charge instead of a second.
  const gate = await requireFeatureEntitlement({
    userId: user.id,
    userEmail: user.email,
    featureId: SPECIALTY_SETTINGS_FEATURE_ID,
    allowTokenFallback: true,
    tokenRuleCode: SPECIALTY_SETTINGS_TOKEN_RULE,
    confirmTokenSpend: body.confirmTokenSpend === true,
    tokenSourceType: 'specialty_settings_unlock',
    tokenSourceId: `${leagueId}:${access.season}`,
    tokenDescription: `Specialty league settings unlock — ${access.season} season`,
    tokenMetadata: { leagueId, season: access.season },
    tokenIdempotencyKey: specialtyUnlockIdempotencyKey(leagueId, access.season),
  })
  if (!gate.ok) return gate.response

  const unlock: SpecialtyUnlockRecord = {
    season: access.season,
    unlockedByUserId: user.id,
    unlockedAt: new Date().toISOString(),
    tokenLedgerId: gate.tokenSpend?.id ?? null,
  }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const prev = (league?.settings as Record<string, unknown> | null) ?? {}
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...prev, [SPECIALTY_UNLOCK_SETTINGS_KEY]: unlock } as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true, unlock, tokenSpend: gate.tokenSpend })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = await leagueIdFrom(ctx)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const refusal = await specialtySettingsEditRefusal(leagueId, user.id, user.email)
  if (refusal) return refusal

  const body = (await req.json().catch(() => ({}))) as { guillotine?: unknown }
  if (!body.guillotine || typeof body.guillotine !== 'object' || Array.isArray(body.guillotine)) {
    return NextResponse.json({ error: 'guillotine settings object required' }, { status: 400 })
  }
  const formats = await detectGatedSpecialtyFormats(leagueId)
  if (!formats.includes('guillotine')) {
    return NextResponse.json({ error: 'This is not a Guillotine league.' }, { status: 409 })
  }

  const parsed = parseGuillotineSettingsPatch(body.guillotine as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { endgame, ...configPatch } = parsed.patch

  if (endgame) {
    // `resolveGuillotineEndgame` reads `settings.guillotineEndgame` BEFORE the column — writing only
    // the column would be a save that changes nothing.
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const prev = (league?.settings as Record<string, unknown> | null) ?? {}
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        guillotineEndgame: endgame,
        guillotineEndgameThreshold: GUILLOTINE_ENDGAME_THRESHOLD[endgame],
        settings: { ...prev, guillotineEndgame: endgame } as Prisma.InputJsonValue,
      },
    })
  }

  const config = Object.keys(configPatch).length > 0
    ? await upsertGuillotineConfig(leagueId, configPatch)
    : await getGuillotineConfig(leagueId)
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } })
  return NextResponse.json({
    ok: true,
    guillotine: config ? { ...config, endgame: resolveGuillotineEndgame(league ?? {}).format } : null,
  })
}
