/**
 * Which ONE player a `player_news` row is about, and that player's team — decided from the identity
 * registry, never from the row's own `team` tag.
 *
 * 🛑 THE ROW'S `team` IS OFTEN NOT THE PLAYER'S TEAM (measured 2026-10-11). Over 30 days of NFL news,
 * for names that map to exactly one player, the tag disagreed with that player's canonical team on
 * 804 of 2,077 tagged `newsapi_everything` rows, 356 of 1,942 `espn` rows and 82 of 199
 * `newsapi_headlines` rows. The extractor tags whatever club the article names — usually the
 * OPPONENT. "Burrow throws 4 TDs… Bengals beat Dolphins" was stored as Ja'Marr Chase / MIA. Trusting
 * that tag did two wrong things at once: a club gate on the roster lookup silently DROPPED the story
 * for every manager rostering Chase, and the team-follower path sent it to DOLPHINS followers.
 *
 * So the tag is used for exactly one thing: to choose between namesakes the registry cannot tell
 * apart, and only when it names ONE of their canonical teams. It never overrules a unique player's
 * canonical team.
 *
 * The registry is `PlayerIdentityMap` (one row per player, ~98% unique by name for NFL), not
 * `SportsPlayer` (one row per provider). Matching goes through `lib/player-match/verifiedNameMatch`
 * so a shared name is refused rather than bound to whichever row came first.
 */
import { prisma } from '@/lib/prisma'
import { foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'
import { authoritativeRowsBySleeperId } from '@/lib/player-match/authoritativePlayerRow'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { getAllCanonicalTeams, getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'

export type NewsIdentityCandidate = {
  /** PlayerIdentityMap.id */
  id: string
  /** Canonical name. */
  name: string
  position: string | null
  /** Canonical club code (see `newsClub`), or null when the registry has none we recognise. */
  team: string | null
  /** The registry's own `currentTeam` text, as stored. */
  currentTeam: string | null
  sleeperId: string | null
}

export type NewsPlayerBinding =
  | {
      kind: 'resolved'
      identity: NewsIdentityCandidate
      /** Everyone in the registry sharing the normalized name, the identity included. */
      candidates: NewsIdentityCandidate[]
      /**
       * `unique_name`: one player has this name; the row's tag played no part.
       * `team_verified`: several share it and the row's tag named exactly one of their teams.
       * `roster_alias`: the registry does not know this spelling ("Cam Ward"), but every rostered row
       * under it carries the Sleeper id of ONE registry player whose name is compatible ("Cameron
       * Ward"). The tag played no part.
       */
      via: 'unique_name' | 'team_verified' | 'roster_alias'
      /** The story's own spelling, normalized — a rostered row under it is this player (roster_alias). */
      aliasKey?: string
      /**
       * Whether the story may go to followers of the player's TEAM: true for `unique_name` and
       * `roster_alias`, false for `team_verified`.
       * A `team_verified` one rests on the tag, and the tag is the thing measured as wrong ~40% of the
       * time — good enough to separate two rostered namesakes, not to broadcast to a whole fan base.
       */
      teamRoutable: boolean
    }
  | { kind: 'ambiguous'; candidates: NewsIdentityCandidate[] }
  | { kind: 'unresolved' }

/**
 * A team string reduced to one comparable club code. NFL goes through the canonical table (full
 * names, mascots and aliases included) and anything it does not recognise — "N. Folk", "Free Agent"
 * — is no club at all rather than a code that happens to differ. Other sports fold as the injury
 * matcher does.
 */
export function newsClub(team: string | null | undefined, sport: string | null | undefined): string | null {
  const S = String(sport ?? '').trim().toUpperCase()
  if (S === 'NFL') return getTeamInfo(team)?.canonical ?? null
  return foldInjuryTeam(team, S)
}

/**
 * Bind a news row to one registry identity.
 *
 * - One player has the name → that player, whatever the row's tag says.
 * - Several do → the one whose canonical team the tag names, if exactly one; otherwise `ambiguous`.
 * - Nobody does → the roster-alias bridge below, and failing that `unresolved` (a byline, "Power
 *   Rankings", a coach, a team name, a genuine registry gap).
 *
 * Never throws: an unreadable registry is `unresolved`, which the sender treats as "tell nobody".
 */
export async function resolveNewsPlayerBinding(
  sport: string | null | undefined,
  playerName: string | null | undefined,
  rowTeam: string | null | undefined,
): Promise<NewsPlayerBinding> {
  const S = String(sport ?? '').trim().toUpperCase()
  const raw = String(playerName ?? '').trim()
  const key = normalizeMatchName(raw)
  if (!S || !key) return { kind: 'unresolved' }

  type RegistryRow = { id: string; canonicalName: string; position: string | null; currentTeam: string | null; sleeperId: string | null }
  // Wrapped, not only `.catch`ed: a client without the model throws before a promise exists.
  const rows: RegistryRow[] = await Promise.resolve()
    .then(() => prisma.playerIdentityMap.findMany({
      where: {
        sport: S,
        // Broad on purpose; the bind is decided by `normalizeMatchName` below. `contains` reaches
        // "Michael Carter II" from "Michael Carter", which is exactly the namesake that must be SEEN
        // to be refused.
        OR: [
          { canonicalName: { contains: raw, mode: 'insensitive' } },
          { normalizedName: { in: [...new Set([raw.toLowerCase(), key])] } },
        ],
      },
      select: { id: true, canonicalName: true, position: true, currentTeam: true, sleeperId: true },
      take: 50,
    }))
    .catch(() => [] as RegistryRow[])

  const seen = new Set<string>()
  const candidates: NewsIdentityCandidate[] = []
  for (const r of rows) {
    if (seen.has(r.id) || normalizeMatchName(r.canonicalName) !== key) continue
    seen.add(r.id)
    const c: NewsIdentityCandidate = {
      id: r.id,
      name: r.canonicalName,
      position: r.position,
      team: newsClub(r.currentTeam, S),
      currentTeam: r.currentTeam,
      sleeperId: r.sleeperId?.trim() || null,
    }
    /*
     * ⚠ THE REGISTRY HOLDS SOME PEOPLE TWICE, and a duplicate reads as a namesake. Production has
     * "Michael Penix Jr." (Sleeper 11559) AND "Michael Penix JR" (no Sleeper id), both QB, both ATL —
     * which made 38 high-impact stories in 30 days about one QB "ambiguous". Same name, same club and
     * same position, with at most one Sleeper id between them, is one person; the row carrying the
     * Sleeper id is kept. Two DIFFERENT Sleeper ids are two people and stay apart.
     */
    const twin = candidates.findIndex(
      (o) =>
        o.team != null &&
        o.team === c.team &&
        String(o.position ?? '').trim().toUpperCase() === String(c.position ?? '').trim().toUpperCase() &&
        (!o.sleeperId || !c.sleeperId || o.sleeperId === c.sleeperId),
    )
    if (twin < 0) candidates.push(c)
    else if (!candidates[twin]!.sleeperId && c.sleeperId) candidates[twin] = c
  }
  if (candidates.length === 0) return resolveViaRosterAlias(S, raw, key)

  // The registry is the FULL list for the sport, so a lone candidate is the player — the tag is not
  // consulted (`refuseContradictedSingle` is for partial indexes such as injury feeds, not this one).
  const result = resolveVerifiedMatch(buildNameIndex(candidates), { name: raw, team: newsClub(rowTeam, S) })
  if (!result.match) return { kind: 'ambiguous', candidates }
  if (result.reason === 'unique_name') {
    return { kind: 'resolved', identity: result.match, candidates, via: 'unique_name', teamRoutable: true }
  }
  if (result.reason === 'team_verified') {
    return { kind: 'resolved', identity: result.match, candidates, via: 'team_verified', teamRoutable: false }
  }
  // No other reason can bind without a position in the lookup; refuse rather than guess if one ever does.
  return { kind: 'ambiguous', candidates }
}

/**
 * Same surname, and one first name a prefix of the other ("Cam" / "Cameron"). Deliberately narrow:
 * it exists to stop a roster's mis-namespaced id binding a story to an unrelated player — a rostered
 * "Derrick Henry" carries `12042`, which is Keith Randolph Jr.'s Sleeper id (measured 2026-10-11).
 */
function namesCompatible(aKey: string, bKey: string): boolean {
  const a = aKey.split(' ')
  const b = bKey.split(' ')
  if (a.length < 2 || b.length < 2 || a[a.length - 1] !== b[b.length - 1]) return false
  return a[0]!.startsWith(b[0]!) || b[0]!.startsWith(a[0]!)
}

/**
 * The registry has no player under the story's spelling. If rosters carry that spelling with the
 * Sleeper id of exactly ONE registry player whose name is compatible, it is that player.
 *
 * Why it exists: "Cam Ward" is how news and 393 rostered rows spell the Titans QB the registry holds
 * as "Cameron Ward" (Sleeper 12522). Without this, binding by registry name alone would leave every
 * story about him unbound — and an unbound story tells nobody. Two compatible identities, or none,
 * stays `unresolved`.
 */
async function resolveViaRosterAlias(S: string, raw: string, key: string): Promise<NewsPlayerBinding> {
  const rostered = await Promise.resolve()
    .then(() =>
      prisma.redraftRosterPlayer.findMany({
        where: { playerName: { equals: raw, mode: 'insensitive' }, droppedAt: null },
        select: { playerId: true, sport: true },
        take: 500,
      }),
    )
    .catch(() => [] as Array<{ playerId: string; sport: string | null }>)
  const ids = [
    ...new Set(
      rostered
        .filter((r) => !r.sport || r.sport.trim().toUpperCase() === S)
        .map((r) => r.playerId?.trim())
        .filter((id): id is string => !!id),
    ),
  ]
  if (ids.length === 0) return { kind: 'unresolved' }
  const rows = await Promise.resolve()
    .then(() =>
      prisma.playerIdentityMap.findMany({
        where: { sport: S, sleeperId: { in: ids } },
        select: { id: true, canonicalName: true, position: true, currentTeam: true, sleeperId: true },
        take: 50,
      }),
    )
    .catch(() => [] as Array<{ id: string; canonicalName: string; position: string | null; currentTeam: string | null; sleeperId: string | null }>)
  const compatible = rows.filter((r) => namesCompatible(normalizeMatchName(r.canonicalName), key))
  if (new Set(compatible.map((r) => r.id)).size !== 1) return { kind: 'unresolved' }
  const r = compatible[0]!
  const identity: NewsIdentityCandidate = {
    id: r.id,
    name: r.canonicalName,
    position: r.position,
    team: newsClub(r.currentTeam, S),
    currentTeam: r.currentTeam,
    sleeperId: r.sleeperId?.trim() || null,
  }
  return { kind: 'resolved', identity, candidates: [identity], via: 'roster_alias', teamRoutable: true, aliasKey: key }
}

type RosterRowLike = { playerId?: string | null; playerName: string; team: string | null; sport: string | null }

/**
 * Whether a rostered row is the bound player.
 *
 * Rostered rows are joined by NAME: `redraft_roster_players.playerId` is not one namespace (Sleeper,
 * ESPN and other ids all appear for NFL, measured 2026-10-11), so an id is only ever used to REJECT a
 * row that carries another namesake's Sleeper id, or to accept one carrying this player's.
 *
 * ⚠ A UNIQUE NAME IS NOT TEAM-GATED. Rostered `team` and the registry's `currentTeam` disagreed on 73
 * of 1,261 directly comparable NFL rows (both are snapshots and either can be stale after a move), so
 * gating on them would re-create the silent drop this module exists to remove. The residual risk is
 * a namesake the REGISTRY lacks, which nothing here can see.
 */
export function rosterRowIsBoundPlayer(
  binding: Extract<NewsPlayerBinding, { kind: 'resolved' }>,
  row: RosterRowLike,
  sport: string,
): boolean {
  const S = String(sport ?? '').trim().toUpperCase()
  if (S && row.sport && row.sport.trim().toUpperCase() !== S) return false
  const rowKey = normalizeMatchName(row.playerName)
  if (rowKey !== normalizeMatchName(binding.identity.name) && !(binding.aliasKey && rowKey === binding.aliasKey)) return false
  const pid = row.playerId?.trim() || null
  if (pid && binding.identity.sleeperId && pid === binding.identity.sleeperId) return true
  if (pid && binding.candidates.some((c) => c.id !== binding.identity.id && c.sleeperId === pid)) return false
  if (binding.via !== 'team_verified') return true
  // A shared name: only a row that positively carries the verified player's club is his.
  const theirs = newsClub(row.team, S)
  return theirs != null && theirs === binding.identity.team
}

/**
 * The bound player's team NOW, for routing to that team's followers: his Sleeper row's team when he
 * has one, the registry's `currentTeam` otherwise. NFL comes back as a canonical code.
 *
 * 🛑 THE REGISTRY'S `currentTeam` IS STALE FOR PLAYERS WHO LEFT A CLUB, AND IT WAS THE ROUTING TEAM.
 * Measured 2026-10-13 over 30 days of high-impact NFL news: of 402 named players the registry binds
 * by exact name, 43 have NO team on their Sleeper row (released or retired) while the registry still
 * holds one — Tyreek Hill MIA (25 stories), Joe Mixon HOU (18), Tom Brady TB (16), Drew Brees NO,
 * Tony Romo DAL — and every one of those stories went to the old club's followers: 159 of 2,281
 * uniquely-named high-impact rows. 4 more players name a different club outright (Kaleb Johnson:
 * registry PIT, Sleeper Green Bay).
 *
 * Only a `source = 'sleeper'` row speaks, and a null team there is a statement (no club), never a gap
 * to fill — see `authoritativePlayerRow.ts`. No Sleeper id, no Sleeper row or an unreadable table
 * keeps the registry's answer, which is what routed before this existed.
 */
export async function currentTeamForBinding(
  binding: Extract<NewsPlayerBinding, { kind: 'resolved' }>,
  sport: string | null | undefined,
): Promise<string | null> {
  const S = String(sport ?? '').trim().toUpperCase()
  const fold = (team: string | null | undefined): string | null => {
    const t = String(team ?? '').trim()
    if (!t) return null
    return S === 'NFL' ? normalizeTeamAbbrev(t) : t
  }
  const registry = fold(binding.identity.currentTeam)
  const sid = binding.identity.sleeperId
  if (!sid || !S) return registry
  type Row = {
    source: string; sleeperId: string | null; externalId: string; name: string
    position: string | null; team: string | null; fetchedAt: Date | null
  }
  // Wrapped, not only `.catch`ed: a client without the model throws before a promise exists.
  const rows: Row[] | null = await Promise.resolve()
    .then(
      () =>
        prisma.sportsPlayer.findMany({
          where: sleeperIdWhere([sid], S),
          select: { source: true, sleeperId: true, externalId: true, name: true, position: true, team: true, fetchedAt: true },
          take: 20,
        }) as Promise<Row[]>,
    )
    .catch(() => null)
  if (!rows) return registry
  const authoritative = authoritativeRowsBySleeperId(
    rows.map((r) => ({
      ...r,
      sleeperId: r.sleeperId ?? (r.externalId?.startsWith('sleeper:') ? r.externalId.slice('sleeper:'.length) : null),
    })),
  ).get(sid.toLowerCase())
  if (!authoritative || authoritative.source !== 'sleeper') return registry
  return fold(authoritative.team)
}

/** Shorthands headlines use that are neither a full name nor a mascot; matched like mascots. */
const NFL_HEADLINE_NICKNAMES: Record<string, readonly string[]> = {
  SF: ['Niners'], TB: ['Bucs'], NE: ['Pats'], JAX: ['Jags'],
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every NFL club a headline names — full name, mascot, a common shorthand, or a city. Full names are
 * consumed first so "New York Giants" is not ALSO read as a bare "New York" (a city two clubs share,
 * which adds both). Over-counting only ever makes the caller refuse; under-counting is what mis-routes.
 */
export function nflTeamsNamedIn(text: string | null | undefined): Set<string> {
  let rest = ` ${String(text ?? '')} `
  const found = new Set<string>()
  const teams = getAllCanonicalTeams()
  const take = (phrase: string, codes: readonly string[]) => {
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(phrase)}(?=[^A-Za-z0-9]|$)`, 'gi')
    if (!re.test(rest)) return
    for (const c of codes) found.add(c)
    rest = rest.replace(new RegExp(re.source, 'gi'), '$1 ')
  }
  for (const t of teams) take(t.fullName, [t.abbrev])
  for (const t of teams) {
    take(t.mascot, [t.abbrev])
    for (const n of NFL_HEADLINE_NICKNAMES[t.abbrev] ?? []) take(n, [t.abbrev])
  }
  const byCity = new Map<string, string[]>()
  for (const t of teams) byCity.set(t.city, [...(byCity.get(t.city) ?? []), t.abbrev])
  for (const [city, codes] of byCity) take(city, codes)
  return found
}

/**
 * The ONE club a TEAM story is about — a `player_news` row whose "player" is a club ("Dallas Cowboys")
 * — as a canonical code, or null.
 *
 * Owner's decision 2026-10-13: news about a team reaches that team's followers. But these rows are
 * where the extractor is least trustworthy. Sampled on production the same day: "Indianapolis Colts"
 * tagged WAS over "MCL sprain sidelines Mariota; Daniels preps" (a Commanders story), "Dallas Cowboys"
 * tagged TB over a sportsbook promo, "Ravens vs. Falcons prediction", "Tennessee Titans" over "Week 5
 * NFL picks… 5-leg parlay". So three things must agree before anyone is told:
 *   - the slot IS a club's full name or mascot (normalizeTeamAbbrev) — not "Watch Lions", "How Bills";
 *   - the row's tag, if it has one, is that same club — an unreadable tag counts as disagreement;
 *   - the headline names that club and NO other — a matchup, a betting slate, a trade between two
 *     clubs is about neither one alone.
 * Measured over 30 days (SQL approximation): 299 high-impact NFL rows had a club in the slot, 48 pass
 * all three (1.6/day, 36 distinct headlines, 16 clubs) — "Washington Commanders unveil first
 * renderings inside new stadium", "Cowboys fall flat in Week 1 loss". The rest are matchups, slates
 * and promos. NFL only: the club table behind normalizeTeamAbbrev is NFL's. Other sports' team rows
 * (~70 a month) stay unrouted rather than guessed.
 */
export function teamNewsSubject(
  sport: string | null | undefined,
  slot: string | null | undefined,
  rowTeam: string | null | undefined,
  headline: string | null | undefined,
): string | null {
  if (String(sport ?? '').trim().toUpperCase() !== 'NFL') return null
  const name = String(slot ?? '').trim()
  const info = getTeamInfo(name)
  if (!info) return null
  const lower = name.toLowerCase()
  if (lower !== info.fullName.toLowerCase() && lower !== info.mascot.toLowerCase()) return null
  const code = info.canonical
  const tag = String(rowTeam ?? '').trim()
  if (tag && getTeamInfo(tag)?.canonical !== code) return null
  const named = nflTeamsNamedIn(headline)
  if (named.size !== 1 || !named.has(code)) return null
  return code
}
