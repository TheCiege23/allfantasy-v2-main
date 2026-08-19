/**
 * Fantasy OS Suite — Phase V5.0: White-Label Productization (tenant registry).
 *
 * Static, frontend-only tenant configs. `allfantasy` is the default (identity theme, everything on —
 * byte-for-byte the current production brand, so wiring the hubs to config changes nothing visible
 * until a different tenant is selected). `apex` is a worked example licensee that proves the layer is
 * genuinely multi-tenant: its own product name, an accent/font re-theme, and one section hidden
 * (Migration Center) so feature-gating is exercised end-to-end rather than only defined.
 */
import type { TenantBrandConfig } from './types'

/** The default, first-party brand. Identity theme (no overrides) → current production appearance. */
const ALLFANTASY: TenantBrandConfig = {
  tenantId: 'allfantasy',
  displayName: 'AllFantasy (first-party)',
  licensingTier: 'enterprise',
  copy: {
    productName: 'AllFantasy',
    commissionerHubLabel: 'Commissioner Hub',
    managerHubLabel: 'Manager Hub',
    platformScopeLabel: 'across every league you manage',
  },
  logo: { src: null, alt: 'AllFantasy' },
  theme: {}, // identity — inherit the app's default theme unchanged
  features: {
    migrationCenter: true,
    aiPrompts: true,
    platformFocus: true,
  },
}

/**
 * Example enterprise licensee. Demonstrates the full re-theme surface a real pilot would use:
 * a distinct product name, a brand accent + font override, and a hidden section. Nothing here reaches
 * production unless `NEXT_PUBLIC_TENANT_ID=apex` is set — it exists so the config, resolver, theming,
 * and feature-gating all have a second real consumer (the ≥2-consumer bar this suite holds itself to).
 */
const APEX: TenantBrandConfig = {
  tenantId: 'apex',
  displayName: 'Apex Fantasy (example licensee)',
  licensingTier: 'professional',
  copy: {
    productName: 'Apex Fantasy',
    commissionerHubLabel: 'League Command',
    managerHubLabel: 'My Teams',
    platformScopeLabel: 'across all of your leagues',
  },
  logo: { src: null, alt: 'Apex Fantasy' },
  theme: {
    // Only allowlisted vars (brand color family / accent / font). Keys are CSS vars WITHOUT `--`.
    // `--color-primary` backs every Tailwind `brand-primary` usage; overriding it re-themes the hubs.
    'color-primary': '#6d28d9',
    'color-accent': '#6d28d9',
    'font-family-base': "'Inter Tight', 'Inter', 'Segoe UI', sans-serif",
  },
  features: {
    migrationCenter: false, // this licensee onboards leagues themselves — hide the self-serve importer
    aiPrompts: true,
    platformFocus: true,
  },
}

/** All known tenants, keyed by `tenantId`. */
export const TENANT_REGISTRY: Record<string, TenantBrandConfig> = {
  [ALLFANTASY.tenantId]: ALLFANTASY,
  [APEX.tenantId]: APEX,
}

/** The tenant used when none is configured or an unknown id is requested. */
export const DEFAULT_TENANT_ID = ALLFANTASY.tenantId
