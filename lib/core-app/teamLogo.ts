import { getTeamByAbbreviation, logoUrlForAbbrev } from '@/lib/sport-teams/SportTeamMetadataRegistry'
import { getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * The crest for a player's team, or nothing.
 *
 * `SportsPlayer.team` is an abbreviation on production (NYJ, ARI, CAR — 8,536
 * identified NFL rows carry NULL, the free agents and retirees), and the
 * fixtures in this screen use full names; `normalizeTeamAbbrev` folds both, so
 * either spelling lands on the same ESPN CDN path.
 *
 * ⚠ NULL BEATS A GUESS. The registry will happily build a URL for any string
 * ("FA", "Free Agent", a stray vendor code) and the CDN 404s it, leaving a
 * broken-image glyph beside a real name. So a logo is returned only for a
 * team the registry actually knows, and the `<img>` that renders it still
 * hides itself on error for the day the CDN moves.
 *
 * Client-safe: the registry and the abbreviation table are pure.
 */

const SPORTS = new Set(['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'])

export function teamLogoUrl(sport: string | null | undefined, team: string | null | undefined): string | null {
  const s = sport?.trim().toUpperCase()
  const t = team?.trim()
  if (!s || !t || !SPORTS.has(s)) return null
  if (s === 'NFL') {
    const abbrev = normalizeTeamAbbrev(t)
    // `normalizeTeamAbbrev` upper-cases anything it cannot fold; only a canonical club gets a crest.
    return abbrev && getTeamInfo(abbrev) ? logoUrlForAbbrev('NFL', abbrev) : null
  }
  const known = getTeamByAbbreviation(s, t)
  return known?.primary_logo_url ?? null
}
