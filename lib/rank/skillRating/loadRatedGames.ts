import 'server-only'

import { prisma } from '@/lib/prisma'
import type { RatedGame } from '@/lib/rank/skillRating/replay'
import { parseFormerSleeperKey } from '@/lib/league-import/sleeper/historicalTeamIdentity'

/**
 * Every head-to-head game on record, each side resolved to a person — the input
 * to the per-game skill rating (`replay.ts`).
 *
 * ── THREE SOURCES ────────────────────────────────────────────────────────────
 *   MatchupFact     history, one row per game, keyed on OUR `League.id`
 *   WeeklyMatchup   the live season, one row per SIDE, keyed on the PROVIDER
 *                   league id; used only for (league, season)s no fact covers —
 *                   the same merge `lib/core-app/careerRecords.ts` makes
 *   RedraftMatchup  leagues played on AllFantasy itself, once `status = final`
 *
 * ── WHO A SIDE IS ────────────────────────────────────────────────────────────
 * A slot resolves through `LeagueTeam(league, externalId)`, best key first:
 *   `af:<userId>`               an AllFantasy user (claimed the team, or their
 *                               linked platform account appears in
 *                               PlatformIdentity / another claimed team)
 *   `p:<platform>:<managerId>`  a real person on the provider who is not on
 *                               AllFantasy yet — still rated, because WHO YOU
 *                               BEAT is the whole point, and their history
 *                               carries over the day they join
 *   `r:<league>:<slot>`         a slot with no person behind it
 *
 * ⚠ `Roster.platformUserId` IS NOT USED. It holds the AF id, the source manager
 * id or an orphan key depending on link state (importedRosterIdentity.ts).
 *
 * ── WHAT IS NOT A GAME ───────────────────────────────────────────────────────
 * Either side scoring 0 or less: an unplayed fixture (0-0), an eliminated
 * guillotine team, or a total-points league's solo row. A WeeklyMatchup group
 * that is not exactly two sides. A median-score "matchup". Results come from the
 * POINTS, never the stored `win` flag — writers store a tie as a loss for both.
 *
 * Sleeper history is remapped to the current season's slots by owner id. A
 * manager who has left is stored as `former:sleeper:<ownerId>` (an ownerless
 * past roster as `former:sleeper:slot:<season>:<rosterId>`) — see
 * `lib/league-import/sleeper/historicalTeamIdentity.ts`. Those resolve to the
 * person directly, not through `LeagueTeam`, which has no row for them.
 */

const PAGE = 5000

type LeagueRow = {
  id: string
  platform: string
  sport: string
  platformLeagueId: string | null
  name: string | null
}

type TeamRow = {
  leagueId: string
  externalId: string
  platformUserId: string | null
  claimedByUserId: string | null
  ownerName: string | null
  teamName: string | null
}

/** MFL ids are zero-padded and lose the padding in some tables — compare numerically. */
export function slotKey(slot: string | number): string {
  const s = String(slot).trim()
  return /^\d+$/.test(s) ? String(Number(s)) : s
}

export function normalizeSport(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().toUpperCase()
  return s || 'NFL'
}

async function pagedFacts() {
  type Fact = {
    matchupId: string
    leagueId: string
    sport: string
    season: number | null
    weekOrPeriod: number
    teamA: string
    teamB: string
    scoreA: number
    scoreB: number
    createdAt: Date
  }
  const out: Fact[] = []
  let cursor: string | undefined
  for (;;) {
    const page: Fact[] = await prisma.matchupFact.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { matchupId: cursor } } : {}),
      orderBy: { matchupId: 'asc' },
      select: {
        matchupId: true,
        leagueId: true,
        sport: true,
        season: true,
        weekOrPeriod: true,
        teamA: true,
        teamB: true,
        scoreA: true,
        scoreB: true,
        createdAt: true,
      },
    })
    out.push(...page)
    if (page.length < PAGE) break
    cursor = page[page.length - 1].matchupId
  }
  return out
}

async function pagedWeeks() {
  type Week = {
    id: string
    leagueId: string
    rosterId: string
    seasonYear: number
    week: number
    matchupId: number | null
    pointsFor: number
  }
  const out: Week[] = []
  let cursor: string | undefined
  for (;;) {
    const page: Week[] = await prisma.weeklyMatchup.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, leagueId: true, rosterId: true, seasonYear: true, week: true, matchupId: true, pointsFor: true },
    })
    out.push(...page)
    if (page.length < PAGE) break
    cursor = page[page.length - 1].id
  }
  return out
}

export type LoadedGames = {
  games: RatedGame[]
  sources: { facts: number; weeks: number; native: number }
}

export async function loadRatedGames(): Promise<LoadedGames> {
  const [facts, weeks, native] = await Promise.all([
    pagedFacts(),
    pagedWeeks(),
    prisma.redraftMatchup.findMany({
      where: { status: 'final', isMedianMatchup: false, awayRosterId: { not: null } },
      select: {
        id: true,
        leagueId: true,
        week: true,
        homeScore: true,
        awayScore: true,
        homeRoster: { select: { ownerId: true, ownerName: true, teamName: true } },
        awayRoster: { select: { ownerId: true, ownerName: true, teamName: true } },
        season: { select: { season: true, sport: true } },
      },
    }),
  ])

  // Leagues behind every fact and every provider id in the live weeks.
  const factLeagueIds = [...new Set(facts.map((f) => f.leagueId))]
  const providerIds = [...new Set(weeks.map((w) => w.leagueId))]
  const nativeLeagueIds = [...new Set(native.map((n) => n.leagueId))]
  const leagues: LeagueRow[] = []
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
  for (const ids of chunk(factLeagueIds.concat(nativeLeagueIds), 2000)) {
    leagues.push(
      ...(await prisma.league.findMany({
        where: { id: { in: ids } },
        select: { id: true, platform: true, sport: true, platformLeagueId: true, name: true },
      })).map((l) => ({ ...l, sport: String(l.sport), platform: String(l.platform ?? 'unknown') })),
    )
  }
  for (const ids of chunk(providerIds, 2000)) {
    leagues.push(
      ...(await prisma.league.findMany({
        where: { platformLeagueId: { in: ids } },
        select: { id: true, platform: true, sport: true, platformLeagueId: true, name: true },
      })).map((l) => ({ ...l, sport: String(l.sport), platform: String(l.platform ?? 'unknown') })),
    )
  }
  const leagueById = new Map(leagues.map((l) => [l.id, l]))
  const mirrorsByProvider = new Map<string, LeagueRow[]>()
  for (const l of leagueById.values()) {
    if (!l.platformLeagueId) continue
    const list = mirrorsByProvider.get(l.platformLeagueId)
    if (list) {
      if (!list.some((x) => x.id === l.id)) list.push(l)
    } else mirrorsByProvider.set(l.platformLeagueId, [l])
  }

  const teams: TeamRow[] = []
  for (const ids of chunk([...leagueById.keys()], 2000)) {
    teams.push(
      ...(await prisma.leagueTeam.findMany({
        where: { leagueId: { in: ids } },
        select: { leagueId: true, externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true },
      })),
    )
  }
  const teamBySlot = new Map<string, TeamRow>()
  for (const t of teams) teamBySlot.set(`${t.leagueId}|${slotKey(t.externalId)}`, t)

  // platform:managerId → AF user, from linked accounts and from any team that user claimed.
  const identities = await prisma.platformIdentity.findMany({ select: { platform: true, platformUserId: true, userId: true } })
  const afByPlatform = new Map<string, string>()
  for (const i of identities) afByPlatform.set(`${i.platform.toLowerCase()}:${i.platformUserId}`, i.userId)
  for (const t of teams) {
    if (!t.claimedByUserId || !t.platformUserId) continue
    const l = leagueById.get(t.leagueId)
    if (!l) continue
    const k = `${l.platform.toLowerCase()}:${t.platformUserId}`
    if (!afByPlatform.has(k)) afByPlatform.set(k, t.claimedByUserId)
  }

  const providerOf = (l: LeagueRow) => l.platformLeagueId || l.id
  const person = (l: LeagueRow, slot: string): { key: string; name: string | null } => {
    const former = parseFormerSleeperKey(slot)
    if (former?.kind === 'manager') {
      const af = afByPlatform.get(`sleeper:${former.ownerId}`)
      return { key: af ? `af:${af}` : `p:sleeper:${former.ownerId}`, name: null }
    }
    if (former) return { key: `r:${providerOf(l)}:${former.season}:${former.rosterId}`, name: null }
    const t = teamBySlot.get(`${l.id}|${slotKey(slot)}`)
    const name = t?.ownerName?.trim() || t?.teamName?.trim() || null
    if (t?.claimedByUserId) return { key: `af:${t.claimedByUserId}`, name }
    if (t?.platformUserId) {
      const platform = l.platform.toLowerCase()
      const af = afByPlatform.get(`${platform}:${t.platformUserId}`)
      return { key: af ? `af:${af}` : `p:${platform}:${t.platformUserId}`, name }
    }
    return { key: `r:${providerOf(l)}:${slotKey(slot)}`, name }
  }

  const games: RatedGame[] = []
  const seen = new Set<string>()
  const factSeasons = new Set<string>()
  let factCount = 0
  /*
   * ⚠ ONE COPY PER PROVIDER SEASON, THE NEWEST. Each importer's League row holds its own copy of a
   * season, and a copy written before the team mapping was fixed names different teams than one
   * written after — so the per-game dedupe below cannot see they are the same game, and it would
   * count twice, once for the wrong person. The sync rewrites a season whole, so the copy with the
   * latest write is the one on the current mapping.
   */
  const newestCopy = new Map<string, { leagueId: string; at: number }>()
  for (const f of facts) {
    const l = leagueById.get(f.leagueId)
    if (!l || f.season == null) continue
    const k = `${providerOf(l)}|${f.season}`
    const at = f.createdAt instanceof Date ? f.createdAt.getTime() : 0
    const cur = newestCopy.get(k)
    if (!cur || at > cur.at || (at === cur.at && f.leagueId < cur.leagueId)) newestCopy.set(k, { leagueId: f.leagueId, at })
  }
  for (const f of facts) {
    if (f.season == null || f.scoreA <= 0 || f.scoreB <= 0) continue
    const l = leagueById.get(f.leagueId)
    if (!l) continue
    const prov = providerOf(l)
    if (newestCopy.get(`${prov}|${f.season}`)?.leagueId !== f.leagueId) continue
    const [s1, s2] = [slotKey(f.teamA), slotKey(f.teamB)].sort()
    // ⚠ One League row per importing user: the same provider game arrives once per mirror.
    const dedupe = `f|${prov}|${f.season}|${f.weekOrPeriod}|${s1}|${s2}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    factSeasons.add(`${prov}|${f.season}`)
    const a = person(l, f.teamA)
    const b = person(l, f.teamB)
    games.push({
      sport: normalizeSport(f.sport || l.sport),
      season: f.season,
      week: f.weekOrPeriod,
      leagueKey: prov,
      leagueName: l.name,
      a: a.key,
      b: b.key,
      aName: a.name,
      bName: b.name,
      scoreA: f.scoreA,
      scoreB: f.scoreB,
    })
    factCount += 1
  }

  const groups = new Map<string, typeof weeks>()
  for (const w of weeks) {
    if (w.matchupId == null || w.pointsFor <= 0) continue
    if (factSeasons.has(`${w.leagueId}|${w.seasonYear}`)) continue
    const k = `${w.leagueId}|${w.seasonYear}|${w.week}|${w.matchupId}`
    const list = groups.get(k)
    if (list) list.push(w)
    else groups.set(k, [w])
  }
  let weekCount = 0
  for (const list of groups.values()) {
    if (list.length !== 2) continue
    const [x, y] = list
    const mirrors = mirrorsByProvider.get(x.leagueId) ?? []
    // The mirror that actually has these two teams on file.
    const l =
      mirrors.find((m) => teamBySlot.has(`${m.id}|${slotKey(x.rosterId)}`) && teamBySlot.has(`${m.id}|${slotKey(y.rosterId)}`)) ??
      mirrors[0]
    if (!l) continue
    const a = person(l, x.rosterId)
    const b = person(l, y.rosterId)
    games.push({
      sport: normalizeSport(l.sport),
      season: x.seasonYear,
      week: x.week,
      leagueKey: x.leagueId,
      leagueName: l.name,
      a: a.key,
      b: b.key,
      aName: a.name,
      bName: b.name,
      scoreA: x.pointsFor,
      scoreB: y.pointsFor,
    })
    weekCount += 1
  }

  // Native: RedraftRoster.ownerId is the AF user id once claimed; otherwise a platform or roster key.
  const ownerIds = [...new Set(native.flatMap((n) => [n.homeRoster?.ownerId, n.awayRoster?.ownerId]).filter((x): x is string => !!x))]
  const afUsers = new Set<string>()
  for (const ids of chunk(ownerIds, 2000)) {
    for (const u of await prisma.appUser.findMany({ where: { id: { in: ids } }, select: { id: true } })) afUsers.add(u.id)
  }
  let nativeCount = 0
  for (const n of native) {
    if (!n.homeRoster || !n.awayRoster || !n.season) continue
    if (n.homeScore <= 0 || n.awayScore <= 0) continue
    const l = leagueById.get(n.leagueId)
    // A league with history backfilled into MatchupFact is already counted there.
    if (l && factSeasons.has(`${providerOf(l)}|${n.season.season}`)) continue
    const ownerKey = (ownerId: string) => (afUsers.has(ownerId) ? `af:${ownerId}` : `n:${n.leagueId}:${ownerId}`)
    games.push({
      sport: normalizeSport(n.season.sport),
      season: n.season.season,
      week: n.week,
      leagueKey: n.leagueId,
      leagueName: l?.name ?? null,
      a: ownerKey(n.homeRoster.ownerId),
      b: ownerKey(n.awayRoster.ownerId),
      aName: n.homeRoster.ownerName || n.homeRoster.teamName || null,
      bName: n.awayRoster.ownerName || n.awayRoster.teamName || null,
      scoreA: n.homeScore,
      scoreB: n.awayScore,
    })
    nativeCount += 1
  }

  return { games, sources: { facts: factCount, weeks: weekCount, native: nativeCount } }
}
