/** Date and team-colour helpers shared by the NBA Cup cards and matchup sheet. */

export function tipoffLabel(iso: string | null | undefined, opts: { weekday?: "short" | "long"; year?: boolean; timeZone?: string } = {}): string | null {
  const ms = Date.parse(iso ?? "")
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: opts.weekday ?? "short", month: opts.weekday === "long" ? "long" : "short", day: "numeric",
    ...(opts.year ? { year: "numeric" as const } : {}), timeZone: opts.timeZone,
  }).format(date)
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: opts.timeZone }).format(date)
  return `${day} · ${time}`
}

export function timeOnly(iso: string | null | undefined, timeZone?: string): string | null {
  const ms = Date.parse(iso ?? "")
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(new Date(ms))
}

/** Local calendar day, for grouping a slate the way the viewer experiences it. */
export function localDayKey(iso: string | null | undefined, timeZone?: string): string {
  const ms = Date.parse(iso ?? "")
  if (!Number.isFinite(ms)) return "tba"
  const d = new Date(ms)
  if (timeZone === "UTC") return d.toISOString().slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function dayHeading(key: string, now = new Date(), timeZone?: string, relative = true): string {
  if (key === "tba") return "Date to be announced"
  const [y, m, d] = key.split("-").map(Number)
  const utc = timeZone === "UTC"
  const date = utc ? new Date(Date.UTC(y, m - 1, d)) : new Date(y, m - 1, d)
  const label = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone }).format(date)
  if (!relative) return label
  const today = utc ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return `Today · ${label}`
  if (diff === 1) return `Tomorrow · ${label}`
  if (diff === -1) return `Yesterday · ${label}`
  return label
}

/** "in 2h 14m", "in 3d 4h", or null once the time has passed. */
export function countdown(iso: string | null | undefined, now = Date.now()): string | null {
  const ms = Date.parse(iso ?? "") - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Team colour as a dark tint and an edge, mixed against the board's own background. */
export function teamTint(hex: string | null | undefined): { tint: string; edge: string } | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null
  return {
    tint: `color-mix(in srgb, ${hex} 20%, #06070f)`,
    edge: `color-mix(in srgb, ${hex} 55%, #06070f)`,
  }
}

