import { stubReportsClient } from './stub'
import { demoReportsClient } from './demo'
import { liveReportsClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { ReportsClient } from './types'

export type * from './types'
export { stubReportsClient } from './stub'
export { demoReportsClient } from './demo'
export { liveReportsClient } from './live'

export async function getReportsClient(): Promise<ReportsClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveReportsClient
    case 'demo':
      return demoReportsClient
    case 'stub':
    default:
      return stubReportsClient
  }
}
