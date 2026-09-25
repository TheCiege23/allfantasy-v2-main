import 'server-only'

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import {
  defaultLeagueWeekPricingDeps,
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
  type LeagueWeekPricingDeps,
  type LeagueWeekRefusalReason,
} from '@/lib/decision-os/trade/leagueWeekPricing'
import { fillLineup, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { activePlayerIds, viewerRosterOf } from './leagueRosterIndex'
import type { ScenarioWeek } from './tradeScenarioTypes'
import type { ChatStartCall } from './tools/chimmyTools'

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
 * ⚠ NOT MODELLED, AND THE BLOCK SAYS SO: whether a game has already locked, weather, injury news
 * after the last sync, and weeks after this one.
 */

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT_IDS = new Set(['0', ''])

/** Bench players listed as alternatives. Enough to answer "who is next up", short enough to read. */
const BENCH_SHOWN = 6

/** A swap worth less than this is inside projection noise and is not called a change. */
export const MIN_SWAP_GAIN = 0.5

const STARTING_SLOT_EXCLUDED = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI'])

/** Designations that mean "will not play" rather than "might not". */
const OUT_STATUSES = /^(out|o|ir|injured reserve|pup|suspended|sus|nfi|dnr|cov|covid)$/i

export type OptimizerPlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  injury: string | null
  /** This week's points under the league's rules. NULL is "not priced", never zero. */
  points: number | null
}

export type LineupOptimizationUnresolvedReason =
  | LeagueWeekRefusalReason
  | 'no_league_world'
  | 'no_viewer_roster'
  | 'unknown_slots'
  | 'no_league_projections'

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
    }

export interface LineupOptimizerDeps extends LeagueWeekPricingDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  loadPlayers: (
    sport: string,
    ids: string[],
  ) => Promise<Map<string, { name: string | null; position: string | null; team?: string | null; injury?: string | null }>>
}

/** Enough for any roster with IR and taxi; the name read is bounded by it. */
const MAX_ROSTER_IDS = 120

const defaultDeps: LineupOptimizerDeps = {
  ...defaultLeagueWeekPricingDeps,
  resolveWorld: resolveCanonicalWorld,
  loadPlayers: (sport, ids) => resolveNames(normalizeToSupportedSport(sport), ids, MAX_ROSTER_IDS),
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

  const slots = world.league.rosterSettings.starterSlots
  if (!slots || slots.length === 0) {
    return unresolved('unknown_slots', "This league's starting lineup slots are not on file, so no lineup can be built.")
  }

  const basis = await leagueWeekBasis(world.league, deps)
  if (isLeagueWeekRefusal(basis)) return unresolved(basis.refuse, `No lineup numbers: ${basis.detail}.`)

  const active = activePlayerIds(roster)
  const meta = await deps.loadPlayers(world.league.sport, roster.playerIds).catch(() => new Map())
  const positions = new Map<string, string | null>(active.map((id) => [id, meta.get(id)?.position ?? null]))
  const priced = await priceLeagueWeek(basis, active, positions, deps)
  const impact: ImpactPlayer[] = active.map((id) => priced.get(id)!)
  if (impact.every((p) => p.projectedPoints == null)) {
    return unresolved(
      'no_league_projections',
      `No player on your roster has a week ${basis.week.week} projection that this league's rules can score.`,
    )
  }

  const best = fillLineup(impact, slots)
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
      injury: m?.injury ?? null,
      points: p?.projectedPoints ?? null,
    }
  }

  const bestIds = new Set(best.starterIds)
  const currentIds = (roster.starterIds ?? []).filter((id) => !EMPTY_SLOT_IDS.has(String(id)))
  const currentSet = new Set(currentIds)
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
    startInstead: known ? best.starterIds.filter((id) => !currentSet.has(id)).map(player).sort(byPoints) : [],
    benchInstead: known ? currentIds.filter((id) => !bestIds.has(id)).map(player).sort(byPoints) : [],
    gain,
    unpricedStarters,
    injuredStarters: currentStarters.filter((p) => p.injury && p.injury.trim()),
    bench: active
      .filter((id) => !bestIds.has(id))
      .map(player)
      .filter((p) => p.points != null)
      .sort(byPoints)
      .slice(0, BENCH_SHOWN),
    unpricedActive: impact.filter((p) => p.projectedPoints == null).length,
    unfilledSlots: best.unfilledSlots,
  }
}

/* ── Prompt block ─────────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toFixed(1)
const who = (p: OptimizerPlayer) => {
  const bits = [p.position, p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}
const pts = (p: OptimizerPlayer, week: number) =>
  p.points == null ? `no week ${week} projection` : `${fmt(p.points)} pts`

export function isOutDesignation(status: string | null | undefined): boolean {
  return Boolean(status && OUT_STATUSES.test(status.trim()))
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
  lines.push(
    '- Not modelled: whether a game has already kicked off (locked players cannot move), weather, and injury news after the last sync. Mention it when it matters.',
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
