import { stubActivityClient } from './stub'
import { demoActivityClient } from './demo'
import { liveActivityClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { ActivityClient } from './types'

export type * from './types'
export { stubActivityClient } from './stub'
export { demoActivityClient } from './demo'
export { liveActivityClient } from './live'

export async function getActivityClient(): Promise<ActivityClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveActivityClient
    case 'demo':
      return demoActivityClient
    case 'stub':
    default:
      return stubActivityClient
  }
}
