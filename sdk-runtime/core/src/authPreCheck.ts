/**
 * Decision OS — Phase 7.6 Widget Runtime Core: auth pre-check.
 *
 * Thin wrapper around the frozen Phase 7.4 `validateSDKAuth()`. This is a
 * cheap, non-authoritative shape/expiry check that fails fast before a
 * network call is made — the Presentation API's own gate
 * (`lib/decision-os/behavioral/api/gate.ts`) remains the sole authority on
 * whether a credential is actually valid (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md,
 * decision D3). This module never verifies a signature or decodes a token
 * payload — doing so client-side is a permanent prohibition, not a
 * deferred feature.
 */

import { validateSDKAuth } from '../../../lib/decision-os/sdk/auth'
import { buildSDKError } from '../../../lib/decision-os/sdk/errors'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'
import type { AuthPreCheckResult } from './types'

export function authPreCheck(
  auth: SDKAuth,
  opts: { widgetId?: string; timestamp?: string } = {},
): AuthPreCheckResult {
  const result = validateSDKAuth(auth)
  if (result.valid) {
    return { ok: true }
  }
  return {
    ok: false,
    error: buildSDKError('UNAUTHORIZED', opts),
    reasons: result.errors,
  }
}
