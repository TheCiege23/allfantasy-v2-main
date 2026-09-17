/**
 * The waiver-wire pool for one league — the input `loadWaiverWorldFacts` deliberately does not load.
 *
 * 🛑 THIS IS THE THING THAT MADE `waiverDecision` UNPRODUCIBLE. `packet.ts` recorded the blocker
 * exactly: "`WaiverAIEngineInput` needs `availablePlayers`, the waiver wire pool, which the legacy
 * route already holds and `loadWaiverWorldFacts` does not load." The legacy route holds it because
 * the CLIENT posts it (`availablePlayers: z.array(...).min(1)` on /api/waiver-ai/engine) — there is
 * no server-side assembly there to reuse. This module is that assembly.
 *
 * ⚠ IT IS THE SAME RESOLVER AND THE SAME SUBTRACTION THE WAIVER ASSISTANT ALREADY USES
 * (`lib/ai/waivers/waiverRecommendationService.ts`), reused rather than re-derived. Two answers to
 * "who is available in this league" is the bug; the assistant and the packet must not be able to
 * disagree about it.
 *
 * ── 🛑 A POOL OF NAMES COULD NEVER PRODUCE A RECOMMENDATION ───────────────────────────────────
 * Measured on origin/main 2026-09-17: this module sent `{id, name, position}`, so `suggest.ts` read
 * `value` as 0 and `scoreWaiverCandidates` skipped every candidate (`value < 200`). Every waiver
 * answer — Chimmy's and the Decision OS card's — was therefore "Hold your FAAB/priority", whatever
 * was on the wire. That is the last open gap from the /core league-view brief's item 4.
 *
 * ⚠ AND A PRICE ALONE IS NOT ENOUGH, which is why the rosters are loaded too. Worked through the
 * scorer's own weights with prices but no roster context, a 3,000-value back scores ~33 — "Monitor",
 * never "Add" — because `needFit` falls back to its neutral 20 and no drop can be named. The scorer
 * needs three things: a price, the asker's slotted roster, and every roster in the league (the median
 * behind "your weakest slot"). All three come from the reads this module already made, plus one
 * player-row lookup and one value payload.
 *
 * ⚠ PRICED UNDER THIS LEAGUE'S OWN RULES. `playerValueForLeague` applies the per-position reception
 * weight a flat chart cannot express — the same call the player card and the trade verdict make. A
 * waiver board priced off a generic PPR chart under a "priced for this league" label is the failure
 * `league-view-scoring-audit` recorded twice.
 *
 * ⚠ AN UNPRICED WIRE IS REPORTED, NOT SCORED AS ZERO. `pricing` carries the coverage, the DCO turns
 * it into uncertainty, and the decision says the wire could not be priced rather than "no qualifying
 * targets" — which a reader would take for "nobody is worth adding".
 */
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayerPoolForSport } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import type { WaiverRosterPlayer } from '@/lib/waiver-engine/waiver-scoring'

/** One player on the wire, as the scorer consumes him. */
export interface WaiverPoolCandidate {
  id: string
  name: string
  position: string
  team: string | null
  age: number | null
  /** League-adjusted market value. 0 when this league's chart does not carry him. */
  value: number
}

export interface WaiverPoolPricing {
  /** Available players carrying a value. */
  priced: number
  /** Available players considered. */
  total: number
  /** How they were priced, for the record. Null when no value set resolved at all. */
  basis: string | null
}

export interface WaiverPool {
  availablePlayers: WaiverPoolCandidate[]
  /**
   * The asker's own players, slotted and priced.
   *
   * ⚠ WITHOUT THIS THE ENGINE CANNOT NAME A DROP: `findDropCandidate` reads `ctx.rosterPlayers` and
   * returns null on an empty one, so "who do I drop" had no answer to give.
   */
  myRoster: WaiverRosterPlayer[]
  /** Every roster in the league, priced — the league median behind "your weakest slot". */
  leagueRosters: { players: WaiverRosterPlayer[] }[]
  /** The league's own starting slots (`roster_positions`), for the slot maths. */
  rosterPositions: string[]
  /** The traits the scorer reads, taken from the market context so no predicate is re-derived. */
  leagueTraits: { numTeams: number; isSF: boolean; isTEP: boolean; isDynasty: boolean }
  /** The week the bye-cluster maths is relative to. Null when no projection week is on file. */
  currentWeek: number | null
  /**
   * True when the pool is a bounded slice rather than the whole wire.
   *
   * ⚠ REPORTED, NOT HIDDEN. `runWaiverClaimDecision` takes `poolIncomplete` and the decision's
   * honesty depends on it: a recommendation drawn from the top 300 is a recommendation from a
   * SAMPLE, and saying so is the difference between "the best add" and "the best add we looked at".
   */
  poolIncomplete: boolean
  /** Rosters found for this league. Zero means the subtraction below was vacuous. */
  leagueRosterCount: number
  pricing: WaiverPoolPricing
}

/** Matches the assistant's `deep` mode. A larger slice costs one query, not one per player. */
const POOL_LIMIT = 300

/** A Sleeper id is all digits. Anything else in that column is a provider id and joins nowhere. */
const SLEEPER_ID = /^\d+$/

type RosterRow = { id: string; platformUserId: string; playerData: unknown }

/** The slots `Roster.playerData` distinguishes, in the vocabulary the scorer reads. */
function slotsOf(playerData: unknown): Map<string, WaiverRosterPlayer['slot']> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out = new Map<string, WaiverRosterPlayer['slot']>()
  const put = (key: string, slot: WaiverRosterPlayer['slot']) => {
    const v = pd[key]
    if (!Array.isArray(v)) return
    for (const raw of v) {
      const id = raw == null ? '' : String(raw)
      /*
       * ⚠ A STORED LINEUP CARRIES NO EMPTY-SLOT MARKER in this codebase, so a falsy entry is an
       * empty slot rather than a player. Counting one would invent a starter.
       */
      if (id && !out.has(id)) out.set(id, slot)
    }
  }
  put('starters', 'starter')
  put('reserve', 'ir')
  put('taxi', 'taxi')
  put('players', 'bench')
  return out
}

export async function loadWaiverPool(leagueId: string, sport: string, rosterId?: string | null): Promise<WaiverPool> {
  const [league, rosterRows, pool, projectionWeek] = await Promise.all([
    prisma.league
      .findUnique({ where: { id: leagueId }, select: { settings: true, leagueType: true, leagueSize: true } })
      .catch(() => null),
    prisma.roster
      .findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } })
      .catch(() => []),
    getPlayerPoolForSport(sport, { limit: POOL_LIMIT }),
    import('@/lib/core-app/playerProjections')
      .then((m) => m.latestProjectionWeek())
      .catch(() => null),
  ])
  const leagueRosters = rosterRows as RosterRow[]

  /*
   * ⚠ EVERY ROSTER IN THE LEAGUE, NOT JUST THE ASKER'S. A pool that subtracts only your own players
   * recommends people already rostered by your opponents — confidently, and with a FAAB bid attached.
   * That is worse than no recommendation, because it looks actionable.
   */
  const rosteredIds = new Set<string>()
  const slotsByRoster = new Map<string, Map<string, WaiverRosterPlayer['slot']>>()
  for (const r of leagueRosters) {
    const slots = slotsOf(r.playerData)
    slotsByRoster.set(r.id, slots)
    for (const id of getRosterPlayerIds(r.playerData)) rosteredIds.add(id)
    for (const id of slots.keys()) rosteredIds.add(id)
  }

  const available = pool.filter((p) => {
    const ids = [p.player_id, p.external_source_id].filter(Boolean) as string[]
    return !ids.some((id) => rosteredIds.has(id))
  })

  /*
   * The value set for THIS league. `marketContextFor` is imported lazily for the reason the player
   * card gives: its module also reaches the trade engine, and a waiver read must not drag that in.
   */
  const settings = league?.settings ?? null
  const teams = leagueRosters.length || league?.leagueSize || 12
  const priced = await (async () => {
    const none = { variant: null as null | { superflex: boolean; dynasty: boolean; keeper: boolean }, scoringSettings: {} as Record<string, number>, get: null as null | ((sleeperId: string | null) => number), basis: null as string | null }
    try {
      const [{ marketContextFor }, { getMarketValues, playerValueForLeague }] = await Promise.all([
        import('@/lib/core-app/playerTradeVisual'),
        import('@/lib/trade-intel/marketValueService'),
      ])
      const ctx = marketContextFor(settings, league?.leagueType ?? null, teams)
      const values = await getMarketValues(ctx)
      const shape = { variant: ctx.variant, scoringSettings: ctx.scoring.settings, get: null as null | ((sleeperId: string | null) => number), basis: null as string | null }
      if (!values) return shape
      return {
        ...shape,
        get: (sleeperId: string | null) =>
          sleeperId ? (playerValueForLeague(values, sleeperId, ctx.scoring.settings)?.adjusted ?? 0) : 0,
        basis: `${values.mode}, ${values.numQbs === 2 ? 'superflex' : '1QB'}, ${teams} teams, ${values.ppr} PPR`,
      }
    } catch {
      return none
    }
  })()

  const sleeperIdOf = (raw: string | null | undefined) => {
    const s = String(raw ?? '').trim()
    return SLEEPER_ID.test(s) ? s : null
  }
  const valueOf = (sleeperId: string | null) => (priced.get ? priced.get(sleeperId) : 0)

  const availablePlayers: WaiverPoolCandidate[] = available.map((p) => ({
    id: p.player_id,
    /*
     * ⚠ THE SAME MAPPING THE ASSISTANT USES, character for character — including the 'FLEX'
     * fallback and the uppercase. A different default here would be a second answer to "what
     * position is this player", and the two surfaces would rank the same wire differently.
     */
    name: p.full_name,
    position: (p.position ?? 'FLEX').toUpperCase(),
    team: p.team_abbreviation ?? p.team ?? null,
    age: p.age ?? null,
    value: valueOf(sleeperIdOf(p.external_source_id)),
  }))

  /* Names, positions and ages for the rostered ids, so both sides of the comparison are priced. */
  const rosteredSleeperIds = [...rosteredIds].filter((id) => SLEEPER_ID.test(id))
  const playerRows = rosteredSleeperIds.length
    ? await prisma.sportsPlayer
        .findMany({
          where: sleeperIdWhere(rosteredSleeperIds, sport),
          distinct: ['sleeperId'],
          orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
          select: { sleeperId: true, name: true, position: true, team: true, age: true },
        })
        .catch(() => [])
    : []
  const rowBySleeperId = new Map(playerRows.flatMap((r) => (r.sleeperId ? [[r.sleeperId, r] as const] : [])))

  const shapeRoster = (slots: Map<string, WaiverRosterPlayer['slot']>): WaiverRosterPlayer[] => {
    const out: WaiverRosterPlayer[] = []
    for (const [id, slot] of slots) {
      const sid = sleeperIdOf(id)
      const row = sid ? rowBySleeperId.get(sid) : undefined
      out.push({
        id,
        name: row?.name ?? `Player ${id}`,
        position: (row?.position ?? 'FLEX').toUpperCase(),
        team: row?.team ?? null,
        slot,
        age: row?.age ?? null,
        value: valueOf(sid),
      })
    }
    return out
  }

  const myRoster = rosterId ? shapeRoster(slotsByRoster.get(rosterId) ?? new Map()) : []
  const allRosters = [...slotsByRoster.values()].map((slots) => ({ players: shapeRoster(slots) }))

  const rawPositions = (settings as { roster_positions?: unknown } | null)?.roster_positions
  const rosterPositions = Array.isArray(rawPositions) ? rawPositions.map((p) => String(p).toUpperCase()) : []

  const leagueTraits = {
    numTeams: teams,
    isSF: priced.variant?.superflex ?? false,
    isTEP: Number(priced.scoringSettings.bonus_rec_te ?? 0) > 0,
    isDynasty: Boolean(priced.variant?.dynasty || priced.variant?.keeper),
  }

  return {
    availablePlayers,
    myRoster,
    leagueRosters: allRosters,
    rosterPositions,
    leagueTraits,
    currentWeek: projectionWeek?.week ?? null,
    /*
     * The pool was capped, so a fuller wire may hold a better target. This is true whenever the
     * resolver returned a full page — the honest reading of a bounded read, not a guess about
     * whether more exists.
     */
    poolIncomplete: pool.length >= POOL_LIMIT,
    leagueRosterCount: leagueRosters.length,
    pricing: {
      priced: availablePlayers.filter((p) => p.value > 0).length,
      total: availablePlayers.length,
      basis: priced.basis,
    },
  }
}
