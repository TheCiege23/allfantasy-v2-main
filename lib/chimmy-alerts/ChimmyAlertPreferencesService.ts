import 'server-only'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import type {
  ChimmyAlertClass,
  ChimmyAlertClassPref,
  ChimmyAlertCommissionerPref,
  ChimmyAlertLeaguePref,
  ChimmyAlertSnoozedEntry,
  ChimmyAlertTypeOverride,
  ChimmyAlertUserPreferences,
} from './types'

const PREFS_KEY = 'chimmyAlertPreferences'

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_CHIMMY_PREFS: ChimmyAlertUserPreferences = {
  sensitivity: 'normal',
  frequency: 'normal',
  mutedClasses: [],
  mutedTypes: [],
  classPrefs: {},
  typeOverrides: {},
  channelPreferences: {
    disablePush: false,
    disableEmail: false,
    disableSms: false,
  },
  leaguePrefs: [],
  snoozedAlerts: [],
}

// ── Persistence helpers ───────────────────────────────────────────────────────

async function readRawPrefs(userId: string): Promise<Record<string, unknown> | null> {
  const row = await prisma.userProfile.findUnique({
    where: { userId },
    select: { notificationPreferences: true },
  })
  if (!row) return null
  const notifPrefs = (row.notificationPreferences ?? {}) as Record<string, unknown>
  const chimmyPrefs = notifPrefs[PREFS_KEY]
  if (chimmyPrefs && typeof chimmyPrefs === 'object' && !Array.isArray(chimmyPrefs)) {
    return chimmyPrefs as Record<string, unknown>
  }
  return null
}

async function writeRawPrefs(
  userId: string,
  chimmyPrefs: Record<string, unknown>,
): Promise<void> {
  const row = await prisma.userProfile.findUnique({
    where: { userId },
    select: { notificationPreferences: true },
  })

  const existingNotif = (row?.notificationPreferences ?? {}) as Record<string, unknown>
  const merged = { ...existingNotif, [PREFS_KEY]: chimmyPrefs }

  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, notificationPreferences: toPrismaJsonInput(merged) },
    update: { notificationPreferences: toPrismaJsonInput(merged) },
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load a user's Chimmy alert preferences. Returns defaults if none saved.
 */
export async function loadChimmyAlertPreferences(
  userId: string,
): Promise<ChimmyAlertUserPreferences> {
  const raw = await readRawPrefs(userId)
  if (!raw) return { ...DEFAULT_CHIMMY_PREFS }

  // Merge raw over defaults to ensure all keys are present
  const prefs: ChimmyAlertUserPreferences = {
    ...DEFAULT_CHIMMY_PREFS,
    ...raw,
    channelPreferences: {
      ...DEFAULT_CHIMMY_PREFS.channelPreferences,
      ...(typeof raw.channelPreferences === 'object' && raw.channelPreferences
        ? raw.channelPreferences as Record<string, unknown>
        : {}),
    },
  }

  // Trim expired snoozes on load
  prefs.snoozedAlerts = pruneExpiredSnoozes(
    Array.isArray(raw.snoozedAlerts) ? (raw.snoozedAlerts as ChimmyAlertSnoozedEntry[]) : [],
  )

  return prefs
}

/**
 * Overwrite the entire Chimmy preferences blob for a user.
 */
export async function saveChimmyAlertPreferences(
  userId: string,
  prefs: ChimmyAlertUserPreferences,
): Promise<void> {
  const clean = { ...prefs }
  clean.snoozedAlerts = pruneExpiredSnoozes(clean.snoozedAlerts ?? [])
  await writeRawPrefs(userId, clean as unknown as Record<string, unknown>)
}

/**
 * Shallow-merge a partial update into the user's existing preferences.
 * Arrays (mutedClasses, mutedTypes, leaguePrefs, snoozedAlerts) are replaced,
 * not merged — callers must send the full desired array value.
 */
export async function patchChimmyAlertPreferences(
  userId: string,
  patch: Partial<ChimmyAlertUserPreferences>,
): Promise<ChimmyAlertUserPreferences> {
  const current = await loadChimmyAlertPreferences(userId)
  const updated: ChimmyAlertUserPreferences = {
    ...current,
    ...patch,
    classPrefs: { ...(current.classPrefs ?? {}), ...(patch.classPrefs ?? {}) },
    typeOverrides: { ...(current.typeOverrides ?? {}), ...(patch.typeOverrides ?? {}) },
    channelPreferences: {
      ...(current.channelPreferences ?? {}),
      ...(patch.channelPreferences ?? {}),
    },
  }
  await saveChimmyAlertPreferences(userId, updated)
  return updated
}

// ── Category mute helpers ─────────────────────────────────────────────────────

export async function muteAlertClass(
  userId: string,
  alertClass: ChimmyAlertClass,
): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const muted = new Set(prefs.mutedClasses ?? [])
  muted.add(alertClass)
  await patchChimmyAlertPreferences(userId, { mutedClasses: [...muted] })
}

export async function unmuteAlertClass(
  userId: string,
  alertClass: ChimmyAlertClass,
): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const muted = (prefs.mutedClasses ?? []).filter((c) => c !== alertClass)
  await patchChimmyAlertPreferences(userId, { mutedClasses: muted })
}

export async function muteAlertType(userId: string, alertType: string): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const muted = new Set(prefs.mutedTypes ?? [])
  muted.add(alertType)
  await patchChimmyAlertPreferences(userId, { mutedTypes: [...muted] })
}

export async function unmuteAlertType(userId: string, alertType: string): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const muted = (prefs.mutedTypes ?? []).filter((t) => t !== alertType)
  await patchChimmyAlertPreferences(userId, { mutedTypes: muted })
}

// ── Snooze helpers ────────────────────────────────────────────────────────────

const SNOOZE_DURATION_MAP: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

export function resolveSnoozeDuration(shorthand: string): number {
  return SNOOZE_DURATION_MAP[shorthand] ?? SNOOZE_DURATION_MAP['1h']
}

export async function snoozeAlert(
  userId: string,
  dedupeKey: string,
  durationMs: number,
): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const existing = pruneExpiredSnoozes(prefs.snoozedAlerts ?? []).filter(
    (s) => s.dedupeKey !== dedupeKey,
  )
  existing.push({ dedupeKey, snoozeUntil: Date.now() + durationMs })
  await patchChimmyAlertPreferences(userId, { snoozedAlerts: existing })
}

export async function clearSnooze(userId: string, dedupeKey: string): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const remaining = (prefs.snoozedAlerts ?? []).filter((s) => s.dedupeKey !== dedupeKey)
  await patchChimmyAlertPreferences(userId, { snoozedAlerts: remaining })
}

// ── Class/type pref setters ───────────────────────────────────────────────────

export async function setClassPref(
  userId: string,
  alertClass: ChimmyAlertClass,
  pref: ChimmyAlertClassPref,
): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  await patchChimmyAlertPreferences(userId, {
    classPrefs: {
      ...(prefs.classPrefs ?? {}),
      [alertClass]: { ...(prefs.classPrefs?.[alertClass] ?? {}), ...pref },
    },
  })
}

export async function setTypeOverride(
  userId: string,
  alertType: string,
  override: ChimmyAlertTypeOverride,
): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  await patchChimmyAlertPreferences(userId, {
    typeOverrides: {
      ...(prefs.typeOverrides ?? {}),
      [alertType]: { ...(prefs.typeOverrides?.[alertType] ?? {}), ...override },
    },
  })
}

// ── Commissioner prefs ────────────────────────────────────────────────────────

export async function setCommissionerPrefs(
  userId: string,
  commissPrefs: ChimmyAlertCommissionerPref,
): Promise<void> {
  await patchChimmyAlertPreferences(userId, { commissionerPrefs: commissPrefs })
}

// ── League pref helpers ───────────────────────────────────────────────────────

export async function setLeaguePref(
  userId: string,
  leaguePref: ChimmyAlertLeaguePref,
): Promise<void> {
  const prefs = await loadChimmyAlertPreferences(userId)
  const existing = (prefs.leaguePrefs ?? []).filter((l) => l.leagueId !== leaguePref.leagueId)
  existing.push(leaguePref)
  await patchChimmyAlertPreferences(userId, { leaguePrefs: existing })
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function pruneExpiredSnoozes(snoozes: ChimmyAlertSnoozedEntry[]): ChimmyAlertSnoozedEntry[] {
  const now = Date.now()
  return snoozes.filter((s) => s.snoozeUntil > now)
}
