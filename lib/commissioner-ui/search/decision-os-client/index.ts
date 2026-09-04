import { stubSearchClient } from './stub'
import { demoSearchClient } from './demo'
import { liveSearchClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { SearchClient } from './types'

export type * from './types'
export { stubSearchClient } from './stub'
export { demoSearchClient } from './demo'
export { liveSearchClient } from './live'

export async function getSearchClient(): Promise<SearchClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveSearchClient
    case 'demo':
      return demoSearchClient
    case 'stub':
    default:
      return stubSearchClient
  }
}
