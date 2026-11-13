/**
 * Server-side Sleeper public HTTP reads for hosted-league draft history.
 * Keeps `api.sleeper.app` URLs out of client components (DB-first API boundary).
 */

const SLEEPER_V1 = 'https://api.sleeper.app/v1'

type SleeperSeasonDraftRowJson = {
  season: string
  leagueId: string
  draftId: string | null
  draft: Record<string, unknown> | null
}

/** Walk previous_league_id chain and load draft metadata per season (Sleeper-hosted leagues). */
export async function fetchSleeperLeagueDraftChain(platformLeagueId: string): Promise<SleeperSeasonDraftRowJson[]> {
  const chain: { season: string; leagueId: string; draftId: string | null }[] = []
  let id: string | null = platformLeagueId.trim()
  for (let depth = 0; depth < 10 && id; depth++) {
    const res = await fetch(`${SLEEPER_V1}/league/${encodeURIComponent(id)}`)
    if (!res.ok) break
    const L = (await res.json()) as Record<string, unknown>
    const season = String(L.season ?? '')
    const did = L.draft_id != null ? String(L.draft_id) : null
    chain.push({ season, leagueId: id, draftId: did })
    const prev = L.previous_league_id
    id = typeof prev === 'string' && prev && prev !== id ? prev : null
  }

  const rows: SleeperSeasonDraftRowJson[] = []
  for (const c of chain) {
    if (!c.draftId) {
      rows.push({ ...c, draft: null })
      continue
    }
    const dr = await fetch(`${SLEEPER_V1}/draft/${encodeURIComponent(c.draftId)}`)
    const draft = dr.ok ? ((await dr.json()) as Record<string, unknown>) : null
    rows.push({ ...c, draft })
  }
  return rows
}

export async function fetchSleeperDraftPicksJson(draftId: string): Promise<unknown[]> {
  const trimmed = draftId.trim()
  if (!trimmed) return []
  const res = await fetch(`${SLEEPER_V1}/draft/${encodeURIComponent(trimmed)}/picks`)
  if (!res.ok) return []
  const data = await res.json().catch(() => null)
  return Array.isArray(data) ? data : []
}
