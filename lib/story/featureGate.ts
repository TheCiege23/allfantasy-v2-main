/**
 * G15.13 — Story feature-gate boundary.
 *
 * Entitlement seam for FUTURE premium story controls. Default ALLOWS everything (no paid
 * enforcement yet), so nothing changes for callers today. A later phase can swap in a
 * Stripe-entitlement-backed implementation and flip individual story types to premium — at the
 * API boundary, not scattered through handlers. Mirrors the G15.4 intelligence feature gate.
 */
import { ALL_STORY_TYPES, type StoryType } from './types'
import type { FeatureGatePrincipal } from '../intelligence/featureGate'

export type { FeatureGatePrincipal }

/** One feature key per story type: `story.<type>`. */
export const STORY_FEATURES = Object.fromEntries(
  ALL_STORY_TYPES.map((t) => [t, `story.${t}`]),
) as Record<StoryType, string>

export type StoryFeature = string
export type StoryFeatureDecision = 'allow' | 'deny' | 'upgrade_required'

export interface IStoryFeatureGate {
  decide(principal: FeatureGatePrincipal | null, feature: StoryFeature): StoryFeatureDecision
}

/** G15.13 default: everything allowed. */
export class AllowAllStoryFeatureGate implements IStoryFeatureGate {
  decide(): StoryFeatureDecision {
    return 'allow'
  }
}

export const defaultStoryFeatureGate: IStoryFeatureGate = new AllowAllStoryFeatureGate()

export class StoryFeatureError extends Error {
  constructor(public readonly feature: StoryFeature, public readonly decision: StoryFeatureDecision) {
    super(`story feature "${feature}" not available (${decision})`)
    this.name = 'StoryFeatureError'
  }
}
