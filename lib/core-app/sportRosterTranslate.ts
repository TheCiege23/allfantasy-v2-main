import 'server-only'

import { prisma } from '@/lib/prisma'
import { asHeadshotUrl } from './playerIdentityCompose'
import {
  leagueSportOf,
  nativeCatalogSource,
  rosterIdRouteFor,
  sportPlayerKey,
  type RosterIdRoute,
} from './sportRosterKey'

/**
 * Reads YOUR roster in a league of another sport — Fantrax, AF-native, Sleeper NBA, ESPN… — as catalog
 * players, for the Player Finder home's shares and flagged-starter lists (sportRosterKey.ts says why).
 *
 * The chain, measured on production 2026-11-11 for one account's five in-season Fantrax leagues
 * (NBA ×2, NHL, NCAAF, NCAAB): 93 of 101 roster ids resolved to a catalog row —
 *
 *     Fantrax id ──PlayerIdentityMap.fantraxId──▶ identity ──rollingInsightsId / cfbdId──▶ SportsPlayer
 *
 * NBA, NHL and NCAAB reach Rolling Insights rows; NCAAF reaches CFBD rows (39 of 39 carry a cfbdId,
 * only 12 a Rolling Insights id). A native league already holds the catalog's own ids.
 *
 * ⚠ AN ID THAT DOES NOT RESOLVE IS DROPPED AND COUNTED, NEVER KEPT RAW. Kept raw it is whichever player
 * shares the number in some other vocabulary (the collision rosterIdSpace.ts exists for). The count is
 * returned so a screen can say "8 players could not be identified" rather than imply the list is whole.
 *
 * ⚠ AN IDENTITY COLUMN THAT MATCHES TWO ROWS IS AMBIGUOUS AND DROPPED. `fantraxId` is deliberately not
 * unique (schema.prisma); picking either row would attach one man's injury to another's roster spot.
 */

export type SportCatalogPlayer = {
  key: string
  sport: string
  source: string
  externalId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
}

type TranslatedRoster = {
  leagueId: string
  sport: string
  starters: string[]
  reserve: string[]
  taxi: string[]
  players: string[]
  /** Distinct roster ids in this league that reached no catalog player. */
  unidentified: number
  /** Distinct roster ids in this league, empty slots excluded. */
  total: number
}

type SportRosterLeague = { id: string; sport: string | null; platform: string | null }

type TranslatedSportRosters = {
  rosters: Map<string, TranslatedRoster>
  catalog: Map<string, SportCatalogPlayer>
  /** Leagues of another sport on a platform with no id link at all — the old "can't read yet". */
  unsupported: Set<string>
}

const SLOTS = ['starters', 'reserve', 'taxi', 'players'] as const
const EMPTY_SLOT = '0'

function idsIn(playerData: unknown, key: (typeof SLOTS)[number]): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const arr = (playerData as Record<string, unknown>)[key]
  if (!Array.isArray(arr)) return []
  return arr.map((x) => (x == null ? '' : String(x).trim())).filter((x) => x && x !== EMPTY_SLOT)
}

/** True when this league is read by this module rather than the NFL Sleeper-id readers. */
export function isTranslatedSportLeague(league: { sport: string | null; platform: string | null }): boolean {
  return leagueSportOf(league.sport) !== 'NFL'
}

type Candidate = { source: string; externalId: string }

export async function translateSportRosters(
  leagues: readonly SportRosterLeague[],
  rosterByLeague: ReadonlyMap<string, unknown>,
): Promise<TranslatedSportRosters> {
  const rosters = new Map<string, TranslatedRoster>()
  const catalog = new Map<string, SportCatalogPlayer>()
  const unsupported = new Set<string>()

  type Plan = { league: SportRosterLeague; sport: string; route: RosterIdRoute; slots: Record<(typeof SLOTS)[number], string[]>; ids: Set<string> }
  const plans: Plan[] = []
  for (const league of leagues) {
    const sport = leagueSportOf(league.sport)
    if (sport === 'NFL' || !rosterByLeague.has(league.id)) continue
    const route = rosterIdRouteFor(league.platform, sport)
    if (!route) {
      unsupported.add(league.id)
      continue
    }
    const pd = rosterByLeague.get(league.id)
    const slots = { starters: idsIn(pd, 'starters'), reserve: idsIn(pd, 'reserve'), taxi: idsIn(pd, 'taxi'), players: idsIn(pd, 'players') }
    plans.push({ league, sport, route, slots, ids: new Set(SLOTS.flatMap((k) => slots[k])) })
  }
  if (plans.length === 0) return { rosters, catalog, unsupported }

  // ── 1. Every roster id → the catalog rows it could be, per (sport, id) ─────────────────────────
  const candidatesOf = new Map<string, Candidate[]>() // `${sport}|${rawId}|${routeTag}` → candidates
  const tagOf = (route: RosterIdRoute) => (route.kind === 'identity' ? route.column : route.kind)
  const ckey = (sport: string, route: RosterIdRoute, id: string) => `${sport}#${tagOf(route)}#${id}`

  // Identity lookups, one query per (sport, column).
  const identityAsks = new Map<string, { sport: string; column: string; ids: Set<string> }>()
  // Sleeper-of-another-sport lookups, one query per sport.
  const sleeperAsks = new Map<string, Set<string>>()
  for (const p of plans) {
    for (const id of p.ids) {
      if (p.route.kind === 'catalog') {
        const source = nativeCatalogSource(id)
        candidatesOf.set(ckey(p.sport, p.route, id), source ? [{ source, externalId: id }] : [])
      } else if (p.route.kind === 'identity') {
        const k = `${p.sport}#${p.route.column}`
        const ask = identityAsks.get(k) ?? { sport: p.sport, column: p.route.column, ids: new Set<string>() }
        ask.ids.add(id)
        identityAsks.set(k, ask)
      } else {
        const set = sleeperAsks.get(p.sport) ?? new Set<string>()
        set.add(id)
        sleeperAsks.set(p.sport, set)
      }
    }
  }

  await Promise.all([
    ...[...identityAsks.values()].map(async ({ sport, column, ids }) => {
      const rows = await prisma.playerIdentityMap
        .findMany({
          where: { sport, [column]: { in: [...ids] } },
          select: { fantraxId: true, espnId: true, mflId: true, fleaflickerId: true, sleeperNbaId: true, rollingInsightsId: true, cfbdId: true },
        })
        .catch(() => [] as Array<Record<string, string | null>>)
      const byId = new Map<string, Array<Record<string, string | null>>>()
      for (const r of rows) {
        const id = (r as Record<string, string | null>)[column]
        if (!id) continue
        const list = byId.get(id) ?? []
        list.push(r as Record<string, string | null>)
        byId.set(id, list)
      }
      const route = { kind: 'identity', column } as RosterIdRoute
      for (const id of ids) {
        const matches = byId.get(id) ?? []
        // Two identities under one provider id: ambiguous, dropped (see the header).
        const one = matches.length === 1 ? matches[0]! : null
        const cands: Candidate[] = []
        if (one?.rollingInsightsId) cands.push({ source: 'rolling_insights', externalId: one.rollingInsightsId })
        if (one?.cfbdId) cands.push({ source: 'cfbd', externalId: one.cfbdId })
        candidatesOf.set(ckey(sport, route, id), cands)
      }
    }),
    ...[...sleeperAsks].map(async ([sport, ids]) => {
      const rows = await prisma.sportsPlayer
        .findMany({
          where: { sport, sleeperId: { in: [...ids] } },
          select: { sleeperId: true, source: true, externalId: true, name: true, position: true, team: true, imageUrl: true },
        })
        .catch(() => [] as Array<{ sleeperId: string | null; source: string; externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }>)
      const route = { kind: 'sleeperCatalog' } as RosterIdRoute
      const bySleeper = new Map<string, Candidate[]>()
      for (const r of rows) {
        if (!r.sleeperId || !r.name?.trim()) continue
        // These ARE the catalog rows; no second read for them below.
        const key = sportPlayerKey(sport, r.source, r.externalId)
        catalog.set(key, { key, sport, source: r.source, externalId: r.externalId, name: r.name.trim(), position: r.position, team: r.team, imageUrl: asHeadshotUrl(r.imageUrl) })
        const list = bySleeper.get(r.sleeperId) ?? []
        // The row with a headshot first; the order only decides which of HIS rows names him.
        if (r.imageUrl) list.unshift({ source: r.source, externalId: r.externalId })
        else list.push({ source: r.source, externalId: r.externalId })
        bySleeper.set(r.sleeperId, list)
      }
      for (const id of ids) candidatesOf.set(ckey(sport, route, id), bySleeper.get(id) ?? [])
    }),
  ])

  // ── 2. One catalog read per (sport, source) for every candidate ─────────────────────────────────
  const catalogAsks = new Map<string, { sport: string; source: string; ids: Set<string> }>()
  for (const [k, cands] of candidatesOf) {
    const sport = k.split('#')[0]!
    for (const c of cands) {
      if (catalog.has(sportPlayerKey(sport, c.source, c.externalId))) continue
      const ak = `${sport}#${c.source}`
      const ask = catalogAsks.get(ak) ?? { sport, source: c.source, ids: new Set<string>() }
      ask.ids.add(c.externalId)
      catalogAsks.set(ak, ask)
    }
  }
  await Promise.all(
    [...catalogAsks.values()].map(async ({ sport, source, ids }) => {
      const rows = await prisma.sportsPlayer
        .findMany({
          where: { sport, source, externalId: { in: [...ids] } },
          select: { sport: true, source: true, externalId: true, name: true, position: true, team: true, imageUrl: true },
        })
        .catch(() => [] as Array<{ sport: string; source: string; externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }>)
      for (const r of rows) {
        if (!r.name?.trim()) continue
        const key = sportPlayerKey(sport, r.source, r.externalId)
        catalog.set(key, {
          key,
          sport,
          source: r.source,
          externalId: r.externalId,
          name: r.name.trim(),
          position: r.position,
          team: r.team,
          imageUrl: asHeadshotUrl(r.imageUrl),
        })
      }
    }),
  )

  // ── 3. Each roster, in keys; an id with no catalog row is dropped and counted ───────────────────
  for (const p of plans) {
    const keyOf = new Map<string, string>()
    for (const id of p.ids) {
      const hit = (candidatesOf.get(ckey(p.sport, p.route, id)) ?? [])
        .map((c) => sportPlayerKey(p.sport, c.source, c.externalId))
        .find((k) => catalog.has(k))
      if (hit) keyOf.set(id, hit)
    }
    const map = (ids: string[]) => [...new Set(ids.map((id) => keyOf.get(id)).filter((k): k is string => Boolean(k)))]
    rosters.set(p.league.id, {
      leagueId: p.league.id,
      sport: p.sport,
      starters: map(p.slots.starters),
      reserve: map(p.slots.reserve),
      taxi: map(p.slots.taxi),
      players: map(p.slots.players),
      unidentified: p.ids.size - keyOf.size,
      total: p.ids.size,
    })
  }
  return { rosters, catalog, unsupported }
}
