import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * The in-app player profile link for a player known only by NAME: `/player/<name-slug>?sport=&position=&team=`.
 *
 * `/player/[playerId]` (app/player/[playerId]/resolvePlayerIdentity.ts) resolves the slug against
 * `PlayerIdentityMap.normalizedName` in ONE sport, narrows by position and team, and shows a "which
 * one?" chooser rather than guessing when namesakes remain. So pass every field you have — a name
 * alone defaults to NFL and can land on the chooser.
 *
 * The slug is built from the SAME normalizer that writes `normalizedName` (lib/team-abbrev.ts), not a
 * bare `toLowerCase()`: that kept "Jr." and "St." and so could never match "marvin harrison" or
 * "amon-ra st brown" (2026-11-12). In-name hyphens survive as hyphens; the resolver tries both readings.
 *
 * When you hold a Sleeper id, the public `/players/<slug>` page (lib/core-app/playerSlug.ts `playerPath`)
 * names exactly one person and is the better link.
 *
 * Returns null for a name with nothing to slug.
 */
export function playerProfileHref(input: {
  name: string
  sport?: string | null
  position?: string | null
  team?: string | null
}): string | null {
  const slug = normalizePlayerName(input.name ?? '').replace(/\s+/g, '-')
  if (!slug) return null
  const q = new URLSearchParams()
  const sport = input.sport?.trim().toUpperCase()
  if (sport) q.set('sport', sport)
  const position = input.position?.trim()
  if (position) q.set('position', position)
  const team = input.team?.trim()
  if (team) q.set('team', team)
  const qs = q.toString()
  return `/player/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`
}
