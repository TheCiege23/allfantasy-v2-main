/**
 * Counting rules for /admin/apps — who uses AllFantasy in the iOS app, the Android
 * app and the browser. Pure: turns query rows into the report. The queries live in
 * ./AppPlatformStatsService.ts and read our own `AnalyticsEvent` "app_open" rows
 * (lib/analytics/appOpen.ts) — no third-party analytics service.
 *
 * Each device sends one app_open row per platform per day, labelled by
 * lib/platform/appPlatform.ts. An unrecognised label folds into "Not labelled yet".
 */

export const APP_WINDOWS = [7, 14, 30] as const

export const APP_PLATFORMS = ["ios_app", "android_app", "web", "unlabelled"] as const
export type AppPlatformKey = (typeof APP_PLATFORMS)[number]

export const APP_PLATFORM_LABEL: Record<AppPlatformKey, string> = {
  ios_app: "iOS app",
  android_app: "Android app",
  web: "Web",
  unlabelled: "Not labelled yet",
}

/** How far back "first seen" looks. Someone last seen longer ago than this counts as new again. */
export const NEW_USER_LOOKBACK_DAYS = 90

export function normalizeWindow(days: unknown): number {
  const n = Number(days)
  return (APP_WINDOWS as readonly number[]).includes(n) ? n : 7
}

/** Query rows as plain arrays: [platform, count, …] or [day, platform, count]. */
export type Rows = Array<Array<unknown>>

export type PlatformRow = {
  platform: AppPlatformKey
  label: string
  /** People active in the window on this platform. Someone on two platforms counts on both. */
  active: number | null
  /** First seen in the window (nothing in the lookback before it), by the platform they arrived on. */
  newUsers: number | null
  /** Of those new people, how many came back on a later day. */
  cameBack: number | null
}

export type DailyRow = { day: string; counts: Record<AppPlatformKey, number> }

export type AppPlatformReport = {
  days: number
  generatedAt: string
  /** Distinct people across every platform — not the sum of the rows, which double-counts. */
  totalActive: number | null
  /** The first app_open row ever recorded (ISO), or null when there is none yet. */
  countingSince: string | null
  platforms: PlatformRow[]
  daily: DailyRow[] | null
  errors: string[]
}

function toPlatform(v: unknown): AppPlatformKey {
  return (APP_PLATFORMS as readonly string[]).includes(String(v)) ? (v as AppPlatformKey) : "unlabelled"
}

function toCount(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

function emptyCounts(): Record<AppPlatformKey, number> {
  return { ios_app: 0, android_app: 0, web: 0, unlabelled: 0 }
}

export function parseTotal(rows: Rows): number {
  return toCount(rows[0]?.[0])
}

/** platform → [a, b] from rows of [platform, a, b?]. An unknown platform folds into "unlabelled". */
function byPlatform(rows: Rows, cols: number[]): Record<AppPlatformKey, number[]> {
  const out = Object.fromEntries(APP_PLATFORMS.map((p) => [p, cols.map(() => 0)])) as Record<AppPlatformKey, number[]>
  for (const row of rows) {
    const p = toPlatform(row[0])
    cols.forEach((c, i) => {
      out[p][i] += toCount(row[c])
    })
  }
  return out
}

export function parseDaily(rows: Rows): DailyRow[] {
  const days = new Map<string, Record<AppPlatformKey, number>>()
  for (const row of rows) {
    const day = String(row[0] ?? "")
    if (!day) continue
    const counts = days.get(day) ?? emptyCounts()
    counts[toPlatform(row[1])] += toCount(row[2])
    days.set(day, counts)
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ day, counts }))
}

export function buildPlatformRows(active: Rows | null, newUsers: Rows | null): PlatformRow[] {
  const a = active ? byPlatform(active, [1]) : null
  const n = newUsers ? byPlatform(newUsers, [1, 2]) : null
  return APP_PLATFORMS.map((platform) => ({
    platform,
    label: APP_PLATFORM_LABEL[platform],
    active: a ? a[platform][0]! : null,
    newUsers: n ? n[platform][0]! : null,
    cameBack: n ? n[platform][1]! : null,
  }))
    // "Not labelled yet" only appears while old, unlabelled events are still in the window.
    .filter((r) => r.platform !== "unlabelled" || (r.active ?? 0) > 0 || (r.newUsers ?? 0) > 0)
}

export function cameBackRate(row: Pick<PlatformRow, "newUsers" | "cameBack">): string {
  if (row.newUsers == null || row.cameBack == null) return "—"
  if (row.newUsers === 0) return "—"
  return `${Math.round((row.cameBack / row.newUsers) * 100)}%`
}
