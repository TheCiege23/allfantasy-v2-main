import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Bind `SportsInjury` rows to the players a caller asked about — by name, VERIFIED by team and
 * position when a name belongs to more than one athlete. Pure: callers keep their own query (its
 * recency window, its ordering, its fields) and pass the rows through this.
 *
 * 🛑 A NAME IS NOT AN IDENTITY. Measured 2026-10-11: 15 names belong to 2+ active NFL players, and
 * 7 of them had live injury rows at once — the Vikings WR Justin Jefferson was Questionable while a
 * Browns LB Justin Jefferson was Active; the Jaguars CB Jaylon Jones was Out while a Titans DB of the
 * same name was Active. A reader keyed on `playerName` and taking the newest row hands one of them the
 * other's designation, and for a star that reads as "healthy" on the day he is questionable.
 *
 * Rules, the same ones `injuryReadPort.resolveInjuryFacts` and dash34 use:
 *  - rows are grouped into one candidate per (name, team) — the same athlete reported by several
 *    providers is ONE candidate, not a collision;
 *  - one candidate → bind; several → narrow by position, then team; still several → REFUSE.
 *    A missing badge is a gap; another player's badge is a falsehood.
 *
 * ⚠ NFL TEAMS ARE FOLDED TO CODES ON BOTH SIDES. Injury feeds write "Minnesota Vikings"; rosters say
 * "MIN". `resolveVerifiedMatch` compares teams verbatim, so without the fold team narrowing never
 * fires and every shared name is refused even when the caller knew the team. Other sports pass
 * through upper-cased, which is what the matcher does to them anyway.
 *
 * ⚠ A ROW WITH NO TEAM joins its name's only team-bearing candidate when there is exactly one, and is
 * its own candidate otherwise — so it can never tip a genuine collision either way.
 */

export interface InjuryRowLike {
  playerName: string
  team?: string | null
  position?: string | null
  /** The provider's report time. With `fetchedAt`, orders a player's rows by claim (see below). */
  date?: Date | null
  fetchedAt?: Date | null
}

/**
 * How fresh a row's claim can be: the OLDER of the provider's report date and our fetch. The same
 * clock `injuryReadPort` ranks by — a report written last week is not news because we re-pulled it
 * this morning, and a row we last saw yesterday says nothing about today whatever its `date` says.
 */
export function injuryClaimAsOf(row: { date?: Date | null; fetchedAt?: Date | null }): Date {
  const fetched = row.fetchedAt ?? row.date ?? new Date(0)
  const reported = row.date ?? fetched
  return reported.getTime() < fetched.getTime() ? reported : fetched
}

export interface InjuryPlayerLookup {
  name: string
  team?: string | null
  position?: string | null
}

export interface InjuryRowMatch<R> {
  /** Keyed by `normalizeMatchName(lookup.name)`. Rows keep the caller's order. */
  byPlayer: Map<string, R[]>
  /** Lookup names refused because the name belongs to several athletes we could not tell apart. */
  ambiguous: string[]
}

export function foldInjuryTeam(team: string | null | undefined, sport: string | null | undefined): string | null {
  const raw = String(team ?? '').trim()
  if (!raw) return null
  return String(sport ?? '').toUpperCase() === 'NFL' ? normalizeTeamAbbrev(raw) : raw.toUpperCase()
}

export type InjuryRowLookupResult<R> = { rows: R[] } | { ambiguous: true } | null

/**
 * Index the rows ONCE and resolve players against it — for a caller resolving thousands of players
 * against one load (the projection writer), where rebuilding per player would be quadratic.
 * `null` means no row names this player (no news); `{ ambiguous: true }` means the name belongs to
 * several athletes the lookup could not tell apart.
 */
export function createInjuryRowMatcher<R extends InjuryRowLike>(
  rows: readonly R[],
  sport: string,
): (player: InjuryPlayerLookup) => InjuryRowLookupResult<R> {
  type Candidate = { name: string; team: string | null; position: string | null; rows: R[] }
  const byName = new Map<string, Map<string, Candidate>>()
  for (const row of rows) {
    const name = normalizeMatchName(row.playerName)
    if (!name) continue
    const team = foldInjuryTeam(row.team, sport)
    const teams = byName.get(name) ?? new Map<string, Candidate>()
    const key = team ?? ''
    const c = teams.get(key) ?? { name: row.playerName, team, position: null, rows: [] }
    c.rows.push(row)
    if (!c.position && row.position?.trim()) c.position = row.position.trim().toUpperCase()
    teams.set(key, c)
    byName.set(name, teams)
  }

  const candidates: Candidate[] = []
  for (const teams of byName.values()) {
    const teamless = teams.get('')
    const withTeam = [...teams.values()].filter((c) => c.team)
    if (teamless && withTeam.length === 1) {
      const only = withTeam[0]!
      only.rows = [...only.rows, ...teamless.rows]
      only.position ??= teamless.position
      candidates.push(only)
    } else {
      candidates.push(...teams.values())
    }
  }
  /*
   * Newest CLAIM first, then the caller's order. Rows that carry `fetchedAt` are ordered by
   * `injuryClaimAsOf`, the clock the read port uses; rows without it keep the caller's order.
   *
   * 🛑 CALLERS ORDERED BY `fetchedAt` / `updatedAt`, AND THAT IS WHEN WE PULLED A ROW, NOT WHEN IT
   * WAS SAID (2026-10-11). Rolling Insights re-pulls Friday's "Questionable for Week 5" every 30
   * minutes, so on Sunday it out-ranked ESPN's "Active" from that morning whenever its run landed
   * later — Ja'Marr Chase, Justin Jefferson, Ashton Jeanty and 12 more read Questionable after
   * being cleared, flipping with every cron run.
   */
  const order = new Map<R, number>()
  rows.forEach((r, i) => order.set(r, i))
  for (const c of candidates) {
    c.rows.sort((x, y) => {
      if (x.fetchedAt && y.fetchedAt) {
        const byClaim = injuryClaimAsOf(y).getTime() - injuryClaimAsOf(x).getTime()
        if (byClaim !== 0) return byClaim
      }
      return order.get(x)! - order.get(y)!
    })
  }

  const index = buildNameIndex(candidates)
  return (p) => {
    if (!normalizeMatchName(p.name)) return null
    const res = resolveVerifiedMatch(
      index,
      {
        name: p.name,
        position: p.position?.trim().toUpperCase() || null,
        team: foldInjuryTeam(p.team, sport),
      },
      // The index holds only athletes WITH a row, so a lone candidate is not proof of identity.
      { refuseContradictedSingle: true },
    )
    if (res.reason === 'ambiguous') return { ambiguous: true }
    return res.match ? { rows: res.match.rows } : null
  }
}

export function matchInjuryRowsToPlayers<R extends InjuryRowLike>(
  rows: readonly R[],
  players: readonly InjuryPlayerLookup[],
  sport: string,
): InjuryRowMatch<R> {
  const match = createInjuryRowMatcher(rows, sport)
  const byPlayer = new Map<string, R[]>()
  const ambiguous: string[] = []
  for (const p of players) {
    const key = normalizeMatchName(p.name)
    if (!key || byPlayer.has(key)) continue
    const res = match(p)
    if (!res) continue
    if ('ambiguous' in res) ambiguous.push(p.name)
    else byPlayer.set(key, res.rows)
  }
  return { byPlayer, ambiguous }
}

/**
 * `player → newest status`, for the readers that used to build `Map<name, status>` with "first row
 * wins". Same binding as `createInjuryRowMatcher`: the athlete's OWN rows, refused (null) when a
 * shared name cannot be told apart. Pass `date` and `fetchedAt` so the newest CLAIM wins; without
 * them rows must arrive newest first. A row with no status is skipped.
 */
export function injuryStatusLookup<R extends InjuryRowLike & { status: string | null }>(
  rows: readonly R[],
  sport: string,
): (player: InjuryPlayerLookup) => string | null {
  const match = createInjuryRowMatcher(rows.filter((r) => Boolean(r.status)), sport)
  return (player) => {
    const hit = match(player)
    return hit && 'rows' in hit ? hit.rows[0]?.status ?? null : null
  }
}

/** Statuses that state no designation: a cleared player ("Active") is not an injury item. */
export function isInjuryDesignation(status: string | null | undefined): boolean {
  const t = String(status ?? '').trim().toLowerCase()
  return t !== '' && t !== 'active' && t !== 'healthy' && t !== 'na'
}

/**
 * One row per athlete (normalized name + folded team): his newest CLAIM. For LIST readers — "current
 * injuries" panels and AI context — which used to filter `status <> 'Active'` in SQL.
 *
 * 🛑 FILTERING "ACTIVE" OUT BEFORE PICKING THE NEWEST IS HOW A CLEARED PLAYER STAYS HURT. Rolling
 * Insights' Friday "Questionable" and ESPN's Sunday "Active" are both live rows; drop the Active one
 * first and the Questionable is all that is left. Pick the newest claim, THEN drop non-designations.
 */
export function latestInjuryClaims<R extends InjuryRowLike>(rows: readonly R[], sport: string): R[] {
  const best = new Map<string, R>()
  for (const row of rows) {
    const name = normalizeMatchName(row.playerName)
    if (!name) continue
    const key = `${name}|${foldInjuryTeam(row.team, sport) ?? ''}`
    const cur = best.get(key)
    if (!cur) {
      best.set(key, row)
      continue
    }
    const byClaim = injuryClaimAsOf(row).getTime() - injuryClaimAsOf(cur).getTime()
    if (byClaim > 0 || (byClaim === 0 && (row.fetchedAt?.getTime() ?? 0) > (cur.fetchedAt?.getTime() ?? 0))) best.set(key, row)
  }
  return [...best.values()].sort((a, b) => injuryClaimAsOf(b).getTime() - injuryClaimAsOf(a).getTime())
}
