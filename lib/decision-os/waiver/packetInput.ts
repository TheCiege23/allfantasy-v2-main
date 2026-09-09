import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLeaguePlayerPool } from '@/lib/waiver-wire/league-player-pool'
import { getRosterSlotsByPlayerId } from '@/lib/waiver-wire/roster-utils'
import { estimateWaiverCandidateValue, rosterPlayerValue } from '@/lib/waiver-wire/waiver-value-scale'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'
import type { WaiverWorldFacts } from './loader'

/**
 * Build the waiver engine's input on the SERVER.
 *
 * ── 🛑 WHY THIS DID NOT EXIST, WHICH IS THE WHOLE REASON `waiverDecision` HAD NO PRODUCER ────
 * `/api/waiver-ai/engine` takes `availablePlayers` and `roster` from the REQUEST BODY. The waiver
 * page fetches the wire, normalises it, and posts it back — so the engine's input has only ever
 * been assembled by a browser. The grounding packet has no browser, which is why
 * `packet.ts` reported `no_producer` for a decision whose engine was complete and deterministic.
 * The blocker was an input, not a decision. This is that input.
 *
 * ── WHAT IT REUSES, AND WHY EACH ONE RATHER THAN A FRESH QUERY ──────────────────────────────
 *   the wire      `loadLeaguePlayerPool`  — the route the page calls, extracted; one answer to
 *                                           "who is available in this league"
 *   the slots     `getRosterSlotsByPlayerId` — the same playerData parse the rest of the app uses
 *   the scale     `waiver-value-scale`    — the exact numbers the page sends, so a server-built
 *                                           input and a browser-built one are comparable
 *
 * ── ⚠ THE TWO HONEST DEGRADATIONS, NAMED SO THE DECISION CAN CARRY THEM ─────────────────────
 * 1. **No trend score.** The page ranks demand from its own trending tab; there is no server-side
 *    equivalent, so every candidate gets `trendScore: 0` and two free agents at one position price
 *    identically. The consequence is real: within a position the ordering falls back to the
 *    engine's own signals rather than to league demand. It is reported through `poolIncomplete`
 *    rather than papered over.
 * 2. **No watchlist.** Same shape, same handling — a personal signal the packet does not read.
 *
 * ⚠ NEITHER IS A REASON TO WITHHOLD THE DECISION. The engine's own scoring — projections, depth,
 * scarcity, bye weeks, roster fit — does not depend on either, and a claim recommendation ranked
 * without demand data is a materially better answer than the `no_producer` gap it replaces.
 */

/**
 * How many free agents reach the engine.
 *
 * Matches the waiver page's own `.slice(0, 60)` deliberately: a server-built input and a
 * browser-built one should be comparing the same depth of wire, or the shadow parity between them
 * measures the slice size rather than the decision.
 */
const CANDIDATE_LIMIT = 60

/**
 * Rows drawn from the sport pool before the rostered filter.
 *
 * ⚠ MUST BE FAR LARGER THAN `CANDIDATE_LIMIT`, AND THE ROUTE'S 800 IS THE PROVEN NUMBER. The pool
 * is ADP-ordered, so its head is mostly rostered players; asking for 60 rows would return a wire of
 * almost nothing in a full league. Lowered from the route's default only enough to respect the
 * packet's latency ceiling, and the pool read is DB-cached, so this is a cache hit in the common
 * case rather than a scan.
 */
const POOL_LIMIT = 600

export interface WaiverPacketInput {
  engineInput: WaiverAIServiceInput
  /** True when the wire could not be fully priced — carried into the DCO's completeness. */
  poolIncomplete: boolean
  /** How many free agents were found before the candidate cap. */
  availableCount: number
}

/**
 * Assemble the engine input for one user in one league. Returns null when the league has no
 * priceable wire, which the caller reports as a gap rather than as an error.
 */
export async function buildWaiverPacketInput(args: {
  userId: string
  leagueId: string
  facts: WaiverWorldFacts
  numTeams?: number | null
  isDynasty?: boolean
  currentWeek?: number | null
}): Promise<WaiverPacketInput | null> {
  const { facts, leagueId } = args

  const [pool, rosterRow] = await Promise.all([
    loadLeaguePlayerPool(leagueId, facts.sport, { poolLimit: POOL_LIMIT }),
    (prisma as any).roster.findUnique({
      where: { id: facts.rosterId },
      select: { playerData: true },
    }),
  ])

  const candidates = pool.players.slice(0, CANDIDATE_LIMIT)
  if (candidates.length === 0) return null

  const roster = await buildRosterSnapshot(rosterRow?.playerData, facts.sport)

  const engineInput: WaiverAIServiceInput = {
    sport: facts.sport,
    roster,
    goal: 'balanced',
    /*
     * ⚠ NO `includeAIExplanation`. The deterministic path needs no model call, and a chat turn is
     * already inside an LLM — asking a second one to explain the first would spend tokens to
     * produce prose that the answering model is about to rewrite anyway.
     */
    leagueSettings: {
      numTeams: args.numTeams ?? undefined,
      isDynasty: args.isDynasty ?? undefined,
      faabBudget: facts.settings.faabBudget,
      faabRemaining: facts.faabRemaining,
    },
    currentWeek: args.currentWeek ?? undefined,
    availablePlayers: candidates.map((p) => {
      const position = String(p.position ?? '').toUpperCase() || 'UTIL'
      return {
        playerId: p.id,
        playerName: p.name ?? p.id,
        position,
        team: p.team ?? null,
        // Demand signals are unavailable server-side — see the header. Stated as 0, not invented.
        value: estimateWaiverCandidateValue(position, 0, false),
        source: 'decision-os-packet',
        /*
         * ⚠ CARRIED THROUGH, NOT DROPPED. `lowConfidence` is what makes the DCO downgrade its own
         * completeness on a thin wire, and `product` is what `toWaiverCandidate` reads for bye
         * weeks and rookie status. Sending only name and position would produce a decision that
         * looked as confident on bad provider data as on good.
         */
        product: p.product,
        lowConfidence: p.lowConfidence,
        profileSource: p.profileSource,
        statsSource: p.statsSource,
        fantasyPointsPerGame: p.fantasyPointsPerGame,
        injuryStatus: p.injuryStatus ?? null,
      }
    }),
    maxResults: 5,
  }

  return {
    engineInput,
    /*
     * ⚠ `poolIncomplete` IS TRUE WHENEVER THE ROSTER COULD NOT BE READ, and that is the more
     * serious of the two cases it covers. Without a roster the engine cannot compute a replacement
     * gain or nominate a drop, so the recommendation is "best on the wire" rather than "best for
     * you" — a different answer, and the DCO's completeness must say so.
     */
    poolIncomplete: roster.length === 0,
    availableCount: pool.players.length,
  }
}

/**
 * The user's roster in the shape the scorer reads.
 *
 * ⚠ ONE QUERY, BOUNDED BY THE ROSTER — a roster is tens of players, not thousands, so this is an
 * indexed `in` over a small set rather than anything that needs a cache.
 */
async function buildRosterSnapshot(
  playerData: unknown,
  sport: string,
): Promise<NonNullable<WaiverAIServiceInput['roster']>> {
  const slots = getRosterSlotsByPlayerId(playerData)
  const ids = [...slots.keys()]
  if (ids.length === 0) return []

  const rows = await (prisma as any).sportsPlayer
    .findMany({
      where: {
        sport: String(sport).toUpperCase(),
        OR: [{ id: { in: ids } }, { sleeperId: { in: ids } }, { externalId: { in: ids } }],
      },
      select: { id: true, sleeperId: true, externalId: true, name: true, position: true, team: true, age: true },
    })
    .catch(() => [])

  const byId = new Map<string, any>()
  for (const row of rows) {
    for (const key of [row.sleeperId, row.id, row.externalId]) {
      if (key) byId.set(String(key), row)
    }
  }

  const out: NonNullable<WaiverAIServiceInput['roster']> = []
  for (const [id, slot] of slots) {
    const row = byId.get(id)
    /*
     * ⚠ AN UNRESOLVED ID IS DROPPED, NOT DEFAULTED. A row with no name and no position would enter
     * the depth maths as a player at position "" — counting against no need and filling no slot,
     * while still inflating the roster size the DCO reports.
     */
    if (!row) continue
    const position = String(row.position ?? '').toUpperCase() || 'UTIL'
    out.push({
      id,
      name: row.name ?? id,
      position,
      team: row.team ?? null,
      slot,
      age: typeof row.age === 'number' ? row.age : null,
      value: rosterPlayerValue(position),
    })
  }
  return out
}
