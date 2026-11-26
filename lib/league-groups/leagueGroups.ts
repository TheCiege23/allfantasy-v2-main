/**
 * League groups — a commissioner's named set of leagues, across sports and formats.
 *
 * Road To Glory runs seven Fantrax leagues (college football, college basketball, pro) that are one
 * community but nothing on AF ties together: they are not C2C pairs, not a tournament, not one format.
 * A group is the missing name. The commissioner gives each league the same group name; anyone in two or
 * more of those leagues sees them side by side on /league-groups.
 *
 * ⚠ NO NEW TABLE, same rule as the format hubs (lib/core-app/formatHubs.ts). The group lives in
 * `League.settings.league_group` as `{ name, setBy }`, and a group is derived on read. A league is in at
 * most one group, so there is nothing to keep consistent between rows.
 *
 * ⚠ `setBy` IS PART OF THE KEY. Two commissioners who both call a group "Dynasty" are two groups: a
 * manager in both must not see them merged. The name is compared case- and space-insensitively so
 * "Road To Glory" and "road to glory " are one group under one commissioner.
 */

export const LEAGUE_GROUP_NAME_MAX = 40

export type LeagueGroupTag = { name: string; setBy: string }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Collapse runs of whitespace and trim, so the stored name is the one the commissioner meant. */
export function cleanGroupName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function groupKey(tag: LeagueGroupTag): string {
  return `${tag.setBy}::${cleanGroupName(tag.name).toLowerCase()}`
}

/** The league's group, or null. Anything malformed reads as "no group" rather than throwing. */
export function readLeagueGroup(settings: unknown): LeagueGroupTag | null {
  const raw = asRecord(asRecord(settings).league_group)
  const name = typeof raw.name === 'string' ? cleanGroupName(raw.name) : ''
  const setBy = typeof raw.setBy === 'string' ? raw.setBy.trim() : ''
  return name && setBy ? { name, setBy } : null
}

export type LeagueGroupPatchPlan =
  | { ok: true; value: LeagueGroupTag | null }
  | { ok: false; status: 400; error: string }

/**
 * `{ name: "Road To Glory" }` puts the league in that group; `{ name: null }` or `{ name: "" }` takes it
 * out. `setBy` is always the commissioner making the change, never read from the body.
 */
export function planLeagueGroupPatch(body: unknown, userId: string): LeagueGroupPatchPlan {
  const b = asRecord(body)
  if (!('name' in b)) return { ok: false, status: 400, error: 'Send a group name, or an empty name to leave the group.' }
  if (b.name === null) return { ok: true, value: null }
  if (typeof b.name !== 'string') return { ok: false, status: 400, error: 'The group name must be text.' }
  const name = cleanGroupName(b.name)
  if (!name) return { ok: true, value: null }
  if (name.length > LEAGUE_GROUP_NAME_MAX) return { ok: false, status: 400, error: `Keep the group name to ${LEAGUE_GROUP_NAME_MAX} characters.` }
  return { ok: true, value: { name, setBy: userId } }
}

/** The settings object to write: the group set, or the key removed when the league leaves its group. */
export function applyLeagueGroup(settings: unknown, value: LeagueGroupTag | null): Record<string, unknown> {
  const next = { ...asRecord(settings) }
  if (value) next.league_group = { name: value.name, setBy: value.setBy }
  else delete next.league_group
  return next
}

export type GroupableLeague = {
  id: string
  name: string | null
  sport: string
  platform: string
  leagueSize: number | null
  season: number
  userId: string
  settings: unknown
}

export type LeagueGroupCard = {
  id: string
  name: string
  sport: string
  platform: string
  teams: number | null
  season: number
  youCommission: boolean
}

export type LeagueGroupView = {
  key: string
  name: string
  /** True when the reader is the commissioner who named the group. */
  yours: boolean
  leagues: LeagueGroupCard[]
}

const PLATFORM_LABEL: Record<string, string> = { sleeper: 'Sleeper', fantrax: 'Fantrax', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MFL', fleaflicker: 'Fleaflicker' }

export function platformLabel(p: string): string {
  const k = String(p ?? '').trim().toLowerCase()
  if (!k || k === 'native' || k === 'allfantasy' || k === 'af') return 'AllFantasy'
  return PLATFORM_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1)
}

/**
 * Group the reader's leagues. Only the reader's own leagues are passed in, so a group never lists a
 * league they could not open. The group's display name is the commissioner's latest spelling, taken
 * from the newest season. Groups sort by name; leagues inside one sort by sport, then name.
 */
export function groupLeagues(leagues: GroupableLeague[], readerId: string): LeagueGroupView[] {
  const groups = new Map<string, { tag: LeagueGroupTag; season: number; leagues: LeagueGroupCard[] }>()
  for (const l of leagues) {
    const tag = readLeagueGroup(l.settings)
    if (!tag) continue
    const key = groupKey(tag)
    const g = groups.get(key) ?? { tag, season: l.season, leagues: [] }
    if (l.season > g.season) {
      g.tag = tag
      g.season = l.season
    }
    g.leagues.push({
      id: l.id,
      name: l.name?.trim() || 'Unnamed league',
      sport: String(l.sport),
      platform: platformLabel(l.platform),
      teams: l.leagueSize ?? null,
      season: l.season,
      youCommission: l.userId === readerId,
    })
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: g.tag.name,
      yours: g.tag.setBy === readerId,
      leagues: g.leagues.sort((a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
