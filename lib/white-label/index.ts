/**
 * Fantasy OS Suite — Phase V5.0: White-Label Productization.
 *
 * Frontend-only, licensee-brand-keyed white-label configuration for the Fantasy OS licensing surfaces
 * (Commissioner Hub, Manager Hub, and the executive layer they host). Separate by design from the
 * Decision-OS IPM widget white-label path — see `types.ts` for the boundary rationale.
 */
export type {
  LicensingTier,
  TenantThemeOverrides,
  TenantBrandCopy,
  TenantLogo,
  TenantFeatureVisibility,
  TenantBrandConfig,
  TenantValidationIssue,
} from './types'

export { TENANT_REGISTRY, DEFAULT_TENANT_ID } from './tenants'

export {
  THEMEABLE_CSS_VARS,
  resolveTenantBrand,
  tenantThemeStyle,
  isFeatureVisible,
  tenantLogoAlt,
} from './resolveTenant'

export {
  validateTenantBrandConfig,
  validateAllTenants,
  allTenantsDeployable,
} from './validateTenant'
