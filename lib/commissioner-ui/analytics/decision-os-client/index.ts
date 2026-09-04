import { stubAnalyticsClient } from './stub'
import { demoAnalyticsClient } from './demo'
import { liveAnalyticsClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { AnalyticsClient } from './types'

export type * from './types'
export { stubAnalyticsClient } from './stub'
export { demoAnalyticsClient } from './demo'
export { liveAnalyticsClient } from './live'

export async function getAnalyticsClient(): Promise<AnalyticsClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveAnalyticsClient
    case 'demo':
      return demoAnalyticsClient
    case 'stub':
    default:
      return stubAnalyticsClient
  }
}
