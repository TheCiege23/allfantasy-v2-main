import { stubHelpClient } from './stub'
import { demoHelpClient } from './demo'
import { liveHelpClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { HelpClient } from './types'

export type * from './types'
export { stubHelpClient } from './stub'
export { demoHelpClient } from './demo'
export { liveHelpClient } from './live'

export async function getHelpClient(): Promise<HelpClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveHelpClient
    case 'demo':
      return demoHelpClient
    case 'stub':
    default:
      return stubHelpClient
  }
}
