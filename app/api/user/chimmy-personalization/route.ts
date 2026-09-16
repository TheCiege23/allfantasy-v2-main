import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import {
  resolveChimmyPersonalizationProfile,
  updateChimmyPersonalizationSettings,
} from '@/lib/chimmy-personalization'
import {
  forgetRememberedPreferences,
  listPreferenceLeagueOptions,
  listRememberedPreferences,
  setRememberedTeamDirection,
} from '@/lib/chimmy-personalization/remembered'

export const dynamic = 'force-dynamic'

/*
 * `null` clears a setting (back to what Chimmy infers, or the default); an absent key leaves it
 * alone. Before 2026-09-16 no setting could be cleared once set.
 */
const PatchSchema = z
  .object({
    explanationStyle: z
      .enum(['concise', 'balanced', 'detailed', 'data-heavy', 'beginner-friendly', 'commissioner-focused'])
      .nullable()
      .optional(),
    riskPreference: z.enum(['floor', 'balanced', 'upside']).nullable().optional(),
    leagueStylePreference: z
      .enum(['redraft-first', 'dynasty-first', 'specialty-league-first', 'c2c-devy-heavy'])
      .nullable()
      .optional(),
    actionPreference: z.enum(['quick-one-move', 'top-3-options', 'full-breakdown']).nullable().optional(),
    alertPreference: z.enum(['minimal-alerts', 'balanced-alerts', 'aggressive-proactive-alerts']).nullable().optional(),
    storyContentPreferences: z
      .array(
        z.enum([
          'likes-recaps',
          'likes-power-rankings',
          'likes-humor',
          'likes-serious-analysis',
          'no-story-content',
        ]),
      )
      .nullable()
      .optional(),
    /*
     * What Chimmy remembers from conversation. `leagueId: null` is "all leagues". A league id is
     * checked against the canonical membership predicate before anything is written under it.
     */
    teamDirection: z
      .object({
        leagueId: z.string().min(1).max(128).nullable(),
        value: z.enum(['contender', 'rebuilder']).nullable(),
      })
      .optional(),
    forget: z.object({ leagueId: z.string().min(1).max(128).nullable() }).optional(),
  })
  .strict()

async function snapshot(userId: string) {
  const [profile, remembered, leagues] = await Promise.all([
    resolveChimmyPersonalizationProfile(userId),
    listRememberedPreferences(userId).catch(() => []),
    listPreferenceLeagueOptions(userId).catch(() => []),
  ])
  return { profile, remembered, leagues }
}

export async function GET() {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ ok: true, ...(await snapshot(user.appUserId)) })
}

export async function PATCH(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { teamDirection, forget, ...settings } = parsed.data

  if (teamDirection) {
    const result = await setRememberedTeamDirection(user.appUserId, teamDirection.leagueId, teamDirection.value)
    /*
     * One status and one message for "not your league" and "no such league" — telling them apart
     * would say whether an id exists.
     */
    if (result === 'forbidden') {
      return NextResponse.json({ error: 'League not available' }, { status: 403 })
    }
  }
  if (forget) {
    await forgetRememberedPreferences(user.appUserId, forget.leagueId)
  }

  const explicit = Object.keys(settings).length > 0
    ? await updateChimmyPersonalizationSettings(user.appUserId, settings)
    : undefined

  return NextResponse.json({ ok: true, ...(explicit ? { explicit } : {}), ...(await snapshot(user.appUserId)) })
}
