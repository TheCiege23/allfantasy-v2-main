/**
 * AF Commissioner waiver extras (owner, 2026-11-26: "do all 7, wire them up"). One record on
 * `League.settings.af_waiver_extras`, validated here and read by the engine, the claim gates and the UI.
 *
 *   conditionalClaims  — a manager can group claims: "get A; if I lose A, try B". The first claim in a
 *                        group that is WON ends the group; the rest fail "an earlier choice was won".
 *   faabRefills        — extra FAAB for every team at a set week (e.g. +$25 at the trade deadline).
 *   rebuildPriority    — once the playoffs begin, teams out of the playoffs claim before teams still in.
 *                        This season only: nothing carries into next year's draft.
 *   secondChance       — a FAAB bid that loses by ≤ maxGap dollars moves that manager's next grouped
 *                        choice to the front of that team's queue for this run.
 *   runReport          — after each run, post every award (and, unless hidden, the losing bids) to chat.
 *   faLockWindows      — hours in league time when free-agent adds are locked league-wide.
 *
 * Chimmy bid help is the seventh, and it is AF Pro (a manager's tool), so it has no switch here.
 * Pure and dependency-light (zod only).
 */
import { z } from 'zod'

export const WAIVER_EXTRAS_SETTINGS_KEY = 'af_waiver_extras' as const

const lockWindow = z
  .object({
    /** Local weekday, Sunday = 0. */
    day: z.number().int().min(0).max(6),
    /** Local hours, [startHour, endHour). endHour 24 = midnight. */
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .refine((w) => w.endHour > w.startHour, { message: 'A lock window must end after it starts.' })

const refill = z.object({
  /** League week the refill lands at the start of. */
  week: z.number().int().min(1).max(30),
  amount: z.number().int().min(1).max(10_000),
})

export const waiverExtrasSchema = z
  .object({
    version: z.literal(1),
    conditionalClaims: z.boolean(),
    faabRefills: z.array(refill).max(10),
    rebuildPriority: z.boolean(),
    secondChance: z.object({ enabled: z.boolean(), maxGap: z.number().int().min(0).max(100) }),
    runReport: z.object({ enabled: z.boolean(), hideLosingBids: z.boolean() }),
    faLockWindows: z.array(lockWindow).max(21),
  })
  .strict()

export type WaiverExtras = z.infer<typeof waiverExtrasSchema>

export function defaultWaiverExtras(): WaiverExtras {
  return {
    version: 1,
    conditionalClaims: false,
    faabRefills: [],
    rebuildPriority: false,
    secondChance: { enabled: false, maxGap: 1 },
    runReport: { enabled: false, hideLosingBids: false },
    faLockWindows: [],
  }
}

export function parseWaiverExtras(raw: unknown): WaiverExtras | null {
  const r = waiverExtrasSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** The league's extras, or the all-off default (never null, so callers read fields directly). */
export function readWaiverExtras(settings: unknown): WaiverExtras {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return defaultWaiverExtras()
  return parseWaiverExtras((settings as Record<string, unknown>)[WAIVER_EXTRAS_SETTINGS_KEY]) ?? defaultWaiverExtras()
}

/** True when any extra is on — the AF Commissioner gate only bites on turning one on or changing it. */
export function anyWaiverExtraOn(e: WaiverExtras): boolean {
  return (
    e.conditionalClaims ||
    e.faabRefills.length > 0 ||
    e.rebuildPriority ||
    e.secondChance.enabled ||
    e.runReport.enabled ||
    e.faLockWindows.length > 0
  )
}

/* ── Free-agent lock windows ────────────────────────────────────────────────────────────────── */

function localDayHour(at: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit' }).formatToParts(at)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24 }
}

/** The window locking free-agent adds right now, or null. */
export function activeFaLockWindow(extras: WaiverExtras, now: Date, timeZone: string | null | undefined): WaiverExtras['faLockWindows'][number] | null {
  if (extras.faLockWindows.length === 0) return null
  let tz = String(timeZone ?? '').trim() || 'America/New_York'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    tz = 'America/New_York'
  }
  const { day, hour } = localDayHour(now, tz)
  return extras.faLockWindows.find((w) => w.day === day && hour >= w.startHour && hour < w.endHour) ?? null
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const hourLabel = (h: number) => (h === 0 || h === 24 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`)

export function faLockMessage(w: WaiverExtras['faLockWindows'][number]): string {
  return `Free-agent adds are locked ${DAY[w.day]} ${hourLabel(w.startHour)}–${hourLabel(w.endHour)} league time by the commissioner.`
}

/* ── FAAB refills ───────────────────────────────────────────────────────────────────────────── */

/** Refills due at or before `week` that `applied` (week numbers already paid) does not hold yet. */
export function dueFaabRefills(extras: WaiverExtras, week: number, applied: readonly number[]): WaiverExtras['faabRefills'] {
  const done = new Set(applied)
  return extras.faabRefills.filter((r) => r.week <= week && !done.has(r.week))
}
