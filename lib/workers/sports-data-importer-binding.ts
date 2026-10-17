import { createInjuryRowMatcher, foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizePlayerName, normalizePositionForSport } from '@/lib/team-abbrev'

/*
 * ── WHO A SEED IS, AND WHICH ROWS ARE HIS ───────────────────────────────────────────────────────────
 *
 * Pure helpers for `sports-data-importer.ts`. No prisma, no provider.
 *
 * 🛑 THE IMPORTER KEYED EVERYTHING BY NAME (2026-10-11). Seeds, ADP, season stats, projections,
 * dynasty values and news were all `Map<normalizePlayerName(name), …>`, first row wins. Measured on
 * production that day:
 *   - namesakes collapsed to ONE seed per run, so the other athlete's row stopped refreshing — 216 NFL
 *     names belong to two or more Sleeper ids (47 of them reach this importer as two or more
 *     identity-map seeds with Sleeper ids, so ~48 athletes a run were never written);
 *   - the surviving row took the first ADP/stat row with the name: LB Justin Jefferson (CLE) carried
 *     the WR's ADP 21.3, guard Josh Allen carried 12.6, DB DJ Moore carried the WR's 47.5. Of the
 *     1,473 NFL rows written in the previous two days with an ADP, 46 carried one that no 2026 ADP
 *     row of the same name supports by position or team — 41 of them defensive or offensive-line.
 * The draft player modal, `getPlayer` (Trade Center) and start/sit read those columns.
 *
 * The rule now: a name is a KEY, never an identity. Two seeds that Sleeper says are two athletes stay
 * two rows; a value row binds to a seed by an id when it carries one, else by name VERIFIED by
 * position/team through the shared matcher, and an ambiguous name binds to nobody. A missing ADP is a
 * gap; another player's ADP is a false statement.
 */

export type ImporterSeed = {
  id: string
  name: string
  team: string
  position: string
  status?: string | null
  source: string
}

export type SleeperOwnerLike = { sleeperId: string; name: string; position?: string | null }

/** The old precedence, unchanged: the first seed, replaced by every later seed not from the identity map. */
function preferred<T extends ImporterSeed>(current: T | undefined, next: T): T {
  return current === undefined || next.source !== 'manual' ? next : current
}

/**
 * Collapse the per-source seeds to one seed per ATHLETE.
 *
 * `primary` (identity map, provider, paged source — in that order) and `fallback` (seeds invented
 * from ADP and injury rows) are what the importer used to fold into `Map<name, seed>`.
 *
 * Per name:
 *  - when the seeds of that name carry AT MOST ONE Sleeper identity, they are one athlete and fold
 *    exactly as before (first seed, replaced by each later non-identity-map seed). This is every
 *    unique name — `keySeedsToSleeperIdentity` moves all of them onto the one Sleeper id anyway — so
 *    ids, rows and precedence are untouched for them;
 *  - when they carry TWO OR MORE Sleeper ids, each id is its own athlete and its own seed, written
 *    under the canonical `<SPORT>:<sleeperId>` (the form `getPlayer` reads). A seed with no Sleeper id
 *    joins the one athlete its position/team verify against (`resolveVerifiedMatch`), and otherwise is
 *    written under its own id exactly as it was before — never dropped, never guessed onto somebody.
 *
 * A Sleeper identity is a seed whose id is `<SPORT>:<sid>` or `<SPORT>:sleeper:<sid>` (the provider
 * tier's form) where Sleeper assigns `sid` to a player of the SAME normalized name.
 *
 * ⚠ NOT AN IDENTITY MAP ROW. The identity map holds the same athlete twice under two Rolling Insights
 * ids (Austin Hooper, TE ATL, once with Sleeper id 3202 and once without), so "two identity rows" is
 * not "two athletes"; only Sleeper's id is trusted to separate them.
 *
 * ⚠ AND A SPORT WITH NO SLEEPER IDS (NCAAF, every paged college seed) HAS NO ANCHOR, so its namesakes
 * still fold to one seed as before. Their VALUES are verified all the same (`createSeedValueBinder`).
 *
 * `fallback` seeds are added only for names no primary seed has, first one wins — as before.
 */
export function collapseSeedsByIdentity<T extends ImporterSeed>(
  sport: string,
  primary: readonly T[],
  fallback: readonly T[],
  owners: readonly SleeperOwnerLike[],
): T[] {
  const ownerById = new Map<string, { name: string; position: string | null }>()
  for (const owner of owners) {
    const name = normalizePlayerName(owner.name)
    if (name) ownerById.set(owner.sleeperId, { name, position: owner.position?.trim() || null })
  }
  const prefix = `${sport}:`
  const sleeperIdOf = (seed: T, name: string): string | null => {
    if (!seed.id.startsWith(prefix)) return null
    let raw = seed.id.slice(prefix.length)
    if (raw.startsWith('sleeper:')) raw = raw.slice('sleeper:'.length)
    return ownerById.get(raw)?.name === name ? raw : null
  }

  const groups = new Map<string, T[]>()
  for (const seed of primary) {
    const name = normalizePlayerName(seed.name)
    if (!name) continue
    const group = groups.get(name)
    if (group) group.push(seed)
    else groups.set(name, [seed])
  }

  const out: T[] = []
  for (const [name, group] of groups) {
    const anchors = new Map<string, T>()
    const loose: T[] = []
    for (const seed of group) {
      const sid = sleeperIdOf(seed, name)
      if (sid == null) loose.push(seed)
      else anchors.set(sid, preferred(anchors.get(sid), seed))
    }

    if (anchors.size <= 1) {
      out.push(group.reduce<T | undefined>(preferred, undefined)!)
      continue
    }

    // Namesakes. One seed per Sleeper id, on the canonical id.
    const slots = new Map<string, T>()
    for (const [sid, seed] of anchors) slots.set(sid, { ...seed, id: `${prefix}${sid}` })
    const index = buildNameIndex(
      [...slots.entries()].map(([sid, seed]) => ({
        sid,
        name: seed.name,
        position: normalizePositionForSport(sport, ownerById.get(sid)?.position ?? seed.position),
        team: seed.team,
      })),
    )
    const unmatched = new Map<string, T>()
    for (const seed of loose) {
      const hit = resolveVerifiedMatch(index, {
        name: seed.name,
        position: seed.position && seed.position !== 'FLEX' ? normalizePositionForSport(sport, seed.position) : null,
        team: seed.team,
      }).match
      if (hit) {
        const merged = preferred(slots.get(hit.sid), seed)
        slots.set(hit.sid, { ...merged, id: `${prefix}${hit.sid}` })
      } else {
        unmatched.set(seed.id, preferred(unmatched.get(seed.id), seed))
      }
    }
    out.push(...slots.values(), ...unmatched.values())
  }

  const fallbackByName = new Map<string, T>()
  for (const seed of fallback) {
    const name = normalizePlayerName(seed.name)
    if (!name || groups.has(name) || fallbackByName.has(name)) continue
    fallbackByName.set(name, seed)
  }
  out.push(...fallbackByName.values())
  return out
}

/** How many seeds share each `normalizeMatchName` key — the matcher's key, not the seed-grouping one. */
export function countNamesakes(seeds: ReadonlyArray<{ name: string }>): (name: string) => number {
  const counts = new Map<string, number>()
  for (const seed of seeds) {
    const key = normalizeMatchName(seed.name)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return (name) => counts.get(normalizeMatchName(name)) ?? 0
}

export type BindableRow = { name: string; team?: string | null; position?: string | null }

/**
 * Index `rows` once; return `seed → that athlete's rows` (caller's order kept), or `[]`.
 *
 *  1. ID. When `idOf(row)` names the id of a seed written this run, the row belongs to that seed and
 *     to nobody else — it never enters the name index, so a namesake cannot reach it by name.
 *  2. NAME, VERIFIED. Every other row goes through `createInjuryRowMatcher` (one candidate per
 *     name + folded team; several candidates are narrowed by position then team, and still several is
 *     refused; a LONE candidate whose team or side of the ball contradicts the seed is refused — every
 *     index here is partial, so "unique in the index" is not "unique in the league").
 *  3. When the seed's own name is shared with another seed this run, the bind must also be POSITIVE,
 *     row by row: only rows that themselves state the seed's team (not the `FA` placeholder) or its
 *     position are kept. A teamless, positionless row cannot tell two namesakes apart, so it binds
 *     to neither.
 *
 * ⚠ `createInjuryRowMatcher` is the injury reader's matcher, used here unchanged for its binding rule;
 * rows are passed WITHOUT `fetchedAt`, so it keeps the caller's order instead of ranking by claim time.
 */
export function createSeedValueBinder<R>(
  sport: string,
  rows: readonly R[],
  describe: (row: R) => BindableRow,
  opts: {
    namesakes: (name: string) => number
    idOf?: (row: R) => string | null
    seedIds?: ReadonlySet<string>
    /** A row's team in the SEEDS' vocabulary (the seeds' own codes), or null when it cannot be put there. */
    teamOf?: (raw: string | null | undefined) => string | null
    /**
     * Whether two DIFFERENT teams prove two different athletes. True for the NFL, whose 32 codes are
     * one canonical table on both sides. False elsewhere: measured 2026-10-11, MLB records carry 65
     * team codes for 30 clubs and stats rows carry full names ("Arizona Diamondbacks"), so a team
     * mismatch there is a spelling, and refusing on it would strip a player's own stats. Outside the
     * NFL a team can still VERIFY (equal codes), it just cannot refute.
     */
    teamContradicts?: boolean
  },
): (seed: Pick<ImporterSeed, 'id' | 'name' | 'team' | 'position'>) => R[] {
  const teamContradicts = opts.teamContradicts ?? true
  const byId = new Map<string, R[]>()
  const byName: Array<{ playerName: string; team: string | null; position: string | null; evidenceTeam: string | null; row: R }> = []
  for (const row of rows) {
    const id = opts.idOf?.(row) ?? null
    if (id && opts.seedIds?.has(id)) {
      const bucket = byId.get(id)
      if (bucket) bucket.push(row)
      else byId.set(id, [row])
      continue
    }
    const d = describe(row)
    const name = String(d.name ?? '').trim()
    if (!name) continue
    const team = opts.teamOf ? opts.teamOf(d.team) : d.team?.trim() || null
    byName.push({
      playerName: name,
      // What the matcher sees: it narrows AND refutes on team, so it only gets one that may refute.
      team: teamContradicts ? team : null,
      position: normalizePositionForSport(sport, d.position) ?? null,
      evidenceTeam: foldInjuryTeam(team, sport),
      row,
    })
  }
  const match = createInjuryRowMatcher(byName, sport)

  return (seed) => {
    const own = byId.get(seed.id)
    if (own) return own
    const position = seed.position && seed.position !== 'FLEX' ? normalizePositionForSport(sport, seed.position) : null
    const hit = match({ name: seed.name, team: teamContradicts ? seed.team : null, position })
    if (!hit || !('rows' in hit)) return []
    if (opts.namesakes(seed.name) > 1) {
      // Per ROW: the matcher folds a name's teamless rows into its one team-bearing candidate, so
      // "the candidate verifies" would still hand the WR's teamless news to the CB who has a team row.
      const team = foldInjuryTeam(seed.team, sport)
      return hit.rows
        .filter(
          (r) =>
            (team != null && team !== 'FA' && r.evidenceTeam === team) ||
            (position != null && r.position === position),
        )
        .map((r) => r.row)
    }
    return hit.rows.map((r) => r.row)
  }
}

/**
 * Sort key for `PlayerSeasonStats.season`, a STRING: `"2025"` (NFL, MLB) or `"2024-2025"` (NBA, NHL).
 * The starting year, then the ending year; anything unparseable sorts last.
 */
export function seasonSortKey(season: string | null | undefined): number {
  const years = String(season ?? '').match(/\d{4}/g)
  if (!years?.length) return -1
  const start = Number(years[0])
  const end = Number(years[years.length - 1])
  return start * 10_000 + end
}

/**
 * The newest SEASON among one athlete's rows, ties to the newest fetch.
 *
 * 🛑 THE IMPORTER TOOK THE NEWEST *FETCH*, WITH NO SEASON FILTER (2026-10-11). Rolling Insights
 * re-pulls back seasons, so a 2023 line fetched this morning beat the 2026 line fetched last night:
 * replayed on production 2026-10-11, 492 of the 2,533 NFL names the old read reached were written a
 * season other than their newest on file.
 */
export function pickLatestSeasonRow<R extends { season: string; fetchedAt?: Date | null }>(rows: readonly R[]): R | null {
  let best: R | null = null
  for (const row of rows) {
    if (!best) {
      best = row
      continue
    }
    const bySeason = seasonSortKey(row.season) - seasonSortKey(best.season)
    if (bySeason > 0 || (bySeason === 0 && (row.fetchedAt?.getTime() ?? 0) > (best.fetchedAt?.getTime() ?? 0))) best = row
  }
  return best
}
