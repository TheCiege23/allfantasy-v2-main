import type { CommissionerErrorContract } from './errors'

/**
 * The standard response envelope every Commissioner OS data-fetching
 * interface returns — including every module's Decision OS client. The
 * `source` field is the mechanism that makes stub/demo/live data honest
 * and checkable in code, not just in a comment: a UI can (and, until real
 * Decision OS integration exists, must) render differently when
 * source !== 'live'.
 *
 * 'demo' was added after this contract's initial version — Demo Mode
 * didn't exist yet when this file was first written. Found via a real
 * typecheck failure while building League Health's demo client, not
 * caught during Demo Mode's own initial build (Mission Control's demo
 * client happened not to trigger it at the time). CONTRACT_VERSION bumped
 * accordingly.
 */
export interface CommissionerPlatformResponse<T> {
  data: T | null
  error: CommissionerErrorContract | null
  source: 'live' | 'demo' | 'stub'
  timestamp: string
}

export function isCommissionerResponseOk<T>(
  response: CommissionerPlatformResponse<T>
): response is CommissionerPlatformResponse<T> & { data: T } {
  return response.error === null && response.data !== null
}
