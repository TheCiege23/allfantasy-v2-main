/**
 * Fantasy OS Suite — Phase V5.0: White-Label Productization (brand configuration schema).
 *
 * A frontend-only, LICENSEE-BRAND-keyed configuration for the Fantasy OS licensing surfaces
 * (Commissioner Hub, Manager Hub, and the executive layer they host). This is deliberately SEPARATE
 * from `lib/decision-os/presentation/white-label.ts`, which is the SDK/IPM embedded-widget path keyed
 * by DATA PROVIDER (sleeper/yahoo/espn) and maps intelligence semantic tokens. That layer answers
 * "how does an embedded widget map its tokens to a host design system"; this layer answers "what brand
 * name, hub labels, theme, and feature set does THIS licensee deploy the hubs under". Keeping them
 * apart preserves the Phase V4.0 boundary: the executive-viz layer stays independent of Decision OS.
 *
 * No database, no routes, no backend tenancy — the active tenant is selected by a build/runtime env
 * var and resolved synchronously from static config.
 */

/** Commercial tier a licensee is deployed under. Drives validation + documented feature defaults. */
export type LicensingTier = 'starter' | 'professional' | 'enterprise'

/**
 * CSS custom-property overrides applied at the tenant root wrapper. Keys are CSS variable names
 * WITHOUT the leading `--` (e.g. `brand-primary`, `accent`, `font-sans`); values are raw CSS values.
 * An empty object means "inherit the app's default theme unchanged" — the identity re-theme.
 *
 * Only variables the app already themes through (`brand-*`, `accent`, surface/content families, and
 * the font-family vars) are honored; the validator warns on anything outside that allowlist so a typo
 * can't silently no-op in a licensee deployment.
 */
export type TenantThemeOverrides = Record<string, string>

/** Customer-facing brand strings. Every value here replaces a string that is hardcoded today. */
export interface TenantBrandCopy {
  /** Replaces "AllFantasy" wherever the platform brand is shown (titles, trust copy, migration copy). */
  productName: string
  /** Label for the commissioner workspace — hardcoded "Commissioner Hub" today. */
  commissionerHubLabel: string
  /** Label for the manager workspace — hardcoded "Manager Hub" today. */
  managerHubLabel: string
  /**
   * Brand-NEUTRAL scope phrase for the Platform Focus executive summary — e.g.
   * "across every league you manage". This is the one string that renders INSIDE the executive-viz
   * layer, so it must never carry a product or provider name (the validator enforces that), keeping
   * the viz layer brand-neutral while still letting a licensee tune the wording.
   */
  platformScopeLabel: string
}

/** Logo asset reference. Frontend-only: a public asset path or an inlined data-URI. */
export interface TenantLogo {
  /** Public asset path or data-URI. `null` → render the `productName` wordmark only (no image). */
  src: string | null
  /** Accessible alt text; falls back to `${productName} logo` when omitted. */
  alt?: string
}

/**
 * Per-tenant feature/section visibility. Only sections that are genuinely OPTIONAL per licensee are
 * modeled here (each has a real render gate wired). This map is the documented extension point: a new
 * gated surface adds a key here + one `isFeatureVisible` check at its render site — no schema redesign.
 */
export interface TenantFeatureVisibility {
  /** Commissioner Hub — the Migration Center ("bring your leagues over") section. */
  migrationCenter: boolean
  /** Commissioner Hub — the AI Prompts section. */
  aiPrompts: boolean
  /** Manager/Platform surfaces — the cross-league Platform Focus executive summary. */
  platformFocus: boolean
}

/** The full brand configuration for one licensee tenant. */
export interface TenantBrandConfig {
  /** Stable lowercase identifier, matched against `NEXT_PUBLIC_TENANT_ID`. */
  tenantId: string
  /** Human-readable licensee name (for admin/validation output; not necessarily rendered). */
  displayName: string
  licensingTier: LicensingTier
  copy: TenantBrandCopy
  logo: TenantLogo
  theme: TenantThemeOverrides
  features: TenantFeatureVisibility
}

/** A single validation finding for a tenant config (surfaced by branded-deployment validation). */
export interface TenantValidationIssue {
  tenantId: string
  field: string
  message: string
  severity: 'error' | 'warning'
}
