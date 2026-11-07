/**
 * Which name My team's provider-projection column carries, decided from the rows themselves.
 *
 * 🛑 THE COLUMN SAID "SLEEPER" FOR EVERY LEAGUE. `PROJECTION_PROVIDER_LABEL` was true for the NFL
 * feed (`fantasy_projections`, written by cron/import-projections as `sleeper`), and its own comment
 * warned it would become false the day anything else filled that column. It did: NBA, NHL and MLB
 * rows are priced by AllFantasy's daily-form outlook (myTeamDailySport.ts), and college rows by the
 * AF snapshots — measured on a Fantrax NHL league, 2026-11-05, every hockey player read "SLEEPER".
 *
 * Sources this repo writes, traced to their writers:
 * - `sleeper` — app/api/cron/import-projections (the Sleeper fallback that actually runs);
 * - `allfantasy` — lib/af-projections/writeAfProjectionSnapshots, and the My team passes that price
 *   from AllFantasy's own models (daily-form outlook, college snapshots);
 * - any other value is a provider-chain name from that same cron. It is not named here, because
 *   nothing in the code says which vendor it is — it gets the neutral label.
 *
 * Client-safe: no imports.
 */
export type ProjectionSourceKind = 'sleeper' | 'af' | 'neutral'

const KNOWN: Record<string, Exclude<ProjectionSourceKind, 'neutral'>> = {
  sleeper: 'sleeper',
  allfantasy: 'af',
}

/** One source decides the label; two different ones, or an unnamed vendor, read neutral. */
export function projectionSourceKind(
  sources: Iterable<string | null | undefined>,
  fallback: ProjectionSourceKind,
): ProjectionSourceKind {
  const seen = new Set<ProjectionSourceKind>()
  for (const s of sources) {
    if (!s) continue
    seen.add(KNOWN[s.trim().toLowerCase()] ?? 'neutral')
  }
  if (seen.size === 0) return fallback
  return seen.size === 1 ? [...seen][0] : 'neutral'
}

/**
 * The label when no row carries a source yet (nothing priced this week). It keeps what each league
 * showed before: AllFantasy for the sports only its models price, Sleeper for the NFL feed.
 */
export function defaultProjectionKind(sport: string | null | undefined, platform: string | null | undefined): ProjectionSourceKind {
  const s = String(sport ?? '').trim().toUpperCase()
  const fantrax = String(platform ?? '').trim().toLowerCase() === 'fantrax'
  if (s === 'NBA' || s === 'NHL' || s === 'MLB') return 'af'
  if (fantrax && (s === 'NCAAF' || s === 'NCAAB')) return 'af'
  return 'sleeper'
}

/** A table's projection columns with no value in ANY row — hidden, header included. */
export function emptyProjectionColumns(
  players: ReadonlyArray<{
    afEngineProjectedPoints?: number | null
    market?: { ownPct?: number | null; startPct?: number | null } | null
  } | null | undefined>,
): { engine: boolean; market: boolean } {
  const rows = players.filter((p): p is NonNullable<typeof p> => p != null)
  if (rows.length === 0) return { engine: false, market: false }
  return {
    engine: rows.every((p) => p.afEngineProjectedPoints == null),
    market: rows.every((p) => p.market?.ownPct == null && p.market?.startPct == null),
  }
}
