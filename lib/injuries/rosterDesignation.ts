/*
 * Pure, no prisma and no `server-only`: the 6-hourly importer writes `SportsPlayerRecord.injuryStatus`
 * through it, and request paths that fall back to a stored or roster status must apply the same rule.
 */

/**
 * A ROSTER status that is also an availability designation. Everything else Sleeper and Rolling
 * Insights put in `status` — "Active", "Inactive", "Practice Squad", RI's "ACT"/"INACT" — is roster
 * bookkeeping, not an injury, and is never written as one.
 */
export function rosterDesignation(status: string | null | undefined): string | null {
  const t = String(status ?? '').trim().toLowerCase()
  if (!t) return null
  if (t === 'ir' || t.includes('injured reserve')) return 'IR'
  if (t === 'pup' || t.includes('physically unable')) return 'PUP'
  if (t === 'nfi' || t.includes('non football') || t.includes('non-football')) return 'NFI'
  if (t.startsWith('suspen') || t === 'sus') return 'Suspended'
  return null
}
