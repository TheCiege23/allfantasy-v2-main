import { stubSettingsClient } from './stub'
import { demoSettingsClient } from './demo'
import { liveSettingsClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { SettingsClient } from './types'

export type * from './types'
export { stubSettingsClient } from './stub'
export { demoSettingsClient } from './demo'
export { liveSettingsClient } from './live'

export async function getSettingsClient(): Promise<SettingsClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveSettingsClient
    case 'demo':
      return demoSettingsClient
    case 'stub':
    default:
      return stubSettingsClient
  }
}
