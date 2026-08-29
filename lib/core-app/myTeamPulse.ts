import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { getByeWeeks } from './byeWeeks'
import { isAtRisk, isRuledOut } from './injuryStatus'
import { leagueDisplayName } from './leagueHome'
import { myRosterCandidates } from './myRoster'
import { resolveSportsWeek, type SportsWeek } from './sportsWeek'

/**
 * My team pulse — the cross-league landing at `/core/my-team`.
 *
 * "Lineups that need you": every league you have claimed a team in, sorted by
 * whether this week's starting lineup is actually costing you points, before
 * any single league is picked.
 *
 * ── Why this and not a roster summary ───────────────────────────────────────
 *
 * The per-league screen already answers "what is my roster". The question a
 * manager with sixty leagues has at the top of the week is a different one, and
 * no screen in this product answered it: WHICH of these do I still have to
 * touch, and how long have I got. Four things make a lineup wrong, and all four
 * are computable from data this repo already holds:
 *
 *   empty         — a starting slot with nobody in it. A guaranteed zero.
 *   out           — a starter the league has declared absent. A guaranteed zero.
 *   bye           — a starter whose real club is not playing. A guaranteed zero.
 *   questionable  — a starter carrying a designation short of absence. A risk,
 *                   not a certainty, and counted separately for that reason.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * ⚠ IT DOES NOT RANK LEAGUES BY PROJECTED POINTS. Pricing two lineups is what
 * `matchupPulse` does, and it costs a projection read per starter across the
 * whole portfolio. Nothing here needs a projection: an empty slot is empty and
 * a bye is a bye whatever the feed says, so this board stays honest on a day
 * the projection cron has not run.
 *
 * ⚠ AND A COUNT WE CANNOT STAND BEHIND IS NULL, NOT ZERO. `bye` is null unless
 * the week's schedule is complete enough to tell a bye from a hole in our own
 * ingestion — see the gate in `byeWeeks.ts`. "No byes" and "we could not check
 * for byes" are different sentences and the board says which one it means.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * Batched across the whole portfolio: one read for claimed teams, one for their
 * rosters, one for every starter, one for injuries, then per DISTINCT SPORT a
 * week resolve, a fixture read and a bye read. On a 67-league NFL-only account
 * that is seven queries, not 67 — a per-league fan-out over this table is the
 * shape that took production Postgres to a 53200 OOM.
 */

/** A league crest we can actually render, or null. */
function asImageUrl(raw: string | null | undefined, platform: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  /* Sleeper stores an avatar *id* in the same column it sometimes stores a URL. */
  if (String(platform ?? '').toLowerCase() === 'sleeper') {
    return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(v)}`
  }
  return null
}

/** Two-letter badge for a league with no crest. Never blank. */
function initialsOf(name: string, take = 2): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, take).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT = '0'

/**
 * Starters, and the holes between them.
 *
 * ⚠ THE HOLES ARE THE POINT, so unlike `rosterPlayerIds` this does NOT filter
 * them out — it counts them. `starters` is positional: index 3 is the FLEX
 * whether or not anybody is in it, and dropping the falsy entries is exactly
 * how an empty starting slot becomes invisible.
 */
function startersOf(playerData: unknown): { ids: string[]; empty: number } {
  if (!playerData || typeof playerData !== 'object') return { ids: [], empty: 0 }
  const raw = (playerData as Record<string, unknown>).starters
  if (!Array.isArray(raw)) return { ids: [], empty: 0 }
  const ids: string[] = []
  let empty = 0
  for (const x of raw) {
    const v = x == null ? '' : String(x).trim()
    if (v === '' || v === EMPTY_SLOT || v === 'null' || v === 'undefined') empty += 1
    else ids.push(v)
  }
  return { ids, empty }
}

export type MyTeamRow = {
  leagueId: string
  leagueName: string
  platform: string
  logoUrl: string | null
  leagueBadge: string
  /** Your team's name in this league, when the platform published one. */
  teamName: string | null
  /** Filled starting slots. */
  starters: number
  /** Starting slots with nobody in them. A guaranteed zero each. */
  empty: number
  /** Starters the league has declared absent. */
  out: number
  /**
   * Starters whose club is not playing this week.
   *
   * ⚠ NULL IS NOT ZERO. Null means this week's schedule was too incomplete to
   * tell a bye from a gap in our ingestion, so we did not check. Rendering that
   * as "0 on bye" would be a claim we cannot support about the single most
   * preventable loss in fantasy.
   */
  bye: number | null
  /** Starters carrying a designation short of absence. A risk, not a certainty. */
  questionable: number
  /**
   * Starting ids that resolved to no player row.
   *
   * Our gap, not the user's, and never coloured as a lineup problem.
   */
  unresolved: number
  /**
   * Earliest kickoff among this lineup's starters, as an ISO string.
   *
   * Null when not one starter could be placed against a fixture — a non-NFL
   * league, or a week the ingested schedule does not reach.
   */
  lockAt: string | null
  /** The first game has kicked off, so this lineup can no longer be set in full. */
  locked: boolean
  season: number | null
  week: number | null
  /** Certain lost points: empty slots, ruled-out starters and byes. */
  severity: number
  href: string
}

export type MyTeamPulse = {
  /** Lineups with at least one certain hole, most urgent first. */
  needs: MyTeamRow[]
  /** Lineups with nothing wrong we can see, soonest lock first. */
  set: MyTeamRow[]
  /** Totals before the display cap, so a truncated column can say so. */
  needsTotal: number
  setTotal: number
  /** Teams you have claimed. */
  considered: number
  /** Teams we could actually read a starting lineup for. */
  checked: number
  /**
   * True when at least one row could be checked for byes. When false the board
   * says the bye check did not run rather than implying every roster is clear.
   */
  byeChecked: boolean
  /** Why the rest are absent. Stated on the screen, never silently dropped. */
  notChecked: {
    /** A claimed team whose rosters were never imported. */
    noRoster: number
    /** A roster on file that carries no `starters` array at all. */
    noLineup: number
  }
}

const EMPTY_PULSE: MyTeamPulse = {
  needs: [],
  set: [],
  needsTotal: 0,
  setTotal: 0,
  considered: 0,
  checked: 0,
  byeChecked: false,
  notChecked: { noRoster: 0, noLineup: 0 },
}

/** How many rows each column renders. The header states the totals either way. */
const COLUMN_CAP = 5

/**
 * Kickoff per club for one sport's current week.
 *
 * ⚠ SCOPED TO A SEASON, WEEK AND SEASON TYPE — never "the earliest future
 * game". The schedule table is partial, and an unscoped lookup resolves to
 * whatever is next on file, which on production was a fixture in late November.
 * And `seasonType` is not optional: preseason week 1 and regular week 1 are the
 * same `(season, week)` pair, so without it every August lineup reads as locked.
 *
 * The team match runs IN MEMORY through `normalizeTeamAbbrev`, because
 * `SportsPlayer.team` is an abbreviation while `SportsGame.homeTeam` holds
 * whatever the provider called it — matching those in SQL is a silent partial
 * join.
 */
async function kickoffsForWeek(sport: string, week: SportsWeek): Promise<Map<string, Date>> {
  const games = await prisma.sportsGame
    .findMany({
      where: { sport, season: week.season, week: week.week, seasonType: week.seasonType },
      orderBy: { startTime: 'asc' },
      take: 400,
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    .catch(() => [])

  const out = new Map<string, Date>()
  for (const g of games) {
    if (!g.startTime) continue
    for (const club of [g.homeTeam, g.awayTeam]) {
      const n = normalizeTeamAbbrev(club)
      if (!n) continue
      const seen = out.get(n)
      /* The same fixture arrives once per provider; the earliest kickoff is the
         one that actually locks the slot. */
      if (!seen || g.startTime < seen) out.set(n, g.startTime)
    }
  }
  return out
}

export async function getMyTeamPulse(
  userId: string,
  now: Date = new Date(),
): Promise<MyTeamPulse> {
  /* ── 1. Every team this user has claimed, with its league. ─────────────── */
  const claimed = await prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        leagueId: true,
        teamName: true,
        externalId: true,
        platformUserId: true,
        league: {
          select: {
            id: true,
            name: true,
            platform: true,
            sport: true,
            logoUrl: true,
            avatarUrl: true,
          },
        },
      },
    })
    .catch(() => [])

  const mine = claimed.filter((c) => c.league != null)
  if (mine.length === 0) return EMPTY_PULSE

  const leagueIds = [...new Set(mine.map((c) => c.leagueId))]

  /* ── 2. Every roster row those leagues carry, in ONE read. ─────────────── */
  /*
   * ⚠ MATCHED IN MEMORY, NOT IN SQL, AND ON PURPOSE. Which roster is yours is
   * `myRosterCandidates` — three keys tried in order, because
   * `Roster.platformUserId` sometimes holds the platform's id and sometimes our
   * own user uuid. Pushing that into a WHERE clause per league is 67 queries;
   * pulling each league's rosters once and applying the same rule here is one.
   */
  /*
   * ⚠ TYPED EXPLICITLY BECAUSE `.catch(() => [])` WIDENS TO A UNION. The empty
   * literal infers `never[]`, so `typeof rosters` is `Row[] | never[]` and any
   * `push` onto it resolves against the `never[]` overload. Naming the row type
   * collapses the union at the declaration instead of at every use site.
   */
  type RosterRow = { leagueId: string; platformUserId: string; playerData: unknown }
  const rosters: RosterRow[] = await prisma.roster
    .findMany({
      where: { leagueId: { in: leagueIds } },
      select: { leagueId: true, platformUserId: true, playerData: true },
    })
    .catch(() => [])

  const rostersByLeague = new Map<string, RosterRow[]>()
  for (const r of rosters) {
    const list = rostersByLeague.get(r.leagueId)
    if (list) list.push(r)
    else rostersByLeague.set(r.leagueId, [r])
  }

  type Pending = {
    leagueId: string
    leagueName: string
    platform: string
    sport: string
    logoUrl: string | null
    leagueBadge: string
    teamName: string | null
    ids: string[]
    empty: number
  }

  const pending: Pending[] = []
  const notChecked = { noRoster: 0, noLineup: 0 }

  for (const c of mine) {
    const l = c.league!
    const candidates = myRosterCandidates(c, userId)
    const pool: RosterRow[] = rostersByLeague.get(c.leagueId) ?? []
    /* First candidate that matches wins — the order in `myRosterCandidates` is
       the order of confidence, and the set matches at most one roster per team. */
    const roster = candidates
      .map((k) => pool.find((r) => r.platformUserId === k))
      .find((r) => r != null)

    if (!roster) {
      notChecked.noRoster++
      continue
    }

    const { ids, empty } = startersOf(roster.playerData)
    if (ids.length === 0 && empty === 0) {
      notChecked.noLineup++
      continue
    }

    const leagueName = leagueDisplayName(l.name)
    const platform = String(l.platform ?? 'manual').toLowerCase()

    pending.push({
      leagueId: l.id,
      leagueName,
      platform,
      sport: String(l.sport ?? 'NFL').toUpperCase(),
      logoUrl: asImageUrl(l.logoUrl, platform) ?? asImageUrl(l.avatarUrl, platform),
      leagueBadge: initialsOf(leagueName),
      teamName: c.teamName?.trim() || null,
      ids,
      empty,
    })
  }

  if (pending.length === 0) {
    return { ...EMPTY_PULSE, considered: mine.length, notChecked }
  }

  /* ── 3. One player read for every starter on the board. ────────────────── */
  const everyStarter = [...new Set(pending.flatMap((p) => p.ids))]
  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: everyStarter } },
      select: { sleeperId: true, name: true, team: true },
    })
    .catch(() => [])

  const playerBy = new Map<string, { name: string; team: string | null }>()
  for (const p of players) {
    if (!p.sleeperId || playerBy.has(p.sleeperId)) continue
    playerBy.set(p.sleeperId, { name: p.name, team: p.team })
  }

  const sports = [...new Set(pending.map((p) => p.sport))]

  /* ── 4. One injury read for every name we resolved. ────────────────────── */
  /*
   * ⚠ SCOPED TO THE SPORTS ON THIS BOARD. `sportsInjury` holds 6,440 NFL rows
   * beside 876 MLB, 329 NBA and 318 NHL, and the only key is a player NAME —
   * so an unscoped `playerName: { in: names }` hands an NFL starter whatever
   * designation his namesake in another league is carrying. `myTeam.ts` filters
   * on sport for exactly this reason and the first draft of this file did not.
   */
  const names = [...new Set([...playerBy.values()].map((p) => p.name))]
  const injuries = names.length
    ? await prisma.sportsInjury
        .findMany({
          where: { sport: { in: sports }, playerName: { in: names } },
          orderBy: { fetchedAt: 'desc' },
          select: { sport: true, playerName: true, status: true },
        })
        .catch(() => [])
    : []

  /*
   * ⚠ FIRST WINS, NOT LAST. `new Map(pairs)` resolves a duplicate key to the
   * LAST pair, so feeding it rows sorted `fetchedAt: desc` keeps the OLDEST
   * status for the ~989 NFL players carrying more than one row. Same trap and
   * same fix as `myTeam.ts`: build the map explicitly, skip a key already set.
   */
  const injuryByName = new Map<string, string | null>()
  for (const i of injuries) {
    const k = `${i.sport}:${i.playerName.toLowerCase()}`
    if (!injuryByName.has(k)) injuryByName.set(k, i.status)
  }

  /* ── 5. Per DISTINCT SPORT: the week, its fixtures and its byes. ───────── */

  const weekBySport = new Map<string, SportsWeek | null>()
  const kickoffBySport = new Map<string, Map<string, Date>>()
  const byeIdsBySport = new Map<string, Set<string> | null>()

  for (const sport of sports) {
    const week = await resolveSportsWeek(sport).catch(() => null)
    weekBySport.set(sport, week)
    if (!week) {
      kickoffBySport.set(sport, new Map())
      byeIdsBySport.set(sport, null)
      continue
    }

    kickoffBySport.set(sport, await kickoffsForWeek(sport, week).catch(() => new Map()))

    /*
     * The bye check runs over every starter in this sport at once. It returns
     * null when the week's slate is too thin to judge, and that null travels
     * all the way to the row — see the field note on `MyTeamRow.bye`.
     */
    const playerTeams = new Map<string, string | null>()
    for (const p of pending) {
      if (p.sport !== sport) continue
      for (const id of p.ids) {
        const row = playerBy.get(id)
        if (row) playerTeams.set(id, row.team)
      }
    }
    const byes = playerTeams.size
      ? await getByeWeeks({
          sport,
          season: week.season,
          playerTeams,
          fromWeek: week.week,
          /* This week only. The per-league screen is where a four-starter week-7
             pileup belongs; this board is about the lineup in front of you. */
          horizon: 0,
        }).catch(() => null)
      : null

    byeIdsBySport.set(sport, byes ? new Set(byes.byWeek.get(week.week) ?? []) : null)
  }

  /* ── 6. One row per checked lineup. ────────────────────────────────────── */
  const rows: MyTeamRow[] = []

  for (const p of pending) {
    const week = weekBySport.get(p.sport) ?? null
    const kickoffs = kickoffBySport.get(p.sport) ?? new Map<string, Date>()
    const byeIds = byeIdsBySport.get(p.sport) ?? null

    let out = 0
    let questionable = 0
    let unresolved = 0
    let bye: number | null = byeIds ? 0 : null
    let lockAt: Date | null = null

    for (const id of p.ids) {
      const row = playerBy.get(id)
      if (!row) {
        unresolved += 1
        continue
      }

      const status = injuryByName.get(`${p.sport}:${row.name.toLowerCase()}`) ?? null
      if (isRuledOut(status)) out += 1
      else if (isAtRisk(status)) questionable += 1

      const onBye = byeIds?.has(id) ?? false
      if (onBye) bye = (bye ?? 0) + 1

      /* A player on bye has no fixture this week, so he cannot set the lock. */
      if (onBye) continue
      const club = normalizeTeamAbbrev(row.team)
      const at = club ? kickoffs.get(club) : undefined
      if (at && (!lockAt || at < lockAt)) lockAt = at
    }

    const severity = p.empty + out + (bye ?? 0)

    rows.push({
      leagueId: p.leagueId,
      leagueName: p.leagueName,
      platform: p.platform,
      logoUrl: p.logoUrl,
      leagueBadge: p.leagueBadge,
      teamName: p.teamName,
      starters: p.ids.length,
      empty: p.empty,
      out,
      bye,
      questionable,
      unresolved,
      lockAt: lockAt ? lockAt.toISOString() : null,
      locked: lockAt != null && lockAt.getTime() <= now.getTime(),
      season: week?.season ?? null,
      week: week?.week ?? null,
      severity,
      href: `/core/my-team?league=${encodeURIComponent(p.leagueId)}`,
    })
  }

  /**
   * Soonest lock first, with "no lock we could read" last.
   *
   * A null lock is not "far away", it is unknown — so it sorts to the end
   * rather than to either extreme, where it would either shout for attention it
   * has not earned or hide behind leagues that are genuinely settled.
   */
  const byLock = (a: MyTeamRow, b: MyTeamRow) => {
    if (a.lockAt == null && b.lockAt == null) return 0
    if (a.lockAt == null) return 1
    if (b.lockAt == null) return -1
    return a.lockAt.localeCompare(b.lockAt)
  }

  const needsAll = rows
    .filter((r) => r.severity > 0)
    /*
     * A locked lineup cannot be fixed, so it sorts behind every one that can —
     * this column is a to-do list, and an item you cannot action is not the top
     * of it. It is still listed, because "you lost a slot here" is a fact.
     */
    .sort(
      (a, b) => Number(a.locked) - Number(b.locked) || b.severity - a.severity || byLock(a, b),
    )

  const setAll = rows.filter((r) => r.severity === 0).sort(byLock)

  return {
    needs: needsAll.slice(0, COLUMN_CAP),
    set: setAll.slice(0, COLUMN_CAP),
    needsTotal: needsAll.length,
    setTotal: setAll.length,
    considered: mine.length,
    checked: rows.length,
    byeChecked: rows.some((r) => r.bye != null),
    notChecked,
  }
}
