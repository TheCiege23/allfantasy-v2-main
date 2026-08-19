/**
 * Decision OS — Phase 7.4 Widget SDK authentication contracts.
 *
 * Six auth methods, validated deterministically. No auth implementation —
 * no token issuance, no signature verification, no network calls.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKAuth, SDKAuthMethod } from './types'
import type { IntelligenceApiScope } from '../behavioral/api/contracts'

// ── Requirements matrix ───────────────────────────────────────────────────────

interface SDKAuthRequirements {
  requiresCredential: boolean
  requiresTenantId: boolean
  /** Scopes this method may never request, even if present in SDKAuth.scopes. */
  disallowedScopes: readonly IntelligenceApiScope[]
}

export const AUTH_METHOD_REQUIREMENTS: Readonly<Record<SDKAuthMethod, SDKAuthRequirements>> = {
  api_key: {
    requiresCredential: true,
    requiresTenantId: true,
    disallowedScopes: [],
  },
  jwt: {
    requiresCredential: true,
    requiresTenantId: true,
    disallowedScopes: [],
  },
  signed_embed_token: {
    requiresCredential: true,
    requiresTenantId: true,
    disallowedScopes: [],
  },
  partner_token: {
    requiresCredential: true,
    requiresTenantId: true,
    disallowedScopes: [],
  },
  anonymous_public: {
    requiresCredential: false,
    requiresTenantId: false,
    disallowedScopes: ['intelligence:league:read', 'intelligence:manager:read', 'intelligence:platform:full'],
  },
  enterprise_tenant_token: {
    requiresCredential: true,
    requiresTenantId: true,
    disallowedScopes: [],
  },
}

export const ALL_AUTH_METHODS: readonly SDKAuthMethod[] = [
  'api_key', 'jwt', 'signed_embed_token', 'partner_token', 'anonymous_public', 'enterprise_tenant_token',
]

// ── Pure helpers ──────────────────────────────────────────────────────────────

export interface SDKAuthValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates an SDKAuth contract against its method's requirements.
 * Deterministic — no network calls, no credential verification (that is the
 * runtime's job at the API boundary; this only checks contract SHAPE).
 */
export function validateSDKAuth(auth: SDKAuth): SDKAuthValidationResult {
  const errors: string[] = []

  if (!ALL_AUTH_METHODS.includes(auth.method)) {
    errors.push(`method '${auth.method}' is not a valid auth method`)
    return { valid: false, errors }
  }

  const req = AUTH_METHOD_REQUIREMENTS[auth.method]

  if (req.requiresCredential && (!auth.credential || auth.credential.trim() === '')) {
    errors.push(`method '${auth.method}' requires a non-empty credential`)
  }
  if (!req.requiresCredential && auth.credential !== null) {
    errors.push(`method '${auth.method}' must not carry a credential`)
  }

  if (req.requiresTenantId && (!auth.tenantId || auth.tenantId.trim() === '')) {
    errors.push(`method '${auth.method}' requires a non-empty tenantId`)
  }
  if (!req.requiresTenantId && auth.tenantId !== null) {
    errors.push(`method '${auth.method}' must not carry a tenantId`)
  }

  for (const scope of auth.scopes) {
    if (req.disallowedScopes.includes(scope)) {
      errors.push(`method '${auth.method}' is not permitted to request scope '${scope}'`)
    }
  }

  if (auth.expiresAt !== null) {
    const parsed = Date.parse(auth.expiresAt)
    if (Number.isNaN(parsed)) {
      errors.push(`expiresAt '${auth.expiresAt}' is not a valid ISO 8601 timestamp`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/** Whether an auth method is scope-capped to public-safe access only. */
export function isPublicAuthMethod(method: SDKAuthMethod): boolean {
  return method === 'anonymous_public'
}
