import 'server-only'

import { prisma } from '@/lib/prisma'
import { keepBestPerRealLeague } from './realLeague'
import { myRosterCandidates, rosterPlayerIds } from './myRoster'
import { translateRostersByLeague } from './rosterIdSpace'
import { composePlayerIdentities } from './playerIdentityCompose'
import { valueBookFor, CROSS_LEAGUE_BOOK, describeValueBook, type ValueBook } from './valueBook'
import { loadLatestPlayerValueSnapshots } from '@/lib/player-values/latestPlayerValueSnapshots'
import {
  captureDay,
  loadPlayerValueHistory,
  loadPlayerValueWindow,
  loadRosterValueSeries,
} from '@/lib/player-values/playerValueHistory'
import { injuryCoverageFor, resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { isAtRisk, isRuledOut } from './injuryStatus'
import { resolveSportsWeek, isPreseason } from './sportsWeek'
import { getByeWeeks } from './byeWeeks'
import { startingSlots } from './slotEligibility'
import { classifyLeagueFormat, competitiveStatus } from './portfolioClassify'
import type {
  InjuryKind,
  LeagueRisk,
  LeagueValueSeries,
  PlayerValueMover,
  PortfolioInsights,
  PortfolioLeagueFacts,
  PortfolioPlayer,
  SlotCode,
} from './portfolioInsightsTypes'

/**
 * `/core/portfolio` insights — exposure, risk, league mix, value history and the facts the action
 * ranking needs, for every team claimed to one user. Built once and cached (see
 * `portfolioInsightsSummary.ts`); the screen recounts it under filters in memory.
 *
 * ── 🛑 WHAT THIS REPLACES, AND WHY IT IS ONE LOADER ────────────────────────────────────────────
 *
 * The screen used to run three loaders on every request: `getPortfolio`, `getCrossLeagueExposure`
 * (top 12, rosters read one way) and `getCrossLeagueValueActions` (rosters read a second way, with
 * ESPN ids translated where the first did not). The two panels matched rows by player id, so an
 * ESPN player never matched his own value move. Reading every roster ONCE, translating ONCE and
 * deriving everything from that one read is what makes the numbers on the page agree.
 *
 * ── WHICH ROSTER IS YOURS ────────────────────────────────────────────────────────────────────
 *
 * Both recorded predicates, in `findRosterForTeam`'s order: the durable `source_manager_id` in
 * `playerData` first (96 of 98 claimed teams on production), then `platformUserId` against
 * `myRosterCandidates` (which adds your own user id — 93 of 106 where platform ids alone found
 * 38). One pass over rows already fetched, not one query per team.
 *
 * ⚠ EVERY ROSTER IN YOUR LEAGUES IS READ, NOT ONLY YOURS. Ranking your roster's value against
 * the league is the only way to say "contender" without a record to lean on, and that needs the
 * other rosters. It is one query per build; the build is cached.
 *
 * ── 🛑 NO PROVIDER CALLS ─────────────────────────────────────────────────────────────────────
 *
 * Postgres only: values from `PlayerValueSnapshot`, injuries from `SportsInjury` through the
 * canonical read port, byes from `SportsGame`. Safe for the cron that pre-builds it.
 *
 * ⚠ AND NO `lib/auth` IN THE IMPORT GRAPH. `/api/cron/domain-os-refresh` imports this module, and
 * `lib/auth.ts` throws at import without `NEXTAUTH_SECRET` — that is why the rankings snapshot
 * imports `rankingsCommunity.ts` and never `rankings.ts`. `leagueDisplayName` is inlined below for
 * the same reason: `leagueHome.ts` drags in the whole league screen.
 */

/** How far back the value chart reaches. FantasyCalc history on production starts 2026-08-16. */
export const VALUE_WINDOW_DAYS = 30
/** Players whose full series is shipped for sparklines. */
export const MAX_MOVERS = 12
/** Bye columns in the risk grid. */
export const BYE_COLUMNS = 4
const LAST_REGULAR_WEEK = 18

/** Dedicated positions whose lack of a backup is worth flagging. K and DEF are routinely rostered alone. */
const FRAGILE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB'] as const
const POSITION_FOLD: Record<string, string> = {
  FB: 'RB',
  DE: 'DL',
  DT: 'DL',
  NT: 'DL',
  ILB: 'LB',
  OLB: 'LB',
  MLB: 'LB',
  CB: 'DB',
  S: 'DB',
  FS: 'DB',
  SS: 'DB',
}

/** Same rule as `coaching_profile` in lib/chimmy-personalization/remembered.ts (pinned by a test). */
export const COACHING_PROFILE_KEY = 'coaching_profile'

function displayName(name: string | null | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : 'Untitled league'
}

function asIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).playerId ?? (x as Record<string, unknown>).id ?? '') : String(x ?? '')))
    .map((s) => s.trim())
    .filter(usableId)
}

/** Sleeper's `"0"` marks an empty slot; `name:` ids are the importer's unresolved fallback. */
export function usableId(id: string): boolean {
  return id.length > 0 && id !== '0' && id !== 'null' && id !== 'undefined' && !id.startsWith('name:')
}

/** Every player on one roster, with the slot he occupies. Starter beats IR beats taxi beats bench. */
export function rosterSlots(playerData: unknown): Map<string, SlotCode> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out = new Map<string, SlotCode>()
  const starters = new Set(asIds(pd.starters))
  const reserve = new Set([...asIds(pd.reserve), ...asIds(pd.ir)])
  const taxi = new Set(asIds(pd.taxi))
  for (const id of rosterPlayerIds(playerData)) {
    if (!usableId(id)) continue
    out.set(id, starters.has(id) ? 'S' : reserve.has(id) ? 'I' : taxi.has(id) ? 'T' : 'B')
  }
  // A starter the `players` list omits is still in the lineup.
  for (const id of starters) if (!out.has(id)) out.set(id, 'S')
  return out
}

function sourceManagerId(playerData: unknown): string | null {
  const v = (playerData as Record<string, unknown> | null)?.source_manager_id
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null
}

function bookLabel(book: ValueBook): string {
  return describeValueBook(book)
}

function bookKey(book: ValueBook): string {
  return `${book.format}:${book.qbFormat}`
}

/** Which position a player's listed position counts as for the fragile check. */
export function foldPosition(position: string | null | undefined): string | null {
  if (!position) return null
  const p = position.toUpperCase()
  return POSITION_FOLD[p] ?? p
}

/**
 * Dedicated starting slots with no healthy backup behind them.
 *
 * "Healthy" means rostered, not on IR, and not ruled out. Flex slots are ignored on purpose: a
 * flex can be filled from several positions, so an empty one is a lineup problem the home already
 * reports, not a depth problem at one position.
 */
export function fragilePositions(
  slots: readonly string[] | null,
  roster: ReadonlyMap<string, SlotCode>,
  positionOf: (id: string) => string | null,
  ruledOut: (id: string) => boolean,
): LeagueRisk['fragile'] {
  if (!slots) return null
  const required = new Map<string, number>()
  for (const s of slots) {
    const p = foldPosition(s === 'DST' ? 'DEF' : s)
    if (p && (FRAGILE_POSITIONS as readonly string[]).includes(p)) required.set(p, (required.get(p) ?? 0) + 1)
  }
  const out: NonNullable<LeagueRisk['fragile']> = []
  for (const [position, starters] of required) {
    const players: string[] = []
    let healthy = 0
    for (const [id, slot] of roster) {
      if (foldPosition(positionOf(id)) !== position) continue
      players.push(id)
      if (slot !== 'I' && !ruledOut(id)) healthy += 1
    }
    if (healthy <= starters) out.push({ position, starters, healthy, players })
  }
  return out.sort((a, b) => a.position.localeCompare(b.position))
}

/** The club supplying the most starters, when it supplies at least two. Ties break alphabetically. */
export function topStack(starters: readonly string[], teamOf: (id: string) => string | null): LeagueRisk['stack'] {
  const by = new Map<string, string[]>()
  for (const id of starters) {
    const t = teamOf(id)
    if (!t) continue
    const list = by.get(t) ?? []
    list.push(id)
    by.set(t, list)
  }
  let best: { team: string; players: string[] } | null = null
  for (const [team, players] of by) {
    if (
      !best ||
      players.length > best.players.length ||
      (players.length === best.players.length && team < best.team)
    ) {
      best = { team, players }
    }
  }
  return best && best.players.length >= 2 ? best : null
}

/**
 * Upcoming regular-season weeks the bye columns show — the next ones that actually HAVE byes.
 *
 * ⚠ NOT SIMPLY "THE NEXT FOUR WEEKS". Measured on the 65-league test account in week 2: the first
 * three columns were weeks 2–4, which have no byes at all, so three of four columns were zeros and
 * the week that mattered sat in the last one. `candidates` are weeks the schedule judged complete and
 * in which at least one of your clubs is off.
 */
export function upcomingByeWeeks(week: { week: number; preseason: boolean } | null, candidates: readonly number[]): number[] {
  if (!week) return []
  const start = week.preseason ? 1 : week.week
  const set = new Set(candidates)
  const out: number[] = []
  for (let w = start; w <= LAST_REGULAR_WEEK && out.length < BYE_COLUMNS; w++) {
    if (set.has(w)) out.push(w)
  }
  return out
}

function emptyInsights(now: Date, notes: PortfolioInsights['notes']): PortfolioInsights {
  return {
    version: 1,
    builtAt: now.toISOString(),
    leagues: [],
    players: [],
    risk: [],
    nflWeek: null,
    byeWeeks: [],
    injuryGaps: [],
    injuryFeedStale: false,
    valueDates: [],
    valueSeries: [],
    movers: [],
    playerValueBook: bookLabel(CROSS_LEAGUE_BOOK),
    notes,
  }
}

type LeagueRow = {
  id: string
  name: string | null
  platform: string
  sport: string
  season: number
  platformLeagueId: string
  userId: string
  leagueType: string | null
  isDynasty: boolean
  keeperCount: number | null
  keeperCostSystem: string | null
  keeperRoundPenalty: number | null
  settings: unknown
  leagueVariant: string | null
  bestBallMode: boolean | null
  status: string | null
  lifecycleState: string | null
  leagueSize: number | null
}

export async function buildPortfolioInsights(userId: string, now: Date = new Date()): Promise<PortfolioInsights> {
  if (!userId) return emptyInsights(now, { noClaimedTeams: true })

  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: {
      leagueId: true,
      wins: true,
      losses: true,
      ties: true,
      currentRank: true,
      platformUserId: true,
      externalId: true,
      isCommissioner: true,
      league: {
        select: {
          id: true,
          name: true,
          platform: true,
          sport: true,
          season: true,
          platformLeagueId: true,
          userId: true,
          leagueType: true,
          isDynasty: true,
          keeperCount: true,
          keeperCostSystem: true,
          keeperRoundPenalty: true,
          settings: true,
          leagueVariant: true,
          bestBallMode: true,
          status: true,
          lifecycleState: true,
          leagueSize: true,
        },
      },
    },
  })
  const claimed = teams.filter((t) => t.league != null)
  if (claimed.length === 0) return emptyInsights(now, { noClaimedTeams: true })

  const leagueIds = [...new Set(claimed.map((t) => t.leagueId))]
  const platformByLeague = new Map(claimed.map((t) => [t.leagueId, t.league!.platform ?? null]))

  const [counts, rawRosters, memories] = await Promise.all([
    prisma.leagueTeam.groupBy({ by: ['leagueId'], where: { leagueId: { in: leagueIds } }, _count: { _all: true } }),
    prisma.roster.findMany({
      where: { leagueId: { in: leagueIds } },
      select: { id: true, leagueId: true, platformUserId: true, playerData: true },
    }),
    prisma.aiMemory
      .findMany({
        where: {
          userId,
          scope: 'user_preferences',
          key: COACHING_PROFILE_KEY,
          OR: [{ leagueId: null }, { leagueId: { in: leagueIds } }],
        },
        select: { leagueId: true, value: true },
      })
      .catch(() => [] as Array<{ leagueId: string | null; value: unknown }>),
  ])
  const teamCountBy = new Map(counts.map((c) => [c.leagueId, c._count._all]))

  /* Declared direction: the league's own row, else the "all leagues" row. */
  const declaredBy = new Map<string | null, 'contender' | 'rebuilder'>()
  for (const m of memories) {
    const archetype = (m.value as Record<string, unknown> | null)?.teamArchetype
    if (archetype === 'contender' || archetype === 'rebuilder') declaredBy.set(m.leagueId, archetype)
  }

  /* Pick your roster per claimed team, BEFORE translation — `source_manager_id` is a raw field. */
  const rosterIndexByTeam = new Map<(typeof claimed)[number], number>()
  const rostersByLeague = new Map<string, number[]>()
  rawRosters.forEach((r, i) => {
    const list = rostersByLeague.get(r.leagueId) ?? []
    list.push(i)
    rostersByLeague.set(r.leagueId, list)
  })
  for (const t of claimed) {
    const candidates = rostersByLeague.get(t.leagueId) ?? []
    const bySource = t.platformUserId
      ? candidates.find((i) => sourceManagerId(rawRosters[i].playerData) === t.platformUserId)
      : undefined
    const allowed = new Set(myRosterCandidates(t, userId))
    const byColumn = candidates.find((i) => allowed.has(rawRosters[i].platformUserId))
    const pick = bySource ?? byColumn
    if (pick !== undefined) rosterIndexByTeam.set(t, pick)
  }

  const rosters = await translateRostersByLeague(rawRosters, platformByLeague)

  /* One row per REAL league — the same collapse and preference as the inventory list. */
  const kept = keepBestPerRealLeague(
    claimed,
    (t) => ({
      platform: String(t.league!.platform ?? '').toLowerCase(),
      platformLeagueId: t.league!.platformLeagueId ?? null,
      season: t.league!.season ?? null,
      leagueId: t.leagueId,
    }),
    (a, b) => {
      const aMine = a.league!.userId === userId
      const bMine = b.league!.userId === userId
      return (aMine && !bMine) || (aMine === bMine && !rosterIndexByTeam.has(b) && rosterIndexByTeam.has(a))
    },
  )
  kept.sort((a, b) => {
    if (a.isCommissioner !== b.isCommissioner) return a.isCommissioner ? -1 : 1
    return displayName(a.league!.name).localeCompare(displayName(b.league!.name))
  })

  /* Your roster per kept league, and every player id per sport. */
  const mySlots: Array<Map<string, SlotCode> | null> = kept.map((t) => {
    const i = rosterIndexByTeam.get(t)
    return i === undefined ? null : rosterSlots(rosters[i].playerData)
  })
  const idsBySport = new Map<string, Set<string>>()
  kept.forEach((t, li) => {
    const slots = mySlots[li]
    if (!slots) return
    const sport = String(t.league!.sport ?? 'NFL').toUpperCase()
    const set = idsBySport.get(sport) ?? new Set<string>()
    for (const id of slots.keys()) set.add(id)
    idsBySport.set(sport, set)
  })

  /* Identities, per sport — club codes collide across sports (ATL, CHI, DET, MIA, PHI). */
  const identity = new Map<string, { name: string | null; position: string | null; team: string | null }>()
  await Promise.all(
    [...idsBySport.entries()].map(async ([sport, ids]) => {
      if (ids.size === 0) return
      const rows = await prisma.sportsPlayer
        .findMany({
          /* Insensitive: several writers upsert this table and not all of them upper-case the sport. */
          where: { sleeperId: { in: [...ids] }, sport: { equals: sport, mode: 'insensitive' } },
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
        })
        .catch(() => [])
      for (const [id, p] of composePlayerIdentities(rows)) {
        identity.set(`${sport}:${id}`, { name: p.name, position: p.position, team: p.team })
      }
    }),
  )

  /* ── values ─────────────────────────────────────────────────────────────── */
  const since = new Date(now.getTime() - VALUE_WINDOW_DAYS * 86_400_000)
  const nflLeagueIdx = kept.map((t, i) => (String(t.league!.sport ?? 'NFL').toUpperCase() === 'NFL' ? i : -1)).filter((i) => i >= 0)
  const bookByLeague = new Map<number, ValueBook>()
  for (const i of nflLeagueIdx) {
    bookByLeague.set(i, valueBookFor(kept[i].league!.settings, kept[i].league!.leagueType ?? null))
  }

  /* Every roster in each NFL league, for the value rank — ids grouped by book. */
  const idsByBook = new Map<string, { book: ValueBook; ids: Set<string> }>()
  const leagueRosterIds = new Map<number, string[][]>()
  const myRosterPosition = new Map<number, number>()
  for (const li of nflLeagueIdx) {
    const book = bookByLeague.get(li)!
    const entry = idsByBook.get(bookKey(book)) ?? { book, ids: new Set<string>() }
    const lists: string[][] = []
    const mine = rosterIndexByTeam.get(kept[li])
    for (const ri of rostersByLeague.get(kept[li].leagueId) ?? []) {
      const ids = [...rosterSlots(rosters[ri].playerData).keys()]
      if (ri === mine) myRosterPosition.set(li, lists.length)
      lists.push(ids)
      for (const id of ids) entry.ids.add(id)
    }
    leagueRosterIds.set(li, lists)
    idsByBook.set(bookKey(book), entry)
  }
  const nflPlayerIds = [...(idsBySport.get('NFL') ?? [])]

  const [latestByBook, crossLatest, crossWindow, seriesByBook] = await Promise.all([
    Promise.all(
      [...idsByBook.values()].map(async ({ book, ids }) => {
        const rows = await loadLatestPlayerValueSnapshots({ sleeperIds: ids, ...book }).catch(() => [])
        return [bookKey(book), new Map(rows.map((r) => [r.sleeperId, r.value]))] as const
      }),
    ).then((entries) => new Map(entries)),
    loadLatestPlayerValueSnapshots({ sleeperIds: nflPlayerIds, ...CROSS_LEAGUE_BOOK }).catch(() => []),
    loadPlayerValueWindow({ sleeperIds: nflPlayerIds, book: CROSS_LEAGUE_BOOK, since }).catch(() => []),
    Promise.all(
      [...idsByBook.values()].map(async ({ book }) => {
        const pairs: Array<{ leagueId: string; sleeperId: string }> = []
        for (const li of nflLeagueIdx) {
          if (bookKey(bookByLeague.get(li)!) !== bookKey(book)) continue
          const slots = mySlots[li]
          if (!slots) continue
          for (const id of slots.keys()) pairs.push({ leagueId: kept[li].leagueId, sleeperId: id })
        }
        return loadRosterValueSeries({ pairs, book, since }).catch(() => [])
      }),
    ).then((parts) => parts.flat()),
  ])

  const crossValue = new Map(crossLatest.map((r) => [r.sleeperId, r.value]))
  const windowBy = new Map(crossWindow.map((w) => [w.sleeperId, w]))

  /* Roster value and rank per NFL league. */
  const valueFacts = new Map<number, { value: number | null; rank: number | null; valued: number }>()
  for (const li of nflLeagueIdx) {
    const prices = latestByBook.get(bookKey(bookByLeague.get(li)!)) ?? new Map<string, number>()
    const totals = (leagueRosterIds.get(li) ?? []).map((ids) => {
      let sum = 0
      let priced = 0
      for (const id of ids) {
        const v = prices.get(id)
        if (v != null) {
          sum += v
          priced += 1
        }
      }
      return priced > 0 ? sum : null
    })
    const minePos = myRosterPosition.get(li)
    const mine = minePos !== undefined ? totals[minePos] : null
    const valued = totals.filter((v): v is number => v != null)
    const rank = mine != null ? valued.filter((v) => v > mine).length + 1 : null
    valueFacts.set(li, { value: mine, rank, valued: valued.length })
  }

  /* ── schedule: current week and byes ──────────────────────────────────── */
  const clubs = new Set<string>()
  for (const id of nflPlayerIds) {
    const t = identity.get(`NFL:${id}`)?.team
    if (t) clubs.add(t)
  }
  const sportsWeek = nflPlayerIds.length > 0 ? await resolveSportsWeek('NFL', now).catch(() => null) : null
  const nflWeek = sportsWeek
    ? { season: sportsWeek.season, week: sportsWeek.week, preseason: isPreseason(sportsWeek.seasonType) }
    : null
  const byes =
    sportsWeek && clubs.size > 0
      ? await getByeWeeks({
          sport: 'NFL',
          season: sportsWeek.season,
          playerTeams: new Map([...clubs].map((c) => [c, c])),
          fromWeek: 1,
          horizon: LAST_REGULAR_WEEK - 1,
        }).catch(() => null)
      : null
  const byeWeekOf = new Map<string, number>()
  if (byes) {
    for (const [week, offClubs] of [...byes.byWeek.entries()].sort((a, b) => a[0] - b[0])) {
      for (const c of offClubs) if (!byeWeekOf.has(c)) byeWeekOf.set(c, week)
    }
  }
  const covered = new Set(byes?.weeksCovered ?? [])
  const byeWeeks = upcomingByeWeeks(
    nflWeek,
    [...(byes?.byWeek.keys() ?? [])].filter((w) => covered.has(w)),
  )

  /* ── injuries, per sport the feed can answer ──────────────────────────── */
  const injuryGaps: PortfolioInsights['injuryGaps'] = []
  const injuryBy = new Map<string, { status: string; kind: InjuryKind }>()
  let injuryFeedStale = false
  await Promise.all(
    [...idsBySport.entries()].map(async ([sport, ids]) => {
      const coverage = injuryCoverageFor(sport)
      if (!coverage.covered) {
        injuryGaps.push({ sport, reason: coverage.reason ?? 'no injury feed for this sport' })
        return
      }
      const lookups = [...ids]
        .map((id) => ({ id, p: identity.get(`${sport}:${id}`) }))
        .filter((x): x is { id: string; p: { name: string; position: string | null; team: string | null } } => Boolean(x.p?.name))
      if (lookups.length === 0) return
      const res = await resolveInjuryFacts({
        sport,
        players: lookups.map((x) => ({ name: x.p.name, position: x.p.position, team: x.p.team })),
        now,
      }).catch(() => null)
      if (!res) return
      if (res.feedStale) injuryFeedStale = true
      for (const { id, p } of lookups) {
        const fact = res.byPlayer.get(normalizeMatchName(p.name))
        /* A stale claim is suppressed, not shown — a stale "Out" badge is a confident falsehood. */
        if (!fact || fact.stale || !fact.status) continue
        const status = String(fact.status)
        const kind: InjuryKind | null = isRuledOut(status) ? 'out' : isAtRisk(status) ? 'risk' : null
        if (kind) injuryBy.set(`${sport}:${id}`, { status, kind })
      }
    }),
  )

  /* ── leagues ─────────────────────────────────────────────────────────── */
  const leagues: PortfolioLeagueFacts[] = kept.map((t, li) => {
    const lg = t.league! as unknown as LeagueRow
    const format = classifyLeagueFormat(lg)
    const teamCount = teamCountBy.get(t.leagueId) ?? lg.leagueSize ?? null
    const record = { wins: t.wins, losses: t.losses, ties: t.ties }
    const played = record.wins + record.losses + record.ties > 0
    const vf = valueFacts.get(li)
    const declared = declaredBy.get(t.leagueId) ?? declaredBy.get(null) ?? null
    const status = competitiveStatus({
      declared,
      record: played ? record : null,
      rank: t.currentRank ?? null,
      teamCount,
      rosterValueRank: vf?.rank ?? null,
      valuedTeams: vf?.valued ?? null,
    })
    const book = bookByLeague.get(li)
    return {
      id: t.leagueId,
      name: displayName(lg.name),
      platform: String(lg.platform ?? 'manual').toLowerCase(),
      sport: String(lg.sport ?? 'NFL').toUpperCase(),
      season: lg.season != null ? String(lg.season) : null,
      ...format,
      commissioner: Boolean(t.isCommissioner),
      teamCount,
      record: played ? record : null,
      /* A rank before any game is a draft slot or a seed — withheld, as the inventory row does. */
      rank: played ? (t.currentRank ?? null) : null,
      status: status.status,
      statusSource: status.source,
      rosterValue: vf?.value ?? null,
      rosterValueRank: vf?.rank ?? null,
      valuedTeams: vf ? vf.valued : null,
      valueBook: book ? bookLabel(book) : null,
      /*
       * ⚠ A MATCHED ROSTER WITH NO PLAYERS IS NOT A READABLE ONE. Pre-draft leagues carry empty
       * roster rows (six of them on the 65-league test account); counting them would put leagues
       * that cannot hold anybody into every exposure share's denominator.
       */
      hasRoster: (mySlots[li]?.size ?? 0) > 0,
      slotsKnown: startingSlots(lg.settings) != null,
    }
  })

  /* ── players ─────────────────────────────────────────────────────────── */
  const playerByKey = new Map<string, PortfolioPlayer>()
  let unmatched = 0
  kept.forEach((t, li) => {
    const slots = mySlots[li]
    if (!slots) return
    const sport = leagues[li].sport
    for (const [id, slot] of slots) {
      const key = `${sport}:${id}`
      let p = playerByKey.get(key)
      if (!p) {
        const who = identity.get(key)
        if (!who?.name) unmatched += 1
        const w = sport === 'NFL' ? windowBy.get(id) : undefined
        p = {
          key,
          id,
          sport,
          name: who?.name ?? 'Unmatched player',
          position: who?.position ?? null,
          team: who?.team ?? null,
          value: sport === 'NFL' ? (crossValue.get(id) ?? null) : null,
          valueDelta: w && w.firstDay !== w.lastDay ? w.last - w.first : null,
          injury: injuryBy.get(key) ?? null,
          byeWeek: sport === 'NFL' && who?.team ? (byeWeekOf.get(who.team) ?? null) : null,
          held: [],
        }
        playerByKey.set(key, p)
      }
      p.held.push([li, slot])
    }
  })
  const players = [...playerByKey.values()]

  /* ── risk ────────────────────────────────────────────────────────────── */
  const risk: LeagueRisk[] = []
  kept.forEach((t, li) => {
    const slots = mySlots[li]
    if (!slots || slots.size === 0 || leagues[li].sport !== 'NFL') return
    const k = (id: string) => `NFL:${id}`
    const starters = [...slots.entries()].filter(([, s]) => s === 'S').map(([id]) => id)
    const out = starters.filter((id) => injuryBy.get(k(id))?.kind === 'out')
    const atRisk = starters.filter((id) => injuryBy.get(k(id))?.kind === 'risk')
    const byesFor: Record<string, string[]> = {}
    for (const w of byeWeeks) {
      const off = starters.filter((id) => playerByKey.get(k(id))?.byeWeek === w)
      if (off.length > 0) byesFor[String(w)] = off.map(k)
    }
    const fragile = fragilePositions(
      startingSlots(t.league!.settings),
      slots,
      (id) => identity.get(k(id))?.position ?? null,
      (id) => injuryBy.get(k(id))?.kind === 'out',
    )
    const stack = topStack(starters, (id) => identity.get(k(id))?.team ?? null)
    risk.push({
      leagueIndex: li,
      out: out.map(k),
      atRisk: atRisk.map(k),
      byes: byesFor,
      fragile: fragile ? fragile.map((f) => ({ ...f, players: f.players.map(k) })) : null,
      stack: stack ? { team: stack.team, players: stack.players.map(k) } : null,
    })
  })

  /* ── value series ─────────────────────────────────────────────────────── */
  const days = new Set<string>()
  for (const r of seriesByBook) days.add(r.day)
  const valueDates = [...days].sort()
  const dayIndex = new Map(valueDates.map((d, i) => [d, i]))
  const seriesByLeague = new Map<string, LeagueValueSeries>()
  kept.forEach((t, li) => {
    if (!bookByLeague.has(li) || !mySlots[li] || mySlots[li]!.size === 0) return
    seriesByLeague.set(t.leagueId, {
      leagueIndex: li,
      values: valueDates.map(() => null),
      priced: valueDates.map(() => null),
      rosterSize: mySlots[li]!.size,
    })
  })
  for (const r of seriesByBook) {
    const s = seriesByLeague.get(r.leagueId)
    const at = dayIndex.get(r.day)
    if (!s || at === undefined) continue
    s.values[at] = r.total
    s.priced[at] = r.priced
  }
  const valueSeries = [...seriesByLeague.values()].sort((a, b) => a.leagueIndex - b.leagueIndex)

  /* ── movers: biggest absolute moves among players you hold, with their series ── */
  const moverIds = crossWindow
    .filter((w) => w.firstDay !== w.lastDay && w.last !== w.first)
    .sort((a, b) => Math.abs(b.last - b.first) - Math.abs(a.last - a.first))
    .slice(0, MAX_MOVERS)
    .map((w) => w.sleeperId)
  const history = moverIds.length
    ? await loadPlayerValueHistory({ sleeperIds: moverIds, book: CROSS_LEAGUE_BOOK, since }).catch(() => [])
    : []
  const movers: PlayerValueMover[] = moverIds.map((id) => {
    const values: Array<number | null> = valueDates.map(() => null)
    for (const pt of history) {
      if (pt.sleeperId !== id) continue
      const at = dayIndex.get(pt.day)
      if (at !== undefined) values[at] = pt.value
    }
    return { key: `NFL:${id}`, values }
  })

  const rostersMissing = mySlots.filter((s) => s == null || s.size === 0).length

  return {
    version: 1,
    builtAt: now.toISOString(),
    leagues,
    players,
    risk,
    nflWeek,
    byeWeeks,
    injuryGaps,
    injuryFeedStale,
    valueDates,
    valueSeries,
    movers,
    playerValueBook: bookLabel(CROSS_LEAGUE_BOOK),
    notes: {
      ...(rostersMissing > 0 ? { rostersMissing } : {}),
      ...(unmatched > 0 ? { unmatchedPlayers: unmatched } : {}),
    },
  }
}

/**
 * Each league's roster value on the latest capture day, for the daily totals record.
 *
 * ⚠ THE SERIES' LAST POINT, NOT `rosterValue`. `rosterValue` prices each player at his NEWEST
 * row, which for a player who fell out of the priced pool can be weeks old; the series prices
 * everyone on one exact day. A recorded day has to sit on the same line as the reconstructed days
 * beside it, or the chart would draw the difference between two pricing rules as a market move.
 */
export function dailyValuesOf(insights: PortfolioInsights): Record<string, number> {
  const out: Record<string, number> = {}
  const last = insights.valueDates.length - 1
  if (last < 0) return out
  for (const s of insights.valueSeries) {
    const v = s.values[last]
    const id = insights.leagues[s.leagueIndex]?.id
    if (v != null && id) out[id] = v
  }
  return out
}

/** The capture day today's values are quoted at — the last day the chart has. */
export function latestCaptureDay(insights: PortfolioInsights): string | null {
  return insights.valueDates[insights.valueDates.length - 1] ?? null
}

export { captureDay }
