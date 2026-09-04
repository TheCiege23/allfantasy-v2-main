import { stubManagerIntelligenceClient } from './stub'
import { demoManagerIntelligenceClient } from './demo'
import { liveManagerIntelligenceClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { ManagerIntelligenceClient } from './types'

export type * from './types'
export { stubManagerIntelligenceClient } from './stub'
export { demoManagerIntelligenceClient } from './demo'
export { liveManagerIntelligenceClient } from './live'

export async function getManagerIntelligenceClient(): Promise<ManagerIntelligenceClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveManagerIntelligenceClient
    case 'demo':
      return demoManagerIntelligenceClient
    case 'stub':
    default:
      return stubManagerIntelligenceClient
  }
}
