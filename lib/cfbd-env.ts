export const CFBD_ENV_VARS = ["CFBD_API_KEY", "CFBD_KEY", "COLLEGE_FOOTBALL_DATA_API_KEY"] as const

/**
 * Trim a key and strip a MATCHED pair of surrounding quotes.
 *
 * `CFBD_KEY="abc123"` in a dotenv file is read back with the quotes still
 * attached by some loaders, and the quotes then travel in the Authorization
 * header — which CFBD answers with a 401. That failure is especially nasty
 * because the key looks correct everywhere you would print it.
 *
 * Only a MATCHED pair is stripped. A stray leading quote is left alone: it is
 * more likely part of a genuinely malformed value than a quoting artefact, and
 * silently rewriting it would hide the real problem.
 */
export function normalizeKeyValue(raw: string | null | undefined): string {
  const v = (raw ?? "").trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1).trim()
  }
  return v
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
