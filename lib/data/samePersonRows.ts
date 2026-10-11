import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * Player rows that are COPIES of one athlete, collapsed to one — and namesakes left alone.
 *
 * 🛑 `sports_players` HOLDS A PLAYER ONCE PER SOURCE. Juan Soto is `MLB:2354` (Rolling Insights),
 * `MLB:tsdb_34166384` (TheSportsDB) and `MLB:juan-soto:NEW YORK METS`; searching "Skubal" listed three
 * Tarik Skubals, two at LAD and one at DETROIT TIGERS (2026-10-11). Measured in production that day: of the
 * names carried by more than one row, ONE identity holds 1,517 of 1,562 in MLB, 1,621 of 1,629 in the
 * NBA and 1,782 of 1,798 in the NHL.
 *
 * ⚠ BUT SOME ARE NAMESAKES — Will Smith is the Dodgers' catcher and a Royals pitcher; four Luis Garcias are
 * on file — so rows are never merged on the name alone. `PlayerIdentityMap` keeps one row per athlete (the
 * id space the projection board is keyed on), and decides per name: one identity in this sport, and that
 * name's rows are his; two or more, none, or a map that cannot be read, and they stay as they are. The
 * analyzer's typed-name lookup and the player search both use this, so a name the analyzer accepts is a
 * name the search shows once.
 *
 * The row kept is the one keyed on his OWN id — his Sleeper id in the NFL (`NFL:<sleeperId>`, which is what
 * the importer writes since 2026-09-28), his Rolling Insights id elsewhere (`<SPORT>:<riId>`, which carries
 * the current club; Skubal's 2026 rows say LAD, an April copy still says DETROIT TIGERS) — else the first of
 * his rows in the order given (the search returns the newest first). It takes the place of his first row;
 * every other row keeps its order.
 */
export async function collapseSamePersonRows<
  T extends { id: string; name: string; team?: string | null; lastUpdated?: Date | string | null },
>(
  rows: readonly T[],
  sport: string,
  opts: {
    /**
     * Drop a copy of a shared name that is older than this, measured from the name's FRESHEST row —
     * i.e. a row the importer stopped writing while it went on writing that name under another id.
     * Omitted, nothing is dropped for age. See the note in the body.
     */
    staleAfterMs?: number
  } = {},
): Promise<T[]> {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const key = normalizePlayerName(r.name)
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(r)
    else groups.set(key, [r])
  }
  const shared = [...groups].filter(([, g]) => g.length > 1).map(([key]) => key)
  if (shared.length === 0) return [...rows]

  let people: Array<{ normalizedName: string; rollingInsightsId: string | null; sleeperId?: string | null }>
  try {
    people = await prisma.playerIdentityMap.findMany({
      where: { sport, normalizedName: { in: shared } },
      select: { normalizedName: true, rollingInsightsId: true, sleeperId: true },
    })
  } catch {
    return [...rows]
  }
  const identities = new Map<string, typeof people>()
  for (const p of people) identities.set(p.normalizedName, [...(identities.get(p.normalizedName) ?? []), p])

  const finals = new Map<string, T[]>()
  for (const key of shared) {
    const ids = identities.get(key) ?? []
    const original = groups.get(key)!
    let group = original
    const ownIds = new Set(ids.map((p) => ownIdOf(sport, p)).filter((id): id is string => Boolean(id)))

    /*
     * 🛑 A COPY THE IMPORTER STOPPED WRITING IS NOT A SECOND OPINION (2026-10-11). Searching "Josh Allen"
     * in production returned FOUR rows: `NFL:4984`, written that night, and `NFL:sleeper:2212` (a guard
     * carrying a QB's stat line and ADP 12.6), `NFL:sleeper:4984` and `NFL:josh-allen:BUF`, last written
     * 09-25, 09-18 and 09-07 under id forms the importer no longer produces for him. The AI context took
     * all four as `players` and was handed three conflicting Josh Allens.
     *
     * Measured against the NAME'S freshest row, not the clock: NCAAB, NCAAF and SOCCER had NO row inside
     * the 6 h TTL that evening (newest 10-10), and NFL rows such as Rondale Moore's are written by runs
     * that do not rewrite the whole sport — a wall-clock cut would delete real, current players. A row is
     * dropped only when a newer row OF THE SAME NAME shows the importer still writing that name.
     *
     * ⚠ AN ATHLETE'S OWN-ID ROW IS NEVER DROPPED FOR AGE. A stray writer (the image importer bumps
     * `lastUpdated`) can make an orphan the freshest copy; without this exception the orphan would then
     * outlive the importer's real row.
     */
    if (opts.staleAfterMs != null) {
      const times = group.map((r) => toTime(r.lastUpdated))
      const known = times.filter((t): t is number => t != null)
      if (known.length > 0) {
        const cutoff = Math.max(...known) - opts.staleAfterMs
        group = group.filter((r, i) => ownIds.has(r.id) || times[i] == null || times[i]! >= cutoff)
      }
    }

    if (ids.length === 1 && group.length > 1) {
      const chosen = group.find((r) => ownIds.has(r.id)) ?? group[0]!
      /*
       * ⚠ SOCCER'S ROLLING INSIGHTS ROWS CARRY A CLUB NUMBER, NOT A CLUB: 1,103 of 1,264 read "13" where
       * Haaland's TheSportsDB copy reads "MNC" (production, 2026-10-11; no other sport has one). The row
       * stays his — its id is the one the board answers to — and the club is taken from a copy that names it.
       */
      const named = isClubNumber(chosen.team) ? group.find((r) => r.team?.trim() && !isClubNumber(r.team)) : undefined
      group = [named ? { ...chosen, team: named.team } : chosen]
    }
    if (group !== original) finals.set(key, group)
  }
  if (finals.size === 0) return [...rows]

  const out: T[] = []
  const placed = new Set<string>()
  for (const r of rows) {
    const key = normalizePlayerName(r.name)
    const kept = finals.get(key)
    if (!kept) {
      out.push(r)
      continue
    }
    if (placed.has(key)) continue
    placed.add(key)
    out.push(...kept)
  }
  return out
}

/**
 * Sports whose bare `<SPORT>:<n>` ids are SLEEPER ids. The importer keys a player to his Sleeper id
 * wherever Sleeper owns one (`keySeedsToSleeperIdentity`), and its owners come from `SportsPlayer` rows
 * with `source = 'sleeper'` — NFL only in production (11,960 rows, 2026-10-11). An NFL row at
 * `NFL:<rollingInsightsId>` is a LEGACY row from before 2026-09-28, when RI's id for Trent McDuffie was
 * written over Joe Burrow's Sleeper id; it is never anybody's own-id row.
 */
const SLEEPER_KEYED_SPORTS = new Set(['NFL'])

/** The id the importer writes this athlete under now: his Sleeper id in the NFL, else his RI id. */
function ownIdOf(sport: string, person: { rollingInsightsId: string | null; sleeperId?: string | null }): string | null {
  const raw = SLEEPER_KEYED_SPORTS.has(sport) ? person.sleeperId : person.rollingInsightsId
  const id = raw?.trim()
  return id ? `${sport}:${id}` : null
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null
  const t = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/**
 * Each row with a `label` naming who it is — "Josh Allen (QB, BUF)" — and `namesake: true` when another
 * row in the list carries the same name. Rows that survive `collapseSamePersonRows` under one name are
 * DIFFERENT athletes (Will Smith the Dodgers catcher and the Royals pitcher), and a model reading a list of
 * bare names cannot tell them apart; the label is what lets it say which one it means.
 */
export function labelPlayerRows<T extends { name: string; position?: string | null; team?: string | null }>(
  rows: readonly T[],
): Array<T & { label: string; namesake?: true }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = normalizePlayerName(r.name)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return rows.map((r) => {
    const detail = [r.position?.trim(), r.team?.trim()].filter(Boolean).join(', ')
    const label = detail ? `${r.name} (${detail})` : r.name
    return (counts.get(normalizePlayerName(r.name)) ?? 0) > 1
      ? { ...r, label, namesake: true as const }
      : { ...r, label }
  })
}

function isClubNumber(team: string | null | undefined): boolean {
  return /^\d+$/.test(String(team ?? '').trim())
}
