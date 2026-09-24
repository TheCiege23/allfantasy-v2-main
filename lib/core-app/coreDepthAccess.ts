/**
 * Which /core DEPTH a viewer may see — the pure decision, shared by server loaders and the
 * client screens (no server imports, so a screen can import the types).
 *
 * The rule (owner's decisions, 2026-09-24): creating, importing and running a league is free.
 * The paid part of /core is the DEPTH on top of three free surfaces —
 *   - Player Finder: search, injury, "in your leagues", ownership and stats stay free; the
 *     trade/compare/verdict/moves views and the player card's market & history are AF Pro.
 *   - Trade Center: the verdict (grades, fairness, balance) stays free; the "why", the value
 *     layers, counters and partner suggestions are AF Pro.
 *   - Commissioner hub: everything needed to run the league stays free; charts, member
 *     activity, the audit log, waiver oversight, the calendar and automations are AF Commissioner.
 *
 *   - Competitive Edge (AF Pro, and the War Room plan): what the manager on the other side of a
 *     decision has actually done — lib/competitive-edge/. The War Room's paid value, surfaced INSIDE
 *     the decision (the Trade Center today), not on the War Room screen itself.
 *
 * ⚠ THE WAR ROOM SCREEN IS STILL NOT GATED. Scout withholds raw profiles from every caller by
 * design (Milestone 32 — an entitlement decides who pays, not what a raw dossier is), and Game
 * Plan is a safety feature. Gating either would charge for the wrong thing; the paid part is the
 * Competitive Edge the screen points to.
 *
 * ⚠ BEFORE PAYWALL LAUNCH EVERYTHING IS UNLOCKED, and `preLaunchFree` says so, so a screen can
 * say "Free until Oct 15" to the people who will lose it — not to plan holders, who won't.
 * AFTER launch a failed plan lookup is LOCKED (fail closed), matching the rest of the app.
 */
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

export type CoreDepth = 'player_depth' | 'trade_depth' | 'commissioner_depth' | 'competitive_edge'

export type CoreDepthSpec = {
  /** The plan feature that unlocks it — resolved through the entitlement matrix, not by plan name. */
  featureId: SubscriptionFeatureId
  /** Customer-facing plan name for the lock. */
  planName: 'AF Pro' | 'AF Commissioner'
  /** What the lock says is behind it. */
  label: string
  upgradePath: string
}

export const CORE_DEPTH: Record<CoreDepth, CoreDepthSpec> = {
  player_depth: {
    featureId: 'player_ai_recommendations',
    planName: 'AF Pro',
    label: 'Player deep dives',
    upgradePath: '/upgrade?plan=pro',
  },
  trade_depth: {
    featureId: 'trade_analyzer',
    planName: 'AF Pro',
    label: 'The full trade breakdown',
    upgradePath: '/upgrade?plan=pro',
  },
  commissioner_depth: {
    featureId: 'commissioner_automation',
    planName: 'AF Commissioner',
    label: 'Commissioner insights',
    upgradePath: '/upgrade?plan=commissioner',
  },
  /*
   * `manager_psychology`, NOT `war_room`: the matrix grants manager_psychology to AF Pro, the War
   * Room plan and Supreme, while the `war_room` feature id opens nothing at all (measured
   * 2026-09-24). Its own depth rather than trade_depth, so a War Room plan holder — who does not
   * have the Trade Center breakdown — still gets Competitive Edge.
   */
  competitive_edge: {
    featureId: 'manager_psychology',
    planName: 'AF Pro',
    label: 'Competitive Edge',
    upgradePath: '/upgrade?plan=pro',
  },
}

/** Plain, serialisable — handed from a server loader to a client screen as a prop. */
export type CoreDepthAccess = {
  depth: CoreDepth
  unlocked: boolean
  /** The viewer holds the plan. */
  hasPlan: boolean
  /** Unlocked only because the paywall has not started — the case for a "Free until" note. */
  preLaunchFree: boolean
  /** ISO instant the paywall starts. */
  startsAt: string
  planName: CoreDepthSpec['planName']
  label: string
  upgradePath: string
}

export function decideCoreDepth(
  depth: CoreDepth,
  args: { live: boolean; startsAt: Date; hasPlan: boolean },
): CoreDepthAccess {
  const spec = CORE_DEPTH[depth]
  const unlocked = args.hasPlan || !args.live
  return {
    depth,
    unlocked,
    hasPlan: args.hasPlan,
    preLaunchFree: !args.live && !args.hasPlan,
    startsAt: args.startsAt.toISOString(),
    planName: spec.planName,
    label: spec.label,
    upgradePath: spec.upgradePath,
  }
}

/** "Oct 15" — the launch day as a US Eastern calendar date, for the "Free until" note. */
export function formatPaywallDay(startsAtIso: string): string {
  const d = new Date(startsAtIso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(d)
}
