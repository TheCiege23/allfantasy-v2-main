/**
 * Whether the signed-in /core home shows the launch countdown, and with what offer. Pure (no
 * server imports) so the rule is testable without rendering the 4,500-line /core page.
 *
 * Decided by the SAME rule as the depth locks' "Free until Oct 15" chip — `preLaunchFree` from
 * `decideCoreDepth` (lib/core-app/coreDepthAccess.ts): only before the paywall starts, and only for
 * a viewer WITHOUT a plan. The people who will lose the depth are told; plan holders never are.
 */
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import { getPaywallStartsAt, isPaywallLive } from '@/lib/monetization/paywallLaunch'
import { foundingOfferBeforeLaunch, type LaunchOfferView } from '@/lib/monetization/foundingMember'

type Env = Record<string, string | undefined>

export function homeLaunchOfferFor(args: {
  /** The viewer holds a plan. `null` = the plan read failed: show nothing rather than risk a customer. */
  hasPlan: boolean | null
  now: Date
  env?: Env
}): LaunchOfferView | null {
  if (args.hasPlan === null) return null
  const env = args.env ?? process.env
  const depth = decideCoreDepth('player_depth', {
    live: isPaywallLive(args.now, env),
    startsAt: getPaywallStartsAt(env),
    hasPlan: args.hasPlan,
  })
  if (!depth.preLaunchFree) return null
  return {
    startsAt: depth.startsAt,
    prelaunch: true,
    // Before launch every account predates it, so a signed-in viewer is a founding member.
    founding: foundingOfferBeforeLaunch({ signedIn: true, env }),
  }
}
