export const CFBD_ENV_VARS = ["CFBD_API_KEY", "CFBD_KEY", "COLLEGE_FOOTBALL_DATA_API_KEY"] as const

/**
 * Normalize an env-supplied key: trims whitespace and strips a single pair of
 * surrounding quotes. A value like `CFBD_API_KEY="abc"` is loaded literally as
 * `"abc"` (quotes included) by some env loaders, which then fails CFBD auth with
 * a 401. Stripping them here makes the import resilient to that common mistake.
 */
export function normalizeKeyValue(raw: string | undefined | null): string {
  let value = (raw ?? "").trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim()
    }
  }
  return value
}

export function getCfbdApiKey(): string {
  return (
    normalizeKeyValue(process.env.CFBD_API_KEY) ||
    normalizeKeyValue(process.env.CFBD_KEY) ||
    normalizeKeyValue(process.env.COLLEGE_FOOTBALL_DATA_API_KEY) ||
    ""
  )
}

export function hasCfbdApiKey(): boolean {
  return Boolean(getCfbdApiKey())
}
