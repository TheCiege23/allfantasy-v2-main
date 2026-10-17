import 'server-only'

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { bridgeColumnFor, isUnbridgedId } from '@/lib/core-app/bridgedRosterIds'
import {
  defaultLeagueWeekPricingDeps,
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
  type LeagueWeekPricingDeps,
  type LeagueWeekRefusalReason,
} from '@/lib/decision-os/trade/leagueWeekPricing'
import { fillLineup, DEFAULT_SLOT_ELIGIBILITY, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { afEngineForLeague, lookupAfEngineProjections, lookupProjections } from '@/lib/core-app/playerProjections'
import type { AfEngineCarryInput } from '@/lib/core-app/afEngineCarry'
import { activePlayerIds, viewerRosterOf } from './leagueRosterIndex'
import type { RosterIdsUnreadable, ScenarioWeek } from './tradeScenarioTypes'
import type { ChatStartCall } from './tools/chimmyTools'
import { checkStartedGames, type LockCheck } from './actions/gameLocks'
import { enrichLineupAvailability, lineupDesignation, unavailableForLineup, type LineupMetadata } from './lineupAvailability'

/**
 * "Set my lineup" — the whole roster, not a two-player choice.
 *
 * The start/sit scenario (`lineupScenarioGrounding.ts`) answers "A or B?". The question people
 * actually open the app with on a Sunday morning is wider: "is my lineup right?". Nothing answered
 * it with numbers — the roster tool deliberately carries no projections, so the tool loop could only
 * reason about positions and injury tags. This prices EVERY active player on the caller's roster for
 * the feed's week, under the league's own rulebook, fills the best lineup with the same greedy fill
 * the Trade Center uses, and compares it with the lineup the platform currently has set.
 *
 * ── SAME BASIS AS EVERY OTHER CHIMMY LINEUP NUMBER ─────────────────────────────────────────────
 * `leagueWeekBasis` + `priceLeagueWeek` + `fillLineup`: the vendor's weekly component line re-scored
 * by `computeLeagueProjectedPoints`. A league this cannot price is REFUSED by name (NFL only, rules
 * required), never priced generically — the standing decision from the league-view scoring audit.
 *
 * ── WHAT IT FLAGS THAT A HUMAN MISSES ──────────────────────────────────────────────────────────
 *   - a current starter with NO projection this week (bye, ruled out, or cut from the feed);
 *   - a current starter carrying an injury designation;
 *   - an empty starting slot;
 *   - every swap that raises the projected total, with the gain.
 *
 * 🛑 THE LEAGUE ID MUST BE THE MEMBERSHIP-PROVEN ONE. It is only ever `ctx.leagueId` from the tool
 * context, which the route fills from `leagueSnapshot.id` or `find_league_by_name`.
 *
 * ⚠ NOT MODELLED, AND THE BLOCK SAYS SO: provider-specific AutoSubs locks, weather, injury news
 * after the last sync, and weeks after this one.
 */

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT_IDS = new Set(['0', ''])

/** Bench players listed as alternatives. Enough to answer "who is next up", short enough to read. */
const BENCH_SHOWN = 6

/** A swap worth less than this is inside projection noise and is not called a change. */
export const MIN_SWAP_GAIN = 0.5

const STARTING_SLOT_EXCLUDED = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI'])

export type OptimizerPlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  injury: string | null
  /** This week's points under the league's rules. NULL is "not priced", never zero. */
  points: number | null
  /**
   * AllFantasy's OWN engine for the same week, carried into this league's scoring by the provider
   * line (`afEngineForLeague`). A SECOND OPINION for the model to quote — the lineup, every total and
   * the swap list are computed from `points` alone. Absent when the engine has no row for him.
   */
  af?: number | null
}

export type LineupOptimizationUnresolvedReason =
  | LeagueWeekRefusalReason
  | 'no_league_world'
  | 'no_viewer_roster'
  | RosterIdsUnreadable
  | 'unknown_slots'
  | 'no_league_projections'
  | 'locked_starter_unpriced'

export type LineupOptimization =
  | { status: 'unresolved'; reason: LineupOptimizationUnresolvedReason; detail: string }
  | {
      status: 'ready'
      week: ScenarioWeek
      /** The best lineup, in the league's declared slot order. */
      best: { points: number; slots: Array<{ slot: string; player: OptimizerPlayer }> }
      /** What the platform currently has set. `points` is null when a current starter is unpriced. */
      current: {
        starters: OptimizerPlayer[]
        points: number | null
        /** Starting slots the platform lineup leaves empty. */
        emptySlots: number
        /** False when the platform sent no lineup at all — nothing to compare against. */
        known: boolean
      }
      /** Put these in… */
      startInstead: OptimizerPlayer[]
      /** …and take these out. */
      benchInstead: OptimizerPlayer[]
      /** best − current, only when every current starter could be priced. */
      gain: number | null
      /** Current starters with no projection this week. The single most expensive thing to miss. */
      unpricedStarters: OptimizerPlayer[]
      /** Current starters carrying an injury designation. */
      injuredStarters: OptimizerPlayer[]
      /** Best bench options left over, highest first. */
      bench: OptimizerPlayer[]
      /** Active players nothing projects this week, excluded from the fill. */
      unpricedActive: number
      unfilledSlots: string[]
      lockedPlayers?: OptimizerPlayer[]
      unverifiedLocks?: OptimizerPlayer[]
      /**
       * Bench players the best lineup WOULD use if their game had not already started, and what that
       * costs. Null when no started bench player would have made it.
       */
      lockedOut?: { players: OptimizerPlayer[]; cost: number } | null
      /**
       * When the first of the recommended swaps locks: the earliest known kickoff among the players
       * moved in or out. `early` when that is before the main Sunday slate (see `isEarlyKickoff`).
       * Null with no swaps, or when no moved player's kickoff is known.
       */
      deadline?: { player: OptimizerPlayer; at: string; early: boolean } | null
    }

export interface LineupOptimizerDeps extends LeagueWeekPricingDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  loadPlayers: (
    sport: string,
    ids: string[],
  ) => Promise<Map<string, { name: string | null; position: string | null; team?: string | null; injury?: string | null }>>
  checkLocks?: (args: { sport: string; season: number; week: number; players: Array<{ playerId: string; name: string; team: string | null; gameTime: null }> }) => Promise<LockCheck>
  /**
   * AllFantasy's engine (PPR) and the provider's generic PPR total for the same week, by id — what
   * carries AF into the league's scoring. Optional: without it the block simply shows no AF.
   */
  loadAfWeek?: (args: { week: { season: string; week: number }; ids: string[] }) => Promise<{
    /* The engine row, not just its number: a defender's AF figure is IDP-scored and must not be carried by the PPR ratio. */
    engine: ReadonlyMap<string, AfEngineCarryInput>
    generic: ReadonlyMap<string, number>
  }>
}

/** Enough for any roster with IR and taxi; the name read is bounded by it. */
const MAX_ROSTER_IDS = 120

const defaultDeps: LineupOptimizerDeps = {
  ...defaultLeagueWeekPricingDeps,
  resolveWorld: resolveCanonicalWorld,
  loadPlayers: async (sport, ids) => enrichLineupAvailability(sport, await resolveNames(normalizeToSupportedSport(sport), ids, MAX_ROSTER_IDS)),
  checkLocks: checkStartedGames,
  loadAfWeek: async ({ week, ids }) => {
    const [engine, providers] = await Promise.all([
      lookupAfEngineProjections(ids, week),
      lookupProjections(ids, week),
    ])
    return {
      engine,
      generic: new Map([...providers].map(([id, p]) => [id, p.projectedPoints])),
    }
  },
}

const round2 = (n: number) => Math.round(n * 100) / 100

const unresolved = (reason: LineupOptimizationUnresolvedReason, detail: string): LineupOptimization => ({
  status: 'unresolved',
  reason,
  detail,
})

export async function buildLineupOptimization(
  args: { leagueId: string; userId: string },
  deps: LineupOptimizerDeps = defaultDeps,
): Promise<LineupOptimization> {
  const world = await deps.resolveWorld(args.leagueId).catch(() => null)
  if (!world) return unresolved('no_league_world', 'The league could not be loaded to build a lineup.')
  const roster = viewerRosterOf(world, args.userId)
  if (!roster) {
    return unresolved('no_viewer_roster', 'Your team in this league is not claimed or has no synced roster.')
  }
  /*
   * A foreign league's roster reads empty unless the port could read it through the Fleaflicker /
   * MFL identity bridge (decision-os/world/port.ts). Empty, every refusal below ("no player on your
   * roster has a projection") would be a false claim about the team.
   *
   * 🛑 BRIDGED, IT MUST STILL BE COMPLETE FOR THIS ROSTER. An unidentified player cannot be priced,
   * so a "best lineup" would quietly leave him out — and this result drives push alerts telling
   * someone to bench a player. One unidentified ACTIVE player refuses, with the count.
   */
  const provider = world.provenance?.provider
  if (isForeignIdSpace(provider)) {
    if (!bridgeColumnFor(provider) || roster.playerIds.length === 0) {
      return unresolved('roster_ids_unreadable', `${FOREIGN_IDS_UNREADABLE}, so your roster cannot be read to build a lineup.`)
    }
    const activeIds = activePlayerIds(roster)
    const unseen = activeIds.filter((id) => isUnbridgedId(id)).length
    if (unseen > 0) {
      return unresolved(
        'roster_ids_unreadable',
        `${unseen} of ${activeIds.length} active players on your roster could not be identified, so a best lineup could leave one of them out.`,
      )
    }
  }

  const slots = world.league.rosterSettings.starterSlots
  if (!slots || slots.length === 0) {
    return unresolved('unknown_slots', "This league's starting lineup slots are not on file, so no lineup can be built.")
  }

  const basis = await leagueWeekBasis(world.league, deps)
  if (isLeagueWeekRefusal(basis)) return unresolved(basis.refuse, `No lineup numbers: ${basis.detail}.`)

  const active = activePlayerIds(roster)
  const meta: Map<string, LineupMetadata> = await deps.loadPlayers(world.league.sport, roster.playerIds).catch(() => new Map())
  const positions = new Map<string, string | null>(active.map((id) => [id, meta.get(id)?.position ?? null]))
  const priced = await priceLeagueWeek(basis, active, positions, deps)
  for (const id of active) {
    const entry = priced.get(id)
    if (entry && unavailableForLineup(meta.get(id)?.injury)) priced.set(id, { ...entry, projectedPoints: 0 })
  }
  /* AllFantasy's own engine for the same week — shown beside each number, never used to fill the lineup. */
  const afWeek = deps.loadAfWeek
    ? await deps.loadAfWeek({ week: basis.week, ids: active }).catch(() => null)
    : null
  const impact: ImpactPlayer[] = active.map((id) => priced.get(id)!)
  if (impact.every((p) => p.projectedPoints == null)) {
    return unresolved(
      'no_league_projections',
      `No player on your roster has a week ${basis.week.week} projection that this league's rules can score.`,
    )
  }

  const currentIds = (roster.starterIds ?? []).filter((id) => !EMPTY_SLOT_IDS.has(String(id)))
  const currentSet = new Set(currentIds)
  const locks: LockCheck = deps.checkLocks ? await deps.checkLocks({
    sport: world.league.sport, season: Number(basis.week.season), week: basis.week.week,
    players: active.map((id) => ({ playerId: id, name: meta.get(id)?.name ?? id, team: meta.get(id)?.team ?? null, gameTime: null })),
  }).catch(() => ({ started: new Map<string, string>(), unverified: active })) : { started: new Map<string, string>(), unverified: [] }
  const startingSlots = slots.filter((slot) => !STARTING_SLOT_EXCLUDED.has(slot.toUpperCase()))
  const fixed = new Map<number, string>()
  for (const [index, id] of (roster.starterIds ?? []).entries()) {
    if (!locks.started.has(id)) continue
    const entry = priced.get(id)
    if (!entry || entry.projectedPoints == null) return unresolved('locked_starter_unpriced', 'A starter whose game has started has no projection. A complete remaining lineup comparison cannot be computed.')
    if (!DEFAULT_SLOT_ELIGIBILITY[startingSlots[index]?.toUpperCase() ?? '']?.includes(entry.position.toUpperCase())) {
      return unresolved('unknown_slots', 'The placement of an already-started player could not be verified. No swap was computed.')
    }
    fixed.set(index, id)
  }
  const remainingSlots = startingSlots.filter((_, index) => !fixed.has(index))
  const playable = (p: { playerId: string }) => !unavailableForLineup(meta.get(p.playerId)?.injury)
  const best = fillLineup(impact.filter((p) => !locks.started.has(p.playerId) && playable(p)), remainingSlots)
  /*
   * 🛑 A STARTED BENCH PLAYER WAS DROPPED IN SILENCE. Production 2026-10-11, HailShiva: Bhayshul Tuten
   * (12.7) out-projected a starter (Devaughn Vele, 9.7), but Jacksonville kicked off in London at
   * 9:30 AM ET, so the fill left him out and the only trace was a generic "known started games"
   * line. The same fill, run once more with started bench players allowed, names who the lock cost.
   */
  const fixedIds = new Set(fixed.values())
  const unlocked = fillLineup(impact.filter((p) => !fixedIds.has(p.playerId) && playable(p)), remainingSlots)
  const lockedOutIds = unlocked.starterIds.filter((id) => locks.started.has(id) && !currentSet.has(id))
  const lockedOutCost = round2(unlocked.points - best.points)
  let remainingIndex = 0
  const remainingAssignments = best.assignments.slice()
  best.assignments = startingSlots.flatMap((slot, index) => {
    const fixedId = fixed.get(index)
    if (fixedId) return [{ slot: slot.toUpperCase(), playerId: fixedId }]
    const nextSlot = remainingSlots[remainingIndex++]
    const next = remainingAssignments[0]
    if (next && next.slot === nextSlot?.toUpperCase()) return [remainingAssignments.shift()!]
    return []
  })
  best.starterIds.push(...fixed.values())
  best.points += [...fixed.values()].reduce((total, id) => total + (priced.get(id)?.projectedPoints ?? 0), 0)
  if (best.unknownSlots.length > 0) {
    return unresolved('unknown_slots', `The lineup has slots this model cannot fill: ${best.unknownSlots.join(', ')}.`)
  }

  const player = (id: string): OptimizerPlayer => {
    const m = meta.get(id)
    const p = priced.get(id)
    return {
      playerId: id,
      name: m?.name ?? `(unnamed player ${id})`,
      position: m?.position ?? (p?.position || null),
      team: m?.team ?? null,
      injury: lineupDesignation(m?.injury),
      points: p?.projectedPoints ?? null,
      ...afFor(id, p?.projectedPoints ?? null),
    }
  }
  function afFor(id: string, leaguePoints: number | null): { af?: number } {
    if (!afWeek) return {}
    // Ruled out: the provider number is already a certain 0, and AF says the same.
    if (unavailableForLineup(meta.get(id)?.injury) && afWeek.engine.has(id)) return { af: 0 }
    const af = afEngineForLeague(afWeek.engine.get(id), afWeek.generic.get(id) ?? null, leaguePoints)
    return af == null ? {} : { af }
  }

  const bestIds = new Set(best.starterIds)
  const known = currentIds.length > 0
  const currentStarters = currentIds.map(player)
  const startingSlotCount = slots.filter((s) => !STARTING_SLOT_EXCLUDED.has(s.toUpperCase())).length
  const unpricedStarters = currentStarters.filter((p) => p.points == null)
  const currentPoints =
    known && unpricedStarters.length === 0
      ? round2(currentStarters.reduce((sum, p) => sum + (p.points as number), 0))
      : null
  const bestPoints = round2(best.points)
  const gain = currentPoints == null ? null : round2(bestPoints - currentPoints)

  const byPoints = (a: OptimizerPlayer, b: OptimizerPlayer) => (b.points ?? -Infinity) - (a.points ?? -Infinity)

  const startInstead = known ? best.starterIds.filter((id) => !currentSet.has(id)).map(player).sort(byPoints) : []
  const benchInstead = known ? currentIds.filter((id) => !bestIds.has(id)).map(player).sort(byPoints) : []
  /*
   * ⚠ A SWAP IS ONLY AS GOOD AS THE FIRST KICKOFF IT TOUCHES. Production 2026-10-11: Jacksonville
   * played in London at 9:30 AM ET, three and a half hours before the slate everyone sets a lineup
   * for. Moving a player in or out of a game that has started is refused, so the earliest kickoff
   * among the moved players is the deadline for the whole set of changes.
   */
  const moved = [...startInstead, ...benchInstead]
    .map((p) => ({ p, t: locks.kickoffs?.get(p.playerId)?.getTime() }))
    .filter((x): x is { p: OptimizerPlayer; t: number } => x.t != null && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)
  const first = moved[0]
  const deadline = first ? { player: first.p, at: new Date(first.t).toISOString(), early: isEarlyKickoff(new Date(first.t)) } : null

  return {
    status: 'ready',
    week: basis.week,
    best: {
      points: bestPoints,
      slots: best.assignments.map(({ slot, playerId }) => ({ slot, player: player(playerId) })),
    },
    current: {
      starters: currentStarters,
      points: currentPoints,
      emptySlots: known ? Math.max(0, startingSlotCount - currentIds.length) : 0,
      known,
    },
    /*
     * ⚠ ONLY WHEN THE PLATFORM SENT A LINEUP. With none there is nothing to swap against, and
     * listing the whole best lineup as "start these" would read as nine changes nobody needs.
     */
    startInstead,
    benchInstead,
    gain,
    unpricedStarters,
    injuredStarters: currentStarters.filter((p) => p.injury && p.injury.trim()),
    bench: active
      .filter((id) => !bestIds.has(id))
      .map(player)
      .filter((p) => p.points != null)
      .filter((p) => !locks.started.has(p.playerId) && !unavailableForLineup(p.injury))
      .sort(byPoints)
      .slice(0, BENCH_SHOWN),
    unpricedActive: impact.filter((p) => p.projectedPoints == null).length,
    unfilledSlots: best.unfilledSlots,
    lockedPlayers: active.filter((id) => locks.started.has(id)).map(player),
    unverifiedLocks: locks.unverified.map(player),
    lockedOut: lockedOutIds.length > 0 && lockedOutCost > 0 ? { players: lockedOutIds.map(player).sort(byPoints), cost: lockedOutCost } : null,
    deadline,
  }
}

/* ── Kickoff deadline ─────────────────────────────────────────────────────────────────────────── */

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
})
const ET_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

/** "Sun 9:30 AM ET" — the clock people set a lineup by. */
export function kickoffLabel(at: Date): string {
  // ICU puts a narrow no-break space before AM/PM on some Node builds; plain spaces read the same everywhere.
  return `${ET_LABEL.format(at).replace(/[\s,]+/g, ' ')} ET`
}

/**
 * Before the main Sunday slate (1:00 PM ET), in an NFL week that runs Tuesday → Monday: a Thursday or
 * Saturday game, a Sunday morning London / Germany game. Those are the ones a lineup set "on Sunday"
 * misses. A late Sunday or Monday kickoff is after it, and needs no extra warning.
 */
export function isEarlyKickoff(at: Date): boolean {
  const parts = Object.fromEntries(ET_PARTS.formatToParts(at).map((x) => [x.type, x.value]))
  const day = parts.weekday
  if (day === 'Mon') return false
  if (day !== 'Sun') return true
  return Number(parts.hour) * 60 + Number(parts.minute) < 13 * 60
}

/* ── Prompt block ─────────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toFixed(1)
const who = (p: OptimizerPlayer) => {
  const bits = [p.position, p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}
const pts = (p: OptimizerPlayer, week: number) => {
  const af = p.af != null ? fmt(p.af) : null
  if (p.points == null) return af != null ? `no week ${week} projection (AF ${af}, not used in the maths)` : `no week ${week} projection`
  return af != null ? `${fmt(p.points)} pts · AF ${af}` : `${fmt(p.points)} pts`
}

export function isOutDesignation(status: string | null | undefined): boolean {
  return unavailableForLineup(status)
}

/** Deterministic, so the model repeats the numbers instead of estimating its own. */
export function renderLineupOptimizationBlock(result: LineupOptimization): string {
  if (result.status === 'unresolved') {
    return [
      'LINEUP OPTIMIZER: NOT COMPUTED.',
      result.detail,
      'Do not present projected points or a "best lineup". Say plainly that it was not computed and why.',
    ].join('\n')
  }
  const r = result
  const wk = r.week.week
  const lines: Array<string | null> = [
    `LINEUP OPTIMIZER (week ${wk}, this league's real roster, projections scored under THIS league's own rules — repeat these numbers, never estimate your own):`,
    /*
     * Said once, up front, whenever any AF figure appears: which number the maths used, and that AF
     * is a second opinion — so the model can quote both without re-ranking the lineup by AF.
     */
    [...r.best.slots.map((s) => s.player), ...r.bench, ...r.startInstead, ...r.benchInstead, ...r.current.starters].some((p) => p.af != null)
      ? `- Each player shows the provider (Sleeper) projection first, then "AF": AllFantasy's own projection engine for the same week under the same rules. The best lineup, every total and every swap are computed from the FIRST number only. Quote AF as a second opinion — worth mentioning when it disagrees — but never re-rank the lineup or change a recommendation by it.`
      : null,
    `- Best lineup projects ${fmt(r.best.points)} pts:`,
    ...r.best.slots.map(({ slot, player }) => `  ${slot}: ${who(player)} — ${pts(player, wk)}${player.injury ? ` [${player.injury}]` : ''}`),
  ]

  if (!r.current.known) {
    lines.push('- The platform sent no current lineup, so no swap list could be compared. Present the best lineup above.')
  } else {
    if (r.current.points != null) {
      lines.push(`- Your lineup as currently set projects ${fmt(r.current.points)} pts.`)
    } else {
      lines.push('- Your current lineup total was not computed because at least one current starter has no projection (see below).')
    }
    if (r.startInstead.length === 0 && r.benchInstead.length === 0) {
      lines.push('- Your current lineup already IS the best lineup. Say so — no changes needed.')
    } else {
      lines.push(
        `- Changes: START ${r.startInstead.map((p) => `${who(p)} (${pts(p, wk)})`).join(', ') || 'nobody new'}; ` +
          `BENCH ${r.benchInstead.map((p) => `${who(p)} (${pts(p, wk)})`).join(', ') || 'nobody'}.`,
      )
      if (r.gain != null) {
        lines.push(
          r.gain >= MIN_SWAP_GAIN
            ? `- Making those changes gains ${fmt(r.gain)} projected pts.`
            : `- The difference is only ${fmt(r.gain)} pts — within projection noise; call it a coin flip and say so.`,
        )
      }
    }
    if (r.current.emptySlots > 0) {
      lines.push(`- 🚨 ${r.current.emptySlots} starting slot(s) are EMPTY in the platform lineup. Lead with this.`)
    }
  }

  for (const p of r.unpricedStarters) {
    lines.push(
      `- 🚨 ${who(p)} is in your starting lineup with NO week ${wk} projection — most often a bye week, a player ruled out, or one released. Tell them to check him first.`,
    )
  }
  for (const p of r.injuredStarters) {
    lines.push(
      `- ⚠ ${who(p)} starts for you with injury designation "${p.injury}"${isOutDesignation(p.injury) ? ' — that designation means he is not expected to play' : ''}.`,
    )
  }
  if (r.bench.length > 0) {
    lines.push(`- Best bench options: ${r.bench.map((p) => `${who(p)} ${pts(p, wk)}`).join('; ')}.`)
  }
  if (r.unfilledSlots.length > 0) {
    lines.push(`- The best lineup leaves ${r.unfilledSlots.join(', ')} unfilled: nobody eligible has a projection. Suggest a waiver pickup for it.`)
  }
  if (r.unpricedActive > 0) {
    lines.push(`- ${r.unpricedActive} active player(s) have no week ${wk} projection and were left out of the maths.`)
  }
  if (r.lockedOut) {
    lines.push(
      `- 🔒 ALREADY LOCKED: ${r.lockedOut.players.map((p) => `${who(p)} (${pts(p, wk)})`).join(', ')} would be in the best lineup, but ` +
        `${r.lockedOut.players.length === 1 ? 'his game has' : 'their games have'} already started, so ${r.lockedOut.players.length === 1 ? 'he' : 'they'} can no longer be moved in ` +
        `(${fmt(r.lockedOut.cost)} projected pts the lock costs). Say this plainly, and never recommend starting ${r.lockedOut.players.length === 1 ? 'him' : 'them'}.`,
    )
  }
  if (r.deadline && (r.startInstead.length > 0 || r.benchInstead.length > 0)) {
    const when = kickoffLabel(new Date(r.deadline.at))
    lines.push(
      r.deadline.early
        ? `- ⏰ EARLY KICKOFF: set these changes before ${when} — ${r.deadline.player.name}'s game, the first of them to start. ` +
            'That is before the main Sunday slate and easy to miss: lead with the time, and say that once his game starts the swap can no longer be made.'
        : `- ⏰ The first of these changes locks at ${when}, when ${r.deadline.player.name}'s game starts. Mention the time.`,
    )
  }
  if (r.lockedPlayers?.length) lines.push(`- Known started games: ${r.lockedPlayers.map(who).join(', ')}. Current starters were kept in place and started bench players were excluded.`)
  if (r.unverifiedLocks?.length) lines.push(`- Kickoff locks could not be verified for ${r.unverifiedLocks.map(who).join(', ')}. Confirm them on the provider before acting.`)
  lines.push(
    '- Confirm individual provider locks and AutoSubs. Weather and injury news after the last sync are not modelled.',
  )
  return lines.filter(Boolean).join('\n')
}

/** The tool entry point: prose for the model, never a throw. */
/**
 * The one "start X over Y" an optimization amounts to — or null.
 *
 * ⚠ ONLY AN UNAMBIGUOUS SWAP IS A CALL. The optimizer returns who to start and who to bench as two
 * lists; with two changes on each side, which starter replaces which is not something it decided,
 * and pairing them by position in the list would grade a call nobody made. So: exactly one in,
 * exactly one out, both priced, and a gain past MIN_SWAP_GAIN — below that the block itself tells
 * the model to call it a coin flip, which is not advice to grade.
 */
export function singleSwapCall(result: LineupOptimization, leagueId: string): ChatStartCall | null {
  if (result.status !== 'ready' || !result.current.known) return null
  if (result.startInstead.length !== 1 || result.benchInstead.length !== 1) return null
  if (result.gain == null || result.gain < MIN_SWAP_GAIN) return null
  const rec = result.startInstead[0]!
  const alt = result.benchInstead[0]!
  if (rec.points == null || alt.points == null || rec.playerId === alt.playerId) return null
  const season = Number(result.week.season)
  if (!Number.isInteger(season)) return null
  return {
    leagueId,
    season,
    week: result.week.week,
    rec: { key: rec.playerId, name: rec.name },
    alt: { key: alt.playerId, name: alt.name },
    slot: result.best.slots.find((s) => s.player.playerId === rec.playerId)?.slot ?? null,
  }
}

export async function buildLineupOptimizerContext(
  args: {
    leagueId: string
    userId: string
    /** Told the call when the optimization amounts to one swap — see ChimmyToolContext.startCalls. */
    onStartCall?: (call: ChatStartCall) => void
  },
  deps?: LineupOptimizerDeps,
): Promise<string> {
  try {
    const result = await buildLineupOptimization({ leagueId: args.leagueId, userId: args.userId }, deps)
    /*
     * OUTSIDE THE NFL (2026-09-25): this optimizer still refuses a league it cannot price under the
     * league's own rules — `buildLineupOptimization` is unchanged. The tool then offers the sports
     * that DO have AllFantasy's per-game projection a separately labelled baseline lineup
     * (lineupOptimizerOtherSports.ts), whose block names that basis on every line that matters.
     * Soccer and anything else without a projection base keep the refusal below.
     */
    if (result.status === 'unresolved' && result.reason === 'sport_not_supported') {
      const { buildBaselineLineupContext } = await import('./lineupOptimizerOtherSports')
      return await buildBaselineLineupContext({ leagueId: args.leagueId, userId: args.userId })
    }
    if (args.onStartCall) {
      const call = singleSwapCall(result, args.leagueId)
      if (call) args.onStartCall(call)
    }
    return renderLineupOptimizationBlock(result)
  } catch {
    return 'The lineup optimizer failed to run. Say that you could not compute a lineup rather than answering as though you had.'
  }
}
