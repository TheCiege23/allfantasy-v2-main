/**
 * The Player Finder guide (2026-11-13). The owner's ask: on game day an injury or questionable alert
 * should land on the player, and the page should say plainly what it is for — find a player by name or
 * by TEAM, separated by sport, and see every league and platform you have him in.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */
import { NFL_TEAMS } from '@/lib/sports-data-gateway/teamIdentity'
import { playerRef } from '@/lib/core-app/playerRef'

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * The team codes a search names ("Bills", "buffalo", "Buffalo Bills", "BUF" → BUF), so a search can
 * also match the catalog's `team` column. NFL has names, cities and aliases (teamIdentity.ts); for the
 * other sports a 2–4 letter query is tried as a team code as it stands ("LAL", "BOS").
 *
 * ⚠ HISTORICAL ALIASES ARE NOT RETURNED AS CODES. "OAK" still finds the Raiders, but matching the
 * catalog on "OAK" would surface stale rows still carrying the old code as if they were today's roster.
 */
export function teamCodesForQuery(query: string, sport?: string | null): string[] {
  const q = norm(query)
  if (q.length < 2) return []
  const codes = new Set<string>()
  if (!sport || sport === 'NFL') {
    for (const t of NFL_TEAMS) {
      const abbr = t.currentAbbreviation.toLowerCase()
      const name = t.currentName.toLowerCase()
      const city = (t.city ?? '').toLowerCase()
      const historical = new Set(t.historicalAliases.map((h) => h.value.toUpperCase()))
      const aliases = t.aliases.map((a) => a.toLowerCase())
      const hit =
        q === abbr ||
        aliases.includes(q) ||
        q === name ||
        (q.length >= 4 && name.startsWith(q)) ||
        (city !== '' && q === city) ||
        q === `${city} ${name}`.trim()
      if (!hit) continue
      codes.add(t.currentAbbreviation.toUpperCase())
      for (const a of t.aliases) if (!historical.has(a.toUpperCase())) codes.add(a.toUpperCase())
    }
  }
  if ((!sport || sport !== 'NFL') && /^[a-z]{2,4}$/.test(q)) codes.add(q.toUpperCase())
  return [...codes]
}

/**
 * Where an injury or news alert about a player should land: the Player Finder's view of THAT player,
 * which lists every league and platform you have him in. With no Sleeper id the alert still lands on
 * the finder, searched for his name in his sport, one tap from the same view.
 */
export function finderPlayerHref(p: {
  sport?: string | null
  sleeperId?: string | null
  /** The catalog id and the feed that minted it, when the sender has them — exact for every sport. */
  externalId?: string | null
  source?: string | null
  name?: string | null
}): string {
  const sport = (p.sport ?? 'NFL').toUpperCase()
  const sportParam = sport === 'NFL' ? '' : `&sport=${encodeURIComponent(sport)}`
  const q = p.name?.trim() ? `q=${encodeURIComponent(p.name.trim())}` : ''
  /*
   * ⚠ A SLEEPER ID IS A CATALOG REF ONLY IN THE NFL. The finder looks a ref up by `externalId` within
   * the source it names, and only the NFL catalog carries `source: 'sleeper'` rows keyed on the Sleeper
   * id. Another sport's Sleeper id as a ref would open nobody, so those alerts land on his name instead.
   */
  const ref =
    p.externalId && p.source
      ? playerRef(sport, p.externalId, p.source)
      : p.sleeperId && sport === 'NFL'
        ? playerRef(sport, p.sleeperId, 'sleeper')
        : null
  if (ref) return `/core/players?${q ? `${q}&` : ''}player=${encodeURIComponent(ref)}${sportParam}`
  return q ? `/core/players?${q}${sportParam}` : '/core/players'
}

/** The count at the top of a player's every-league list. */
export type LeagueCount = {
  /** Leagues where he is on YOUR team. */
  yours: number
  /** Leagues the finder read. */
  of: number
  starting: number
  benched: number
  /** Leagues where someone else has him. */
  others: number
}

export function leagueCountOf(input: {
  yours: number
  of: number
  starting: number
  others: number
}): LeagueCount {
  const yours = Math.max(0, input.yours)
  const starting = Math.max(0, Math.min(yours, input.starting))
  return { yours, of: Math.max(0, input.of), starting, benched: yours - starting, others: Math.max(0, input.others) }
}

/** A team's players in the finder ("BUF" in the NFL) — where a several-player team alert lands. */
export function finderTeamHref(team: string, sport?: string | null): string {
  const s = (sport ?? 'NFL').toUpperCase()
  return `/core/players?q=${encodeURIComponent(team.trim())}${s === 'NFL' ? '' : `&sport=${encodeURIComponent(s)}`}`
}
