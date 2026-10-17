/**
 * Stored team crests (`SportsTeam.logo`), resolvable from the team STRING a surface already has —
 * "Ohio State University", "Vanderbilt", "Memphis Grizzlies", a soccer RI team id.
 *
 * WHY. Outside the NFL the static registry cannot produce a working logo from those strings:
 * ESPN keys college and soccer crests by numeric id, and a full name becomes a path like
 * `nba/500/memphisgrizzlies.png`. Every one of those 404s. The crests themselves have been in the
 * database all along — every NBA/MLB/NHL team, every FBS/FCS school, college basketball and the
 * Premier League (measured 2026-10-01, every sampled URL loading) — they just were not read.
 *
 * This reuses the draft pool's matcher (`buildTeamLogoResolver`): exact name → loose name →
 * college aliases → soccer id, best source first, refusing ambiguity. It is cached per sport
 * because team rows change weekly at most and a roster or player list resolves dozens of teams.
 *
 * Server-only (reads the database). Never throws: a logo is decoration.
 */
import { loadDraftPoolTeamLogoResolver } from '@/lib/draft-room/draftPoolTeamLogos'

type Resolver = (team: string | null | undefined) => string | null

const TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; resolver: Promise<Resolver> }>()

/** `SportsTeam.sport` spelling for a league sport — Rolling Insights' college codes differ. */
function storedSportKey(sport: string): string {
  const u = String(sport ?? '').trim().toUpperCase()
  if (u === 'NCAAFB') return 'NCAAF'
  if (u === 'NCAABB') return 'NCAAB'
  if (u === 'EPL' || u === 'MLS') return 'SOCCER'
  return u
}

/** A resolver for one sport's stored crests, cached for ten minutes. */
export function getStoredTeamLogoResolver(sport: string, now: number = Date.now()): Promise<Resolver> {
  const key = storedSportKey(sport)
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.resolver
  const resolver = loadDraftPoolTeamLogoResolver(key).catch((): Resolver => () => null)
  cache.set(key, { at: now, resolver })
  return resolver
}

/** Test seam: forget cached resolvers. */
export function clearStoredTeamLogoCache(): void {
  cache.clear()
}
