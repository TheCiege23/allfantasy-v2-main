import { stubDecisionOSClient } from './stub'
import { demoDecisionOSClient } from './demo'
import { liveDecisionOSClient } from './live'
import { resolveServerDataMode } from '../demo-mode'
import type { DecisionOSClient } from './types'

export type * from './types'
export { stubDecisionOSClient } from './stub'
export { demoDecisionOSClient } from './demo'
export { liveDecisionOSClient } from './live'

/**
 * The single entry point every Mission Control consumer imports. Resolves
 * the current data mode (Demo Mode) and returns the matching
 * implementation — the caller never knows or needs to know which one it
 * got. Swapping the live implementation for a real one, once the Decision
 * OS backend exists, changes only lib/commissioner-ui/decision-os-client/live.ts.
 */
export async function getDecisionOSClient(): Promise<DecisionOSClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveDecisionOSClient
    case 'demo':
      return demoDecisionOSClient
    case 'stub':
    default:
      return stubDecisionOSClient
  }
}
