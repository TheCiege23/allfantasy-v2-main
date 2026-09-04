import { stubNotificationsClient } from './stub'
import { demoNotificationsClient } from './demo'
import { liveNotificationsClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { NotificationsClient } from './types'

export type * from './types'
export { stubNotificationsClient } from './stub'
export { demoNotificationsClient } from './demo'
export { liveNotificationsClient } from './live'

export async function getNotificationsClient(): Promise<NotificationsClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveNotificationsClient
    case 'demo':
      return demoNotificationsClient
    case 'stub':
    default:
      return stubNotificationsClient
  }
}
