import { stubRecommendationsClient } from './stub'
import { demoRecommendationsClient } from './demo'
import { liveRecommendationsClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { RecommendationsClient } from './types'

export type * from './types'
export { stubRecommendationsClient } from './stub'
export { demoRecommendationsClient } from './demo'
export { liveRecommendationsClient } from './live'

export async function getRecommendationsClient(): Promise<RecommendationsClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveRecommendationsClient
    case 'demo':
      return demoRecommendationsClient
    case 'stub':
    default:
      return stubRecommendationsClient
  }
}
