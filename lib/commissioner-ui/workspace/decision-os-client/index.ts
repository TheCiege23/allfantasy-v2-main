import { stubWorkspaceClient } from './stub'
import { demoWorkspaceClient } from './demo'
import { liveWorkspaceClient } from './live'
import { resolveServerDataMode } from '../../demo-mode'
import type { WorkspaceClient } from './types'

export type * from './types'
export { stubWorkspaceClient } from './stub'
export { demoWorkspaceClient } from './demo'
export { liveWorkspaceClient } from './live'

export async function getWorkspaceClient(): Promise<WorkspaceClient> {
  const mode = await resolveServerDataMode()
  switch (mode) {
    case 'live':
      return liveWorkspaceClient
    case 'demo':
      return demoWorkspaceClient
    case 'stub':
    default:
      return stubWorkspaceClient
  }
}
