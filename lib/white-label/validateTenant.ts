/**
 * Fantasy OS Suite — Phase V5.0: White-Label Productization (branded-deployment validation).
 *
 * Pure, dependency-free checks a licensee deployment can run at build time to catch a broken brand
 * config before it ships: missing brand strings, an invalid tier, an unknown theme var (a typo that
 * would silently no-op), or the one hard invariant that protects the executive-viz layer's
 * brand-neutrality — the Platform Focus scope label must not smuggle a product/provider name back in.
 */
import type { TenantBrandConfig, TenantValidationIssue, LicensingTier } from './types'
import { TENANT_REGISTRY } from './tenants'
import { THEMEABLE_CSS_VARS } from './resolveTenant'

const VALID_TIERS: readonly LicensingTier[] = ['starter', 'professional', 'enterprise']

/** Provider names that must never appear in customer-facing brand copy (keeps the layer white-label). */
const PROVIDER_TERMS = ['sleeper', 'espn', 'yahoo', 'fantrax', 'cbs', 'draftkings', 'fanduel', 'underdog']

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0
}

/** Validates one tenant config. Returns [] when the config is deployable. */
export function validateTenantBrandConfig(config: TenantBrandConfig): TenantValidationIssue[] {
  const issues: TenantValidationIssue[] = []
  const id = config.tenantId
  const err = (field: string, message: string) =>
    issues.push({ tenantId: id, field, message, severity: 'error' })
  const warn = (field: string, message: string) =>
    issues.push({ tenantId: id, field, message, severity: 'warning' })

  if (isBlank(config.tenantId)) err('tenantId', 'tenantId is required')
  if (config.tenantId !== config.tenantId.trim().toLowerCase())
    err('tenantId', 'tenantId must be lowercase and trimmed (it is matched against NEXT_PUBLIC_TENANT_ID)')
  if (isBlank(config.displayName)) err('displayName', 'displayName is required')
  if (!VALID_TIERS.includes(config.licensingTier))
    err('licensingTier', `licensingTier must be one of: ${VALID_TIERS.join(', ')}`)

  // Brand copy — every field replaces a string that is otherwise hardcoded, so none may be empty.
  const copy = config.copy
  if (isBlank(copy.productName)) err('copy.productName', 'productName is required')
  if (isBlank(copy.commissionerHubLabel)) err('copy.commissionerHubLabel', 'commissionerHubLabel is required')
  if (isBlank(copy.managerHubLabel)) err('copy.managerHubLabel', 'managerHubLabel is required')
  if (isBlank(copy.platformScopeLabel)) err('copy.platformScopeLabel', 'platformScopeLabel is required')

  // Hard invariant: the ONE brand string that renders inside the executive-viz layer must stay
  // brand-neutral — no product name, no provider name — or the V4.0 brand-neutrality guarantee breaks.
  const scope = copy.platformScopeLabel?.toLowerCase() ?? ''
  if (!isBlank(copy.productName) && scope.includes(copy.productName.trim().toLowerCase()))
    err('copy.platformScopeLabel', 'platformScopeLabel must be brand-neutral — it must not contain the product name')
  for (const term of PROVIDER_TERMS) {
    if (scope.includes(term))
      err('copy.platformScopeLabel', `platformScopeLabel must be provider-neutral — it must not contain "${term}"`)
  }

  // Logo — src may be null (wordmark only), but if provided it must be a non-empty string.
  if (config.logo.src !== null && isBlank(config.logo.src))
    err('logo.src', 'logo.src must be a non-empty path/data-URI, or null for wordmark-only')

  // Theme — only allowlisted CSS vars are honored; an unknown key is almost certainly a typo.
  for (const key of Object.keys(config.theme)) {
    if (!THEMEABLE_CSS_VARS.includes(key))
      warn(`theme.${key}`, `"${key}" is not a themeable variable and will be ignored (expected one of: ${THEMEABLE_CSS_VARS.join(', ')})`)
    else if (isBlank(config.theme[key]))
      warn(`theme.${key}`, `"${key}" override is empty and will be ignored`)
  }

  return issues
}

/** Validates every registered tenant. The build/test harness asserts this returns no `error` issues. */
export function validateAllTenants(): TenantValidationIssue[] {
  return Object.values(TENANT_REGISTRY).flatMap(validateTenantBrandConfig)
}

/** Convenience: true when no tenant has an `error`-severity issue (warnings are allowed). */
export function allTenantsDeployable(): boolean {
  return validateAllTenants().every((issue) => issue.severity !== 'error')
}
