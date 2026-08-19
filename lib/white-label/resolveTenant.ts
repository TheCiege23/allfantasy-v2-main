/**
 * Fantasy OS Suite — Phase V5.0: White-Label Productization (resolver + theming helpers).
 *
 * Synchronous, pure, frontend-only. The active tenant is chosen by `NEXT_PUBLIC_TENANT_ID`
 * (build/runtime env — NOT a database or route). Server components (page metadata) and client
 * components (the hubs) both call `resolveTenantBrand()` at render/module time.
 */
import type { CSSProperties } from 'react'
import type { TenantBrandConfig, TenantFeatureVisibility } from './types'
import { TENANT_REGISTRY, DEFAULT_TENANT_ID } from './tenants'

/** CSS custom properties a tenant is permitted to override, WITHOUT the leading `--`.
 * Kept in lockstep with the app's themeable brand vars; the validator warns on anything outside it. */
export const THEMEABLE_CSS_VARS: readonly string[] = [
  'color-primary',
  'color-primary-strong',
  'color-primary-soft',
  'color-secondary',
  'color-accent',
  'color-decision',
  'color-commissioner',
  'accent',
  'font-family-base',
]

/**
 * Resolves the active tenant brand config. Falls back to the default tenant for an unset or unknown
 * id, so a misconfigured deployment renders the first-party brand rather than crashing.
 */
export function resolveTenantBrand(tenantId?: string): TenantBrandConfig {
  const raw = tenantId ?? process.env.NEXT_PUBLIC_TENANT_ID ?? DEFAULT_TENANT_ID
  const id = raw.trim().toLowerCase()
  return TENANT_REGISTRY[id] ?? TENANT_REGISTRY[DEFAULT_TENANT_ID]!
}

/**
 * Turns a tenant's theme overrides into a style object to spread onto the hub root wrapper.
 * Color vars cascade to every descendant Tailwind `var(--color-*)` usage (re-resolved per element,
 * so `brand-primary` etc. re-theme correctly). `font-family-base`, when present, is additionally
 * applied as a real `fontFamily` on the wrapper so the subtree actually inherits the new face
 * (custom properties alone don't re-flow inherited `font-family`).
 */
export function tenantThemeStyle(config: TenantBrandConfig): CSSProperties {
  const style: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.theme)) {
    if (!value) continue
    style[`--${key}`] = value
  }
  const font = config.theme['font-family-base']
  if (font) style.fontFamily = 'var(--font-family-base)'
  return style as CSSProperties
}

/** True if the tenant exposes a given optional feature/section. Defaults to visible when unset. */
export function isFeatureVisible(
  config: TenantBrandConfig,
  feature: keyof TenantFeatureVisibility,
): boolean {
  return config.features[feature] !== false
}

/** Accessible alt text for the tenant logo, falling back to the product name. */
export function tenantLogoAlt(config: TenantBrandConfig): string {
  return config.logo.alt ?? `${config.copy.productName} logo`
}
