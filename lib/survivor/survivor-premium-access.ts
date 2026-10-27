import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import {
  hasAfCommissionerTier,
  hasAfProTier,
  hasAfSupremeTier,
} from '@/lib/tournament/resolve-af-plan-from-subscription'

/**
 * Premium Survivor Command Center tiles — THE one place their plan rules live. The panel reads it
 * to draw locks, and the tile endpoint (`GET .../survivor/premium?tile=`) reads it to refuse: a
 * lock is enforced on the server with the plan the server resolves, never the one a page shows.
 */
export type SurvivorPremiumCommandTileId =
  | 'threat_map'
  | 'social_pulse'
  | 'challenge_outlook'
  | 'jury_projection'
  | 'exile_status'
  | 'minigame_planner'
  | 'risk_alerts'
  | 'host_fairness_radar'
  | 'story_mode_controls'

export type SurvivorPremiumTileGate = {
  tileId: SurvivorPremiumCommandTileId
  title: string
  subtitle: string
  /** Minimum AF tier for the primary lens (player vs commissioner vs full). */
  requiredPlan: 'af_pro' | 'af_commissioner' | 'af_supreme'
  /** If true, tile can consume AF Tokens on deep runs (see catalog). */
  tokenEligible: boolean
  /** Who the tile is for: any league member, or the commissioner / co-commissioner only. */
  lens: 'player' | 'host'
  /** `coming_next` tiles are shown without a lock or an upgrade button, and the endpoint refuses them. */
  status: 'live' | 'coming_next'
}

export const SURVIVOR_PREMIUM_COMMAND_TILES: readonly SurvivorPremiumTileGate[] = [
  {
    tileId: 'threat_map',
    title: 'Threat map',
    subtitle: 'Who looks strongest, and who drew votes at the last read.',
    requiredPlan: 'af_pro',
    tokenEligible: false,
    lens: 'player',
    status: 'live',
  },
  {
    tileId: 'social_pulse',
    title: 'Social pulse',
    subtitle: 'Who is talking in your tribe huddle this week.',
    requiredPlan: 'af_pro',
    tokenEligible: false,
    lens: 'player',
    status: 'live',
  },
  {
    tileId: 'challenge_outlook',
    title: 'Challenge outlook',
    subtitle: "This week's challenges, when they lock, and what they pay.",
    requiredPlan: 'af_pro',
    tokenEligible: false,
    lens: 'player',
    status: 'live',
  },
  {
    tileId: 'jury_projection',
    title: 'Jury projection',
    subtitle: 'The jury so far, and who looks set to face it.',
    requiredPlan: 'af_pro',
    tokenEligible: false,
    lens: 'player',
    status: 'live',
  },
  {
    tileId: 'exile_status',
    title: 'Exile status',
    subtitle: 'The return week, tokens needed, and your own balance.',
    requiredPlan: 'af_pro',
    tokenEligible: false,
    lens: 'player',
    status: 'live',
  },
  {
    tileId: 'minigame_planner',
    title: 'Mini-game planner',
    subtitle: "Every week's challenges: what is scheduled, what is open, and who won.",
    requiredPlan: 'af_commissioner',
    tokenEligible: false,
    lens: 'host',
    status: 'live',
  },
  {
    tileId: 'risk_alerts',
    title: 'Risk alerts',
    subtitle: 'Open collusion and tanking flags, and managers who have gone quiet.',
    requiredPlan: 'af_commissioner',
    tokenEligible: false,
    lens: 'host',
    status: 'live',
  },
  {
    tileId: 'host_fairness_radar',
    title: 'Fairness radar',
    subtitle: 'Ties, automatic ballots, late votes, score fixes and your overrides.',
    requiredPlan: 'af_commissioner',
    tokenEligible: false,
    lens: 'host',
    status: 'live',
  },
  {
    tileId: 'story_mode_controls',
    title: 'Story mode controls',
    subtitle: 'Weekly recap engine + recap tone / spoilers.',
    requiredPlan: 'af_supreme',
    tokenEligible: false,
    lens: 'host',
    status: 'coming_next',
  },
]

export function canAccessSurvivorPremiumTile(plan: AfPlanId | null, tile: SurvivorPremiumTileGate): boolean {
  if (!plan) return false
  if (tile.requiredPlan === 'af_pro') return hasAfProTier(plan)
  if (tile.requiredPlan === 'af_commissioner') return hasAfCommissionerTier(plan)
  return hasAfSupremeTier(plan)
}

export function getSurvivorPremiumTile(tileId: string): SurvivorPremiumTileGate | null {
  return SURVIVOR_PREMIUM_COMMAND_TILES.find(tile => tile.tileId === tileId) ?? null
}

export type SurvivorPremiumTileAccess =
  | { ok: true }
  | { ok: false; reason: 'unknown_tile' | 'coming_next' | 'commissioner_only' | 'plan_required'; requiredPlan?: SurvivorPremiumTileGate['requiredPlan'] }

/** The one access decision for a tile: built, the right lens, and the plan. */
export function resolveSurvivorPremiumTileAccess(input: { tileId: string; plan: AfPlanId | null; isCommissioner: boolean }): SurvivorPremiumTileAccess {
  const tile = getSurvivorPremiumTile(input.tileId)
  if (!tile) return { ok: false, reason: 'unknown_tile' }
  if (tile.status !== 'live') return { ok: false, reason: 'coming_next' }
  if (tile.lens === 'host' && !input.isCommissioner) return { ok: false, reason: 'commissioner_only' }
  if (!canAccessSurvivorPremiumTile(input.plan, tile)) return { ok: false, reason: 'plan_required', requiredPlan: tile.requiredPlan }
  return { ok: true }
}
