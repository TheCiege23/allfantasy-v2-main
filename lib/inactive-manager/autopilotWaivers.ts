/**
 * CHIMMY AUTOPILOT — WAIVERS. Which free agents a team on autopilot claims, and whom it drops.
 *
 * Autopilot only fills holes. It claims a player when a starting slot cannot be filled by anyone on
 * the roster who is healthy enough to play, and nothing else: it does not churn a roster chasing a
 * slightly better bench. That is what keeps an unattended team competitive without turning it into
 * the league's most active manager.
 *
 * Style (owner decision 2026-10-26, docs/AF_COMMISSIONER_SETTINGS_SPEC.md §5):
 *   dynasty_owner  the default. Fill the hole with the best projected player, a young one breaking
 *                  a near-tie, and never drop a young player (≤ 2 seasons) to make room.
 *   win_now        best projected player; any bench player may go.
 *   rebuild        prefer young players outright, and never drop one (≤ 3 seasons).
 * In every style a drop must project lower than the player coming in, and a starter is never dropped.
 *
 * Pure. Claims go through the waiver wire's own `createClaim`, which applies every league rule.
 */
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { playerEligibleForSlot } from '@/lib/league/lineup-swap'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import type { AutopilotStyle } from './inactiveManagerMode'

export type AutopilotPlayer = {
  id: string
  position: string | null
  projectedPoints: number | null
  injuryStatus?: string | null
  /** Seasons of experience; null is unknown and never counts as young. */
  yearsExp?: number | null
}

export type AutopilotClaim = { slot: string; addPlayerId: string; dropPlayerId: string | null }

export type AutopilotWaiverPlan = { claims: AutopilotClaim[]; unfilled: string[] }

/** At most this many claims per team per run, so a broken projection feed cannot empty a roster. */
export const MAX_AUTOPILOT_CLAIMS_PER_RUN = 2

const PROTECT_YOUNG: Record<AutopilotStyle, number | null> = { dynasty_owner: 2, win_now: null, rebuild: 3 }
/** dynasty_owner: a young player wins a near-tie (within this share of the best projection). */
const DYNASTY_YOUTH_TIE = 0.1

const proj = (p: AutopilotPlayer | undefined) => (p?.projectedPoints != null && Number.isFinite(p.projectedPoints) ? p.projectedPoints : 0)
const isYoung = (p: AutopilotPlayer | undefined, max: number) => p?.yearsExp != null && p.yearsExp <= max
const playable = (p: AutopilotPlayer | undefined) => Boolean(p) && !isRuledOut(p!.injuryStatus)

/**
 * Slots the roster cannot fill with a playable player. Most-restrictive slots are filled first, each
 * with its highest projected eligible player, so a flex never takes the only player a fixed slot could use.
 */
export function unfillableSlots(slots: ExpandedStarterSlot[], rosterIds: string[], players: Record<string, AutopilotPlayer | undefined>): ExpandedStarterSlot[] {
  const pool = rosterIds.filter((id) => playable(players[id]))
  const used = new Set<string>()
  const order = [...slots].sort((a, b) => (a.allowedPositions?.length ?? 99) - (b.allowedPositions?.length ?? 99))
  const holes: ExpandedStarterSlot[] = []
  for (const slot of order) {
    const best = pool
      .filter((id) => !used.has(id) && playerEligibleForSlot(slot, players[id]?.position))
      .sort((a, b) => proj(players[b]) - proj(players[a]))[0]
    if (best) used.add(best)
    else holes.push(slot)
  }
  return holes.sort((a, b) => a.index - b.index)
}

function pickAdd(style: AutopilotStyle, candidates: AutopilotPlayer[]): AutopilotPlayer | null {
  if (candidates.length === 0) return null
  const byProj = [...candidates].sort((a, b) => proj(b) - proj(a))
  if (style === 'win_now') return byProj[0]!
  if (style === 'rebuild') return byProj.find((p) => isYoung(p, 3)) ?? byProj[0]!
  const top = proj(byProj[0])
  return byProj.find((p) => isYoung(p, 2) && proj(p) >= top * (1 - DYNASTY_YOUTH_TIE)) ?? byProj[0]!
}

export function planAutopilotWaivers(args: {
  style: AutopilotStyle
  slots: ExpandedStarterSlot[]
  starters: string[]
  bench: string[]
  players: Record<string, AutopilotPlayer | undefined>
  freeAgents: AutopilotPlayer[]
  /**
   * Bench spots; when the bench is full, each claim needs a drop. Null (unknown): claim without a drop,
   * and let `createClaim`'s roster-size check refuse it, rather than cut a player who did not need to go.
   */
  benchCapacity: number | null
  /** Players this team already has a pending claim on. */
  pendingAddIds?: readonly string[]
  maxClaims?: number
}): AutopilotWaiverPlan {
  const { style, slots, players } = args
  const starters = args.starters.filter(Boolean)
  const bench = args.bench.filter(Boolean)
  const holes = unfillableSlots(slots, [...starters, ...bench], players)
  const taken = new Set(args.pendingAddIds ?? [])
  const dropped = new Set<string>()
  const protectAge = PROTECT_YOUNG[style]
  let benchCount = bench.length
  const claims: AutopilotClaim[] = []
  const unfilled: string[] = []

  for (const slot of holes) {
    if (claims.length >= (args.maxClaims ?? MAX_AUTOPILOT_CLAIMS_PER_RUN)) {
      unfilled.push(slot.label)
      continue
    }
    const add = pickAdd(
      style,
      args.freeAgents.filter((p) => !taken.has(p.id) && playable(p) && proj(p) > 0 && playerEligibleForSlot(slot, p.position)),
    )
    if (!add) {
      unfilled.push(slot.label)
      continue
    }
    let dropPlayerId: string | null = null
    if (args.benchCapacity != null && benchCount >= args.benchCapacity) {
      const drop = bench
        .filter((id) => !dropped.has(id))
        .filter((id) => !(protectAge != null && isYoung(players[id], protectAge)))
        .filter((id) => proj(players[id]) < proj(add))
        .sort((a, b) => proj(players[a]) - proj(players[b]))[0]
      if (!drop) {
        unfilled.push(slot.label)
        continue
      }
      dropPlayerId = drop
      dropped.add(drop)
    } else {
      benchCount += 1
    }
    taken.add(add.id)
    claims.push({ slot: slot.label, addPlayerId: add.id, dropPlayerId })
  }
  return { claims, unfilled }
}

/**
 * Share of the league's FAAB budget Chimmy bids per claim, by style. Every autopilot claim fills a
 * starting slot nobody healthy can fill, so it is worth a real bid — but a team with no manager should
 * not outbid managers who are paying attention: these are deliberately modest.
 */
export const AUTOPILOT_FAAB_SHARE: Record<AutopilotStyle, number> = { win_now: 0.08, dynasty_owner: 0.04, rebuild: 0.02 }

/**
 * 🛑 A NULL BID IS A $0 BID, AND MANY FAAB LEAGUES REFUSE ONE. Autopilot claims went in with
 * `faabBid: null`; the waiver run reads that as 0 and fails it wherever the league disallows $0 bids
 * or sets a minimum — so in those leagues Chimmy's claims never landed (found 2026-10-27).
 *
 * The bid for one claim: the style's share of the budget, never below the league's minimum (or $1
 * where $0 is refused), never above what the team has left. Null outside a FAAB league; `unaffordable`
 * when the team cannot meet the minimum — the claim would only fail, so it is not made.
 */
export function autopilotFaabBid(args: {
  style: AutopilotStyle
  faab: boolean
  budget: number | null
  remaining: number | null
  minBid: number | null
  allowZero: boolean
  /** An upgrade pickup is optional, so it only ever bids the least the league allows. */
  minimumOnly?: boolean
}): number | null | 'unaffordable' {
  if (!args.faab) return null
  const remaining = Math.max(0, Math.floor(args.remaining ?? 0))
  const floor = Math.max(Math.ceil(args.minBid ?? 0), args.allowZero ? 0 : 1)
  if (remaining < floor) return 'unaffordable'
  if (args.minimumOnly) return floor
  const budget = args.budget != null && args.budget > 0 ? args.budget : remaining
  return Math.min(remaining, Math.max(floor, Math.round(budget * AUTOPILOT_FAAB_SHARE[args.style])))
}

/**
 * UPGRADE PICKUPS (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 5). A team with no hole to
 * fill may still make ONE optional claim a week: a free agent who is clearly better than a bench player
 * at the same position, swapped for him. An active manager does this; an unattended roster otherwise
 * never improves.
 *
 * Kept deliberately small, because nothing forces the move:
 *   - same position in, same position out, so the bench keeps its shape and no depth is lost;
 *   - the free agent must beat the player he replaces by the manager's margin (a busier manager acts on
 *     a smaller edge) AND by `UPGRADE_MIN_POINTS`, so noise in two low projections is not an upgrade;
 *   - a starter is never dropped, and neither is a young player the style protects;
 *   - among everything that qualifies, the biggest gain wins.
 * The hourly run allows one a week per team and bids the league minimum for it.
 */
export const UPGRADE_SLOT = 'Upgrade'
export const UPGRADE_MIN_POINTS = 2
/** How much better the free agent must project than the bench player he replaces, by manager activity. */
export const UPGRADE_MARGIN: Record<'quiet' | 'normal' | 'busy', number> = { quiet: 0.4, normal: 0.25, busy: 0.15 }

export function planUpgradePickup(args: {
  style: AutopilotStyle
  activity: 'quiet' | 'normal' | 'busy'
  bench: string[]
  players: Record<string, AutopilotPlayer | undefined>
  freeAgents: AutopilotPlayer[]
  pendingAddIds?: readonly string[]
}): AutopilotClaim | null {
  const { players } = args
  const taken = new Set(args.pendingAddIds ?? [])
  const protectAge = PROTECT_YOUNG[args.style]
  const margin = UPGRADE_MARGIN[args.activity]
  const posOf = (p: AutopilotPlayer | undefined) => String(p?.position ?? '').toUpperCase()
  const droppable = args.bench
    .filter(Boolean)
    .filter((id) => players[id] && posOf(players[id]) !== '')
    .filter((id) => !(protectAge != null && isYoung(players[id], protectAge)))

  let best: { claim: AutopilotClaim; gain: number } | null = null
  for (const add of args.freeAgents) {
    if (taken.has(add.id) || !playable(add) || proj(add) <= 0 || posOf(add) === '') continue
    // The weakest bench player at his position is the one he would replace.
    const drop = droppable.filter((id) => posOf(players[id]) === posOf(add)).sort((a, b) => proj(players[a]) - proj(players[b]) || a.localeCompare(b))[0]
    if (!drop) continue
    const gain = proj(add) - proj(players[drop])
    if (gain < UPGRADE_MIN_POINTS || proj(add) < proj(players[drop]) * (1 + margin)) continue
    if (!best || gain > best.gain || (gain === best.gain && add.id < best.claim.addPlayerId)) {
      best = { claim: { slot: UPGRADE_SLOT, addPlayerId: add.id, dropPlayerId: drop }, gain }
    }
  }
  return best?.claim ?? null
}
