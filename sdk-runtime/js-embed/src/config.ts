/**
 * Decision OS — Phase 7.17 JS Embed Adapter: config assembly + validation.
 *
 * Two layers, mirroring the web component adapter's attributes.ts/config.ts
 * split (Phase 7.16):
 *   1. SHAPE validation (this file, `validateConfigShape`/`validateAuthShape`)
 *      — defensive, because a plain-JS caller has no compiler and can pass
 *      anything at runtime; the frozen semantic validators below assume
 *      well-formed objects and would throw a raw TypeError on `undefined`
 *      nested fields otherwise.
 *   2. SEMANTIC validation — the frozen `validateWidgetConfig` +
 *      `validateSDKAuth` (Phase 7.3/7.4), never reimplemented, only called
 *      once shape is confirmed safe to pass to them.
 */

import {
  validateWidgetConfig,
  type WidgetConfig,
  type WidgetTenantConfig,
} from '../../../lib/decision-os/presentation/widget-contracts'
import { validateSDKAuth } from '../../../lib/decision-os/sdk/auth'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'
import type { JsEmbedWidgetConfig } from './types'

function validateConfigShape(config: unknown): string[] {
  const errors: string[] = []
  if (config === null || typeof config !== 'object') {
    errors.push('config is required and must be an object')
    return errors
  }
  const c = config as Record<string, unknown>
  if (typeof c.mode !== 'string' || c.mode.trim() === '') errors.push('config.mode is required')
  if (typeof c.entityId !== 'string' || c.entityId.trim() === '') errors.push('config.entityId is required')
  if (typeof c.entityType !== 'string' || c.entityType.trim() === '') errors.push('config.entityType is required')
  if (c.tenantConfig === null || typeof c.tenantConfig !== 'object') {
    errors.push('config.tenantConfig is required and must be an object')
  } else {
    const t = c.tenantConfig as Record<string, unknown>
    if (typeof t.tenantId !== 'string' || t.tenantId.trim() === '') errors.push('config.tenantConfig.tenantId is required')
  }
  return errors
}

function validateAuthShape(auth: unknown): string[] {
  const errors: string[] = []
  if (auth === null || typeof auth !== 'object') {
    errors.push('auth is required and must be an object')
    return errors
  }
  const a = auth as Record<string, unknown>
  if (typeof a.method !== 'string') errors.push('auth.method is required')
  if (!Array.isArray(a.scopes)) errors.push('auth.scopes must be an array')
  return errors
}

/**
 * Assembles a full `WidgetConfig` from the partner's non-secret
 * `JsEmbedWidgetConfig` + the `apiKey` supplied separately. `apiKey` is a
 * required PARAMETER, never read from `config` — `JsEmbedWidgetConfig`/
 * `JsEmbedTenantConfig` structurally omit it (types.ts).
 */
export function buildWidgetConfigWithCredential(config: JsEmbedWidgetConfig, apiKey: string): WidgetConfig {
  const tenantConfig: WidgetTenantConfig = { ...config.tenantConfig, apiKey }
  return {
    mode: config.mode,
    entityId: config.entityId,
    entityType: config.entityType,
    tenantConfig,
    presentationVersion: config.presentationVersion,
  }
}

export type ValidateCreateWidgetInputsResult =
  | { valid: true; config: WidgetConfig; warnings: string[] }
  | { valid: false; errors: string[] }

/**
 * The single validation entry point `createWidget.ts` calls. Never throws
 * on malformed input — every problem, from a missing `config` object to a
 * mode/entityType mismatch, comes back as a string in `errors`.
 */
export function validateCreateWidgetInputs(
  rawConfig: unknown,
  rawAuth: unknown,
  apiKey: unknown,
): ValidateCreateWidgetInputsResult {
  const shapeErrors = [...validateConfigShape(rawConfig), ...validateAuthShape(rawAuth)]
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    shapeErrors.push('apiKey is required and must be a non-empty string')
  }
  if (shapeErrors.length > 0) {
    return { valid: false, errors: shapeErrors }
  }

  const config = buildWidgetConfigWithCredential(rawConfig as JsEmbedWidgetConfig, apiKey as string)
  const configResult = validateWidgetConfig(config)
  const authResult = validateSDKAuth(rawAuth as SDKAuth)
  const errors = [...configResult.errors, ...authResult.errors]

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, config, warnings: [...configResult.warnings] }
}
