import { stubAutomationClient } from './stub'
import { demoAutomationClient } from './demo'
import { liveAutomationClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { AutomationClient } from './types'

export type * from './types'
export { stubAutomationClient } from './stub'
export { demoAutomationClient } from './demo'
export { liveAutomationClient } from './live'

export async function getAutomationClient(): Promise<AutomationClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveAutomationClient
    case 'demo':
      return demoAutomationClient
    case 'stub':
    default:
      return stubAutomationClient
  }
}
