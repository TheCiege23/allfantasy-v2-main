/**
 * Decision OS — Phase 7.9 Iframe Adapter: embed config validation.
 *
 * Thin wrapper over the frozen Phase 7.4 `validateSDKConfig` — adds only the
 * iframe-specific checks: `embedTarget` must be 'iframe', both origins must
 * be well-formed, and `hostOrigin` must be a member of the explicit
 * `allowedOrigins` list. Never reimplements auth/theme/refresh/version
 * validation; those stay owned by lib/decision-os/sdk/config.ts.
 */

import { validateSDKConfig } from '../../../lib/decision-os/sdk/config'
import type { IframeEmbedConfig } from './types'
import { validateOriginFormat, isOriginAllowed } from './origin'

export interface IframeEmbedConfigValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateIframeEmbedConfig(config: IframeEmbedConfig): IframeEmbedConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const sdkResult = validateSDKConfig(config.sdkConfig)
  errors.push(...sdkResult.errors.map((e) => `sdkConfig: ${e}`))
  warnings.push(...sdkResult.warnings.map((w) => `sdkConfig: ${w}`))

  if (config.sdkConfig.embedTarget !== 'iframe') {
    errors.push(`embedTarget must be 'iframe' for the iframe adapter, got '${config.sdkConfig.embedTarget}'`)
  }

  const iframeOriginResult = validateOriginFormat(config.iframeOrigin)
  errors.push(...iframeOriginResult.errors.map((e) => `iframeOrigin: ${e}`))

  const hostOriginResult = validateOriginFormat(config.sdkConfig.hostOrigin)
  errors.push(...hostOriginResult.errors.map((e) => `sdkConfig.hostOrigin: ${e}`))

  if (config.allowedOrigins.length === 0) {
    errors.push('allowedOrigins must not be empty')
  } else if (hostOriginResult.valid && !isOriginAllowed(config.sdkConfig.hostOrigin, config.allowedOrigins)) {
    errors.push(`sdkConfig.hostOrigin '${config.sdkConfig.hostOrigin}' is not a member of allowedOrigins`)
  }

  if (
    iframeOriginResult.valid &&
    hostOriginResult.valid &&
    config.iframeOrigin === config.sdkConfig.hostOrigin
  ) {
    warnings.push(
      'iframeOrigin and sdkConfig.hostOrigin are identical — a same-origin embed forgoes the isolation benefit of the iframe target',
    )
  }

  return { valid: errors.length === 0, errors, warnings }
}
