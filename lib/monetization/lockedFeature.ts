/**
 * The feature a user hit before being sent to upgrade — named, and returnable to.
 *
 * ⚠ THIS EXISTS BECAUSE THE PARAMETER WAS BEING SILENTLY DISCARDED. Gates link to
 * `/upgrade?plan=pro&feature=player_comparison_explanations`, and the upgrade
 * surface read only `?highlight=`. Measured across the codebase: 7 callers send
 * `highlight` (read), 3 send `feature` (dropped). So a third of the gates landed
 * someone on a generic pricing page immediately after they hit a specific lock,
 * with nothing on screen acknowledging what they had just been stopped from doing.
 *
 * The monetization handoff states the gate pattern as three rules — name the tier
 * and its price, carry the feature through in the link, always offer tokens as an
 * alternative. Rule two was written into every gate's href and then thrown away at
 * the destination.
 *
 * ⚠ THESE KEYS ARE THE URL VOCABULARY, NOT `SubscriptionFeatureId`. They overlap
 * but are not the same set: `player_comparison_explanations` and `advanced_scoring`
 * are query values that no feature-id union contains. Typing this against
 * SubscriptionFeatureId would have looked tidier and matched nothing.
 */

export type LockedFeature = {
  /** What the user was trying to do, in their words. */
  label: string
  /**
   * Where to send them once they have paid.
   *
   * ⚠ NULL IS A REAL ANSWER. Some locks live inside a league or a bracket whose id
   * we do not have on the upgrade page, so there is no honest destination — better
   * a generic "you're all set" than a confident button to the wrong league.
   */
  href: string | null
}

/**
 * Every `?feature=` value in use, verified by grep against the callers rather than
 * imagined. Each href is where that lock actually lives.
 */
export const LOCKED_FEATURES: Record<string, LockedFeature> = {
  player_comparison_explanations: {
    label: 'player comparison explanations',
    href: '/core/players',
  },
  league_rankings: {
    // components/app/power-rankings/AICommentary.tsx
    label: 'power rankings commentary',
    href: '/af-rankings',
  },
  waiver: {
    // components/waivers/AIWaiverRecommendationsPanel.tsx, lib/entitlements/afAccess.ts
    label: 'waiver recommendations',
    href: null, // league-scoped — we do not hold the league id here
  },
  commissioner: {
    // components/waivers/CommissionerWaiverInsightsPanel.tsx, lib/entitlements/afAccess.ts
    label: 'commissioner insights',
    href: '/commissioner-hub',
  },
  commissioner_ai_tools: {
    label: 'commissioner tools',
    href: '/commissioner-hub',
  },
  advanced_scoring: {
    // World Cup bracket settings + create
    label: 'advanced scoring',
    href: null, // bracket-scoped
  },
  ai_chat: {
    label: 'Chimmy',
    href: null,
  },
}

/**
 * Resolve a raw query value.
 *
 * ⚠ AN UNKNOWN VALUE RETURNS null RATHER THAN A GUESS. A gate could add a new
 * `?feature=` tomorrow, and rendering "you hit the some_new_key feature" would be
 * worse than rendering nothing — the banner exists to be reassuring and specific,
 * and a raw identifier is neither.
 */
export function resolveLockedFeature(raw: string | null | undefined): LockedFeature | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  return LOCKED_FEATURES[key] ?? null
}
