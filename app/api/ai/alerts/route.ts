import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getSettingsProfile } from '@/lib/user-settings'
import { runUnifiedAlertEngine } from '@/lib/chimmy-alerts'
import { hydrateInjuredStarters } from '@/lib/chimmy-alerts/hydrateInjuredStarters'
import type { ChimmyAlertContext, ChimmyAlertSignalBundle, ChimmyAlertUserPreferences } from '@/lib/chimmy-alerts'
import { mapAlertPreferenceToSensitivity, resolveChimmyPersonalizationProfile } from '@/lib/chimmy-personalization'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  leagueId: z.string().uuid().optional(),
  surface: z.string().optional(),
  autoDeliver: z.union([z.literal('true'), z.literal('false')]).optional(),
})

const BodySchema = z.object({
  leagueId: z.string().uuid().optional(),
  surface: z.string().optional(),
  signalBundle: z.record(z.unknown()).optional(),
  userPreferences: z.record(z.unknown()).optional(),
  autoDeliver: z.boolean().optional(),
})

async function buildContext(input: {
  userId: string
  leagueId?: string | null
  surface?: string
  signalBundle?: ChimmyAlertSignalBundle
  userPreferences?: ChimmyAlertUserPreferences
}): Promise<ChimmyAlertContext | null> {
  const [profile, subscriptionProfile, personalization, injuredStartersSignal] = await Promise.all([
    getSettingsProfile(input.userId),
    prisma.userProfile.findUnique({
      where: { userId: input.userId },
      select: { afProSub: true, afCommissionerSub: true },
    }),
    resolveChimmyPersonalizationProfile(input.userId).catch(() => null),
    // Cross-league by design (one portfolio pass, filtered per league below). A caller
    // that already supplies the signal skips the cost; a portfolio failure degrades to
    // "not hydrated" rather than 500ing the whole feed.
    input.signalBundle?.injuredStarters
      ? Promise.resolve(null)
      : hydrateInjuredStarters({ appUserId: input.userId }).catch(() => null),
  ])

  let sport = 'NFL'
  let leagueType = 'redraft'
  let role: ChimmyAlertContext['role'] = 'member'

  let leagueState: Record<string, unknown> | undefined
  let scoringConfig: Record<string, unknown> | undefined
  let rosterConfig: Record<string, unknown> | undefined
  let playoffConfig: Record<string, unknown> | undefined
  let draftConfig: Record<string, unknown> | undefined

  if (input.leagueId) {
    const league = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: {
        id: true,
        sport: true,
        leagueType: true,
        tradeDeadlineWeek: true,
        playoffStartWeek: true,
        lockAllMoves: true,
        aiChimmyEnabled: true,
        settings: true,
        scoring: true,
        status: true,
        leagueVariant: true,
      },
    })

    if (!league) return null

    const access = await resolveLeagueAccess(input.leagueId, input.userId)
    if (!access?.isMember) return null

    role = access.isCommissioner ? 'commissioner' : 'member'
    sport = String(league.sport)
    leagueType = String(league.leagueType ?? 'redraft')
    leagueState = {
      tradeDeadlineWeek: league.tradeDeadlineWeek,
      playoffStartWeek: league.playoffStartWeek,
      lockAllMoves: league.lockAllMoves,
      aiChimmyEnabled: league.aiChimmyEnabled,
      status: league.status,
      leagueVariant: league.leagueVariant,
    }

    scoringConfig = typeof league.scoring === 'string' ? { scoringPreset: league.scoring } : undefined
    rosterConfig = typeof league.settings === 'object' && league.settings ? (league.settings as Record<string, unknown>) : undefined
    playoffConfig = {
      playoffStartWeek: league.playoffStartWeek,
      tradeDeadlineWeek: league.tradeDeadlineWeek,
    }
    draftConfig = {
      status: league.status,
      variant: league.leagueVariant,
    }
  }

  // League-scoped requests only see that league's starters (portfolio leagueIds are
  // canonical League.id uuids — the same space as input.leagueId). Undefined (hydration
  // skipped or failed) stays distinct from [] ("checked, none found").
  const hydratedInjuredStarters = injuredStartersSignal
    ? input.leagueId
      ? injuredStartersSignal.injuredStarters.filter((s) => s.leagueId === input.leagueId)
      : injuredStartersSignal.injuredStarters
    : undefined

  const signalBundle = {
    ...(input.signalBundle ?? {}),
    injuredStarters: input.signalBundle?.injuredStarters ?? hydratedInjuredStarters,
    draftStartingSoon: input.signalBundle?.draftStartingSoon ?? (leagueState?.status === 'drafting'),
    specialtyPhaseTransition: input.signalBundle?.specialtyPhaseTransition ?? (
      leagueState?.leagueVariant && leagueType !== 'redraft'
        ? { mode: String(leagueState.leagueVariant), phase: 'transition_window' }
        : null
    ),
  }

  const prefsFromProfile = ((profile?.notificationPreferences as Record<string, unknown> | undefined)?.chimmyAlerts ?? {}) as Record<string, unknown>
  const incomingPrefs = (input.userPreferences ?? {}) as Record<string, unknown>
  const personalizedSensitivity = personalization
    ? mapAlertPreferenceToSensitivity(personalization.effective.alertPreference)
    : undefined
  const resolvedSensitivity =
    (incomingPrefs.sensitivity as ChimmyAlertUserPreferences['sensitivity'] | undefined) ??
    personalizedSensitivity ??
    ((prefsFromProfile.sensitivity as ChimmyAlertUserPreferences['sensitivity'] | undefined) ?? 'normal')

  return {
    userId: input.userId,
    role,
    sport,
    leagueType,
    leagueId: input.leagueId ?? null,
    teamId: null,
    scoringConfig,
    rosterConfig,
    scheduleConfig: undefined,
    playoffConfig,
    draftConfig,
    teamState: undefined,
    leagueState,
    pageSurface: input.surface,
    signalBundle,
    userPreferences: {
      mutedClasses: Array.isArray(prefsFromProfile.mutedClasses) ? (prefsFromProfile.mutedClasses as any) : undefined,
      mutedTypes: Array.isArray(prefsFromProfile.mutedTypes) ? (prefsFromProfile.mutedTypes as any) : undefined,
      sensitivity: resolvedSensitivity,
      ...(input.userPreferences ?? {}),
    },
    subscriptionState: {
      hasPremium: Boolean(subscriptionProfile?.afProSub),
      hasCommissioner: Boolean(subscriptionProfile?.afCommissionerSub) || role === 'commissioner',
      hasAdmin: false,
    },
  }
}

export async function GET(request: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = QuerySchema.safeParse({
    leagueId: request.nextUrl.searchParams.get('leagueId') ?? undefined,
    surface: request.nextUrl.searchParams.get('surface') ?? undefined,
    autoDeliver: request.nextUrl.searchParams.get('autoDeliver') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, { status: 400 })
  }

  const context = await buildContext({
    userId: user.appUserId,
    leagueId: parsed.data.leagueId ?? null,
    surface: parsed.data.surface,
  })

  if (!context) {
    return NextResponse.json({ error: 'League not found or forbidden' }, { status: 403 })
  }

  const alerts = await runUnifiedAlertEngine(context, {
    autoDeliver: parsed.data.autoDeliver === 'true',
  })

  return NextResponse.json({ ok: true, alerts })
}

export async function POST(request: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bodyRaw = await request.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const context = await buildContext({
    userId: user.appUserId,
    leagueId: parsed.data.leagueId ?? null,
    surface: parsed.data.surface,
    signalBundle: parsed.data.signalBundle as ChimmyAlertSignalBundle | undefined,
    userPreferences: parsed.data.userPreferences as ChimmyAlertUserPreferences | undefined,
  })

  if (!context) {
    return NextResponse.json({ error: 'League not found or forbidden' }, { status: 403 })
  }

  const alerts = await runUnifiedAlertEngine(context, {
    autoDeliver: parsed.data.autoDeliver ?? false,
  })

  return NextResponse.json({ ok: true, alerts })
}
