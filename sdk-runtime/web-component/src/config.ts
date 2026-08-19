/**
 * Decision OS — Phase 7.16 Web Component Adapter: config assembly + validation.
 *
 * Composes a parsed attribute set (attributes.ts) + caller-supplied
 * credentials (credentials.ts) into a full `WidgetConfig` (Phase 7.3) and
 * validates it via the frozen `validateWidgetConfig` + `validateSDKAuth`
 * (Phase 7.3/7.4) — this module reimplements neither, it only assembles
 * inputs and aggregates their results.
 */

import {
  validateWidgetConfig,
  type WidgetConfig,
  type WidgetTenantConfig,
} from '../../../lib/decision-os/presentation/widget-contracts'
import { validateSDKAuth } from '../../../lib/decision-os/sdk/auth'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'
import type { ParsedElementAttributes } from './attributes'

/**
 * Assembles a `WidgetConfig` from parsed attributes + the caller-supplied
 * `apiKey`. `apiKey` is a required parameter (never optional, never
 * defaulted) precisely because it must come from `credentials.ts`'s
 * WeakMap, never from an attribute — there is no code path here that could
 * accidentally read it from `getAttribute`.
 */
export function buildWidgetConfigFromAttributes(
  parsed: ParsedElementAttributes,
  apiKey: string,
): WidgetConfig {
  const tenantConfig: WidgetTenantConfig = {
    tenantId: parsed.tenantId,
    apiKey,
    allowedOrigins: parsed.allowedOrigins,
    rateLimitPerMinute: parsed.rateLimitPerMinute,
    featureFlags: parsed.featureFlags,
    whiteLabelPlatform: parsed.whiteLabelPlatform,
  }

  return {
    mode: parsed.mode,
    entityId: parsed.entityId,
    entityType: parsed.entityType,
    tenantConfig,
    presentationVersion: parsed.presentationVersion,
  }
}

export interface ElementConfigValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates the assembled `WidgetConfig` (mode/entityType/tenant shape) AND
 * the caller-supplied `SDKAuth` (credential/tenantId/scope shape) together.
 * Neither validator is reimplemented — both are the frozen Phase 7.3/7.4
 * contract functions. Note: neither `validateWidgetConfig` nor
 * `validateSDKAuth` ever includes the raw apiKey/credential in their output
 * (Phase 7.3/7.4 guarantee), so this aggregation is safe to render as-is.
 */
export function validateElementConfig(
  config: WidgetConfig,
  auth: SDKAuth,
): ElementConfigValidationResult {
  const configResult = validateWidgetConfig(config)
  const authResult = validateSDKAuth(auth)

  return {
    valid: configResult.valid && authResult.valid,
    errors: [...configResult.errors, ...authResult.errors],
    warnings: [...configResult.warnings],
  }
}
