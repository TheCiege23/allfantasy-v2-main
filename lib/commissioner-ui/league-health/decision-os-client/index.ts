import { stubLeagueHealthClient } from './stub'
import { demoLeagueHealthClient } from './demo'
import { liveLeagueHealthClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { LeagueHealthClient } from './types'

export type * from './types'
export { stubLeagueHealthClient } from './stub'
export { demoLeagueHealthClient } from './demo'
export { liveLeagueHealthClient } from './live'

export async function getLeagueHealthClient(): Promise<LeagueHealthClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveLeagueHealthClient
    case 'demo':
      return demoLeagueHealthClient
    case 'stub':
    default:
      return stubLeagueHealthClient
  }
}
