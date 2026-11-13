import type { CommissionerModuleId } from './navigation'

/** The contract a module must satisfy to be considered registered with the shell — route, nav entry, and flag key together, per Implementation Program §15. */
export interface CommissionerModuleRegistration {
  id: CommissionerModuleId
  displayName: string
  route: string
  flagKey: CommissionerModuleId
}

