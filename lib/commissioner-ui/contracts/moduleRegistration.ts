import type { CommissionerModuleId } from './navigation'

/** The contract a module must satisfy to be considered registered with the shell — route, nav entry, and flag key together, per Implementation Program §15. */
export interface CommissionerModuleRegistration {
  id: CommissionerModuleId
  displayName: string
  route: string
  flagKey: CommissionerModuleId
}

/**
 * A documented convention, not a shared runtime interface — every
 * Commissioner OS infrastructure provider follows this naming pattern
 * (component name / hook name pair), but each provider's actual context
 * value is legitimately different in content, so this isn't enforced as a
 * shared type.
 */
export interface CommissionerProviderConvention {
  providerName: string
  hookName: string
}
