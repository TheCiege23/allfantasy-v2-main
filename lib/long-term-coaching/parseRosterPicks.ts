/** Extract future draft pick capital from synced roster JSON (Sleeper-style). */

type ParsedDraftPick = {
  season: number
  round: number
  weightScore: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

/**
 * Weight picks: earlier rounds & farther seasons score higher (deterministic, auditable).
 */
export function parseDraftPicksFromPlayerData(playerData: unknown, leagueSeason: number): ParsedDraftPick[] {
  const pd = asRecord(playerData)
  if (!pd) return []
  const raw = pd['draftPicks']
  if (!Array.isArray(raw)) return []
  const out: ParsedDraftPick[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') continue
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const season = typeof r.season === 'number' ? r.season : Number(r.season) || leagueSeason
    const round = typeof r.round === 'number' ? r.round : Number(r.round) || 7
    const rd = Math.min(20, Math.max(1, round))
    const yearsOut = Math.max(0, season - leagueSeason)
    const roundWeight = Math.max(0, 13 - rd)
    const weightScore = roundWeight * (1 + yearsOut * 0.12)
    out.push({ season, round: rd, weightScore })
  }
  return out
}

export function sumPickCapitalScore(picks: ParsedDraftPick[]): number {
  if (picks.length === 0) return 0
  const raw = picks.reduce((a, p) => a + p.weightScore, 0)
  return Math.min(100, raw * 2.5)
}
