import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import {
  loadChimmyAlertPreferences,
  patchChimmyAlertPreferences,
} from '@/lib/chimmy-alerts/ChimmyAlertPreferencesService'

export const dynamic = 'force-dynamic'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ClassPrefSchema = z.object({
  muted: z.boolean().optional(),
  frequency: z.enum(['normal', 'reduced', 'minimal']).optional(),
})

const TypeOverrideSchema = z.object({
  muted: z.boolean().optional(),
  cooldownMultiplier: z.number().min(0.1).max(20).optional(),
  channelOverride: z.array(z.string()).optional(),
})

const LeaguePrefSchema = z.object({
  leagueId: z.guid(),
  disabled: z.boolean().optional(),
  mutedClasses: z.array(z.string()).optional(),
})

const CommissionerPrefSchema = z.object({
  enabled: z.boolean(),
  receiveSuspiciousTradeAlerts: z.boolean().optional(),
  receiveOrphanTeamAlerts: z.boolean().optional(),
  receiveWeeklyRecapAlerts: z.boolean().optional(),
  receiveIntegrityAlerts: z.boolean().optional(),
})

const ChannelPreferencesSchema = z.object({
  disablePush: z.boolean().optional(),
  disableEmail: z.boolean().optional(),
  disableSms: z.boolean().optional(),
})

const PatchSchema = z.object({
  sensitivity: z.enum(['low', 'normal', 'high']).optional(),
  frequency: z.enum(['normal', 'reduced', 'minimal']).optional(),
  mutedClasses: z.array(z.string()).optional(),
  mutedTypes: z.array(z.string()).optional(),
  classPrefs: z.record(z.string(), ClassPrefSchema).optional(),
  typeOverrides: z.record(z.string(), TypeOverrideSchema).optional(),
  channelPreferences: ChannelPreferencesSchema.optional(),
  commissionerPrefs: CommissionerPrefSchema.optional(),
  leaguePrefs: z.array(LeaguePrefSchema).optional(),
  quietHours: z
    .object({
      startHour: z.number().min(0).max(23),
      endHour: z.number().min(0).max(23),
      timezone: z.string().optional(),
      allowCritical: z.boolean().optional(),
    })
    .optional(),
})

// ── GET /api/ai/alerts/preferences ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const prefs = await loadChimmyAlertPreferences(user.appUserId)

  // Never return active snoozes in the GET (they are internal suppression state)
  const { snoozedAlerts: _, ...safePrefs } = prefs

  return NextResponse.json({ prefs: safePrefs })
}

// ── PATCH /api/ai/alerts/preferences ─────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid preferences', details: parsed.error.flatten() }, { status: 422 })
  }

  const updated = await patchChimmyAlertPreferences(user.appUserId, parsed.data as never)

  const { snoozedAlerts: _, ...safePrefs } = updated

  return NextResponse.json({ ok: true, prefs: safePrefs })
}
