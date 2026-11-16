import type { CommissionerErrorContract } from '../../contracts'

/**
 * The retired Manager Intelligence directory's one error, in its own module so the client-side view
 * can recognise it without importing the live client. See `./live.ts` for why it is retired.
 */
export const MANAGER_PROFILES_RETIRED_MESSAGE =
  'AllFantasy no longer builds behavior profiles of the managers in your league.'

export function managerProfilesRetired(): CommissionerErrorContract {
  return {
    category: 'not_found',
    message: MANAGER_PROFILES_RETIRED_MESSAGE,
    moduleId: 'managers',
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}
