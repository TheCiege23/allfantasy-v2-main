/**
 * Resolve a player NAME (plus position/team) to a SLEEPER id, reading only the Sleeper namespace.
 *
 * 🛑 WHY THIS EXISTS (2026-10-11). The draft room joined names to `SportsPlayer` with no `source`
 * filter and took the first row Postgres happened to return. `SportsPlayer` holds one person under
 * several sources, and the bare-numeric ones (`rolling_insights`, `backfill`, `cfbd`) are numbers in
 * THEIR OWN space. Measured on production that day:
 *
 *   "Josh Allen"        -> backfill row, externalId 2135  (RI 2135 = Josh Hines-Allen,
 *                                                         Sleeper 2135 = Ha Ha Clinton-Dix)
 *   "Mike Williams"     -> sleeper:748, retired
 *   "Justin Jefferson"  -> could be the CLE linebacker rows
 *
 * The candidates here come from exactly two places, both keyed by Sleeper id:
 *   - `SportsPlayer` rows with `source: 'sleeper'` (Sleeper's own rows, fantasy-shaped fields)
 *   - `PlayerIdentityMap` rows with a `sleeperId` (covers players Sleeper's rows spell differently,
 *     e.g. "Travis Etienne Jr.", "P.J. Walker", and some the Sleeper sync has not written yet)
 *
 * Both are merged BY SLEEPER ID, so one person reached through both is one candidate, never a fake
 * collision. A name is then bound only through `resolveVerifiedMatch`: namesakes are narrowed by
 * position, then team, and REFUSED when that does not leave exactly one.
 */

import { prisma } from '@/lib/prisma'
import {
  buildNameIndex,
  resolveVerifiedMatch,
  type NameMatchCandidate,
} from '@/lib/player-match/verifiedNameMatch'
import { normalizePlayerName, normalizeTeamAbbrev } from '@/lib/team-abbrev'

export interface SleeperCandidate extends NameMatchCandidate {
  /** Bare Sleeper id, e.g. `4984`. */
  sleeperId: string
  name: string
  position: string | null
  /** Team ABBREVIATION (`BUF`), or null for a free agent / unknown. */
  team: string | null
  /** Sleeper's own row image when there is one. */
  imageUrl: string | null
  status: string | null
}

/** A team token usable for matching: abbreviation, or null for "no team" (FA, blank). */
export function matchTeam(raw: string | null | undefined): string | null {
  const t = normalizeTeamAbbrev(raw)
  if (!t || t === 'FA' || t === 'FREE AGENT') return null
  return t
}

const TRAILING_SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?\s*$/i

/** The spellings a `SportsPlayer.name IN (...)` read should try for one raw name. */
function nameVariants(name: string): string[] {
  const base = name.trim()
  if (!base) return []
  const stripped = base.replace(TRAILING_SUFFIX, '').trim()
  return stripped && stripped !== base ? [base, stripped] : [base]
}

/** Sleeper ids are bare numbers. Team defenses (`BUF`) are not players and are not handled here. */
function isNumericSleeperId(id: string | null | undefined): id is string {
  return /^\d+$/.test(String(id ?? '').trim())
}

/**
 * Every Sleeper-namespace candidate for these names. Two reads, never a bare id against
 * `externalId`.
 */
export async function loadSleeperCandidatesByName(
  sport: string,
  names: readonly string[],
): Promise<SleeperCandidate[]> {
  const s = sport.toUpperCase()
  const variants = [...new Set(names.flatMap(nameVariants))]
  if (variants.length === 0) return []
  const keys = [...new Set(variants.map(normalizePlayerName).filter(Boolean))]

  const [sleeperRows, identityRows] = await Promise.all([
    prisma.sportsPlayer.findMany({
      where: { sport: s, source: 'sleeper', name: { in: variants } },
      select: { sleeperId: true, externalId: true, name: true, position: true, team: true, imageUrl: true, status: true },
    }) as Promise<
      Array<{
        sleeperId: string | null
        externalId: string
        name: string
        position: string | null
        team: string | null
        imageUrl: string | null
        status: string | null
      }>
    >,
    keys.length
      ? (prisma.playerIdentityMap.findMany({
          where: { sport: s, sleeperId: { not: null }, normalizedName: { in: keys } },
          select: { sleeperId: true, canonicalName: true, position: true, currentTeam: true },
        }) as Promise<
          Array<{ sleeperId: string | null; canonicalName: string; position: string | null; currentTeam: string | null }>
        >)
      : Promise.resolve([]),
  ])

  const bySleeperId = new Map<string, SleeperCandidate>()
  for (const row of sleeperRows) {
    // Sleeper's own rows write `sleeper:<id>` into externalId; the column is the authority.
    const id = String(row.sleeperId ?? row.externalId.replace(/^sleeper:/, '')).trim()
    if (!isNumericSleeperId(id) || bySleeperId.has(id)) continue
    bySleeperId.set(id, {
      sleeperId: id,
      name: row.name,
      position: row.position ?? null,
      team: matchTeam(row.team),
      imageUrl: row.imageUrl ?? null,
      status: row.status ?? null,
    })
  }
  for (const row of identityRows) {
    const id = String(row.sleeperId ?? '').trim()
    // Already present from Sleeper's own row: the same person, and Sleeper's fields win.
    if (!isNumericSleeperId(id) || bySleeperId.has(id)) continue
    bySleeperId.set(id, {
      sleeperId: id,
      name: row.canonicalName,
      position: row.position ?? null,
      team: matchTeam(row.currentTeam),
      imageUrl: null,
      status: null,
    })
  }
  return [...bySleeperId.values()]
}

export function indexSleeperCandidates(candidates: readonly SleeperCandidate[]): Map<string, SleeperCandidate[]> {
  return buildNameIndex(candidates)
}

/**
 * Bind one lookup to a candidate, or refuse.
 *
 * `teamMayBeStale`: the lookup's team comes from a source that lags trades (the ADP board — measured
 * 2026-10-11, A.J. Brown PHI vs NE, Mike Evans TB vs SF, dozens more in the top 200). Team then only
 * NARROWS namesakes; a lone candidate is refused only when its side of the ball contradicts. Without
 * it, a lone candidate whose team OR side of the ball contradicts is refused.
 */
export function resolveSleeperCandidate(
  index: Map<string, SleeperCandidate[]>,
  lookup: { name: string; position?: string | null; team?: string | null },
  opts: { teamMayBeStale?: boolean } = {},
): SleeperCandidate | null {
  const team = matchTeam(lookup.team)
  const position = lookup.position?.trim() || null
  if (opts.teamMayBeStale) {
    const r = resolveVerifiedMatch(index, { name: lookup.name, position, team })
    if (r.reason !== 'unique_name') return r.match
    return resolveVerifiedMatch(index, { name: lookup.name, position, team: null }, { refuseContradictedSingle: true }).match
  }
  return resolveVerifiedMatch(index, { name: lookup.name, position, team }, { refuseContradictedSingle: true }).match
}
