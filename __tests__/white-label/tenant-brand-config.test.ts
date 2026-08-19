/**
 * Fantasy OS Suite — Phase V5.0: White-Label Productization.
 *
 * Covers the frontend brand-config layer end to end: resolution + fallback, the default tenant being
 * a true identity theme, genuine multi-tenancy (a second tenant that re-themes and hides a section),
 * theme-var application, feature gating, and the branded-deployment validator. Plus two architecture
 * invariants that protect the Phase V4.0 boundary: the executive-viz layer must NOT import the brand
 * config (brand flows in as props), and every tenant's Platform Focus scope label must stay
 * brand/provider-neutral (it's the one brand string that renders inside the viz layer).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveTenantBrand,
  tenantThemeStyle,
  isFeatureVisible,
  tenantLogoAlt,
  validateTenantBrandConfig,
  validateAllTenants,
  allTenantsDeployable,
  TENANT_REGISTRY,
  DEFAULT_TENANT_ID,
  THEMEABLE_CSS_VARS,
  type TenantBrandConfig,
} from '@/lib/white-label'

describe('resolveTenantBrand — selection + fallback', () => {
  it('returns the default (allfantasy) tenant when nothing is requested', () => {
    expect(resolveTenantBrand().tenantId).toBe(DEFAULT_TENANT_ID)
    expect(resolveTenantBrand().tenantId).toBe('allfantasy')
  })

  it('falls back to the default for an unknown id rather than throwing', () => {
    expect(resolveTenantBrand('does-not-exist').tenantId).toBe(DEFAULT_TENANT_ID)
  })

  it('resolves a known tenant, case-insensitively and trimmed', () => {
    expect(resolveTenantBrand('apex').tenantId).toBe('apex')
    expect(resolveTenantBrand('  APEX  ').tenantId).toBe('apex')
  })
})

describe('default tenant is an identity theme (production appearance is unchanged)', () => {
  const brand = resolveTenantBrand('allfantasy')
  it('keeps the first-party product name and hub labels', () => {
    expect(brand.copy.productName).toBe('AllFantasy')
    expect(brand.copy.commissionerHubLabel).toBe('Commissioner Hub')
    expect(brand.copy.managerHubLabel).toBe('Manager Hub')
  })
  it('applies no theme overrides and shows every optional section', () => {
    expect(tenantThemeStyle(brand)).toEqual({})
    expect(isFeatureVisible(brand, 'migrationCenter')).toBe(true)
    expect(isFeatureVisible(brand, 'aiPrompts')).toBe(true)
    expect(isFeatureVisible(brand, 'platformFocus')).toBe(true)
  })
})

describe('multi-tenancy is real — the example licensee actually differs', () => {
  const apex = resolveTenantBrand('apex')
  it('rebrands product name and hub labels', () => {
    expect(apex.copy.productName).toBe('Apex Fantasy')
    expect(apex.copy.commissionerHubLabel).not.toBe('Commissioner Hub')
    expect(apex.copy.managerHubLabel).not.toBe('Manager Hub')
  })
  it('re-themes via real CSS vars and applies the font face to the wrapper', () => {
    const style = tenantThemeStyle(apex) as Record<string, string>
    expect(style['--color-primary']).toBe('#6d28d9')
    expect(style['--color-accent']).toBe('#6d28d9')
    expect(style['--font-family-base']).toContain('Inter Tight')
    // font must ALSO be applied as a real property, not only a var, or the subtree won't inherit it
    expect(style.fontFamily).toBe('var(--font-family-base)')
  })
  it('hides an optional section (feature gating is exercised, not just defined)', () => {
    expect(isFeatureVisible(apex, 'migrationCenter')).toBe(false)
    expect(isFeatureVisible(apex, 'aiPrompts')).toBe(true)
  })
})

describe('tenantLogoAlt', () => {
  it('uses explicit alt, else falls back to the product name', () => {
    expect(tenantLogoAlt(resolveTenantBrand('allfantasy'))).toBe('AllFantasy')
    const noAlt: TenantBrandConfig = {
      ...resolveTenantBrand('allfantasy'),
      logo: { src: null },
    }
    expect(tenantLogoAlt(noAlt)).toBe('AllFantasy logo')
  })
})

describe('branded-deployment validation', () => {
  it('every registered tenant is deployable (no error-severity issues)', () => {
    const errors = validateAllTenants().filter((i) => i.severity === 'error')
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(allTenantsDeployable()).toBe(true)
  })

  function base(): TenantBrandConfig {
    return JSON.parse(JSON.stringify(resolveTenantBrand('allfantasy')))
  }

  it('flags an empty product name', () => {
    const c = base()
    c.copy.productName = '  '
    const errs = validateTenantBrandConfig(c).filter((i) => i.severity === 'error')
    expect(errs.some((e) => e.field === 'copy.productName')).toBe(true)
  })

  it('flags an invalid licensing tier', () => {
    const c = base()
    ;(c as { licensingTier: string }).licensingTier = 'platinum'
    expect(validateTenantBrandConfig(c).some((e) => e.field === 'licensingTier')).toBe(true)
  })

  it('rejects a scope label that leaks the product name (protects viz brand-neutrality)', () => {
    const c = base()
    c.copy.productName = 'Apex'
    c.copy.platformScopeLabel = 'across your Apex leagues'
    expect(
      validateTenantBrandConfig(c).some(
        (e) => e.field === 'copy.platformScopeLabel' && e.severity === 'error',
      ),
    ).toBe(true)
  })

  it('rejects a scope label that leaks a provider name', () => {
    const c = base()
    c.copy.platformScopeLabel = 'across your Sleeper leagues'
    expect(
      validateTenantBrandConfig(c).some(
        (e) => e.field === 'copy.platformScopeLabel' && e.severity === 'error',
      ),
    ).toBe(true)
  })

  it('warns (not errors) on an unknown theme variable — a likely typo that would silently no-op', () => {
    const c = base()
    c.theme = { 'colour-primary': '#fff' } // British spelling typo
    const issues = validateTenantBrandConfig(c)
    expect(issues.some((i) => i.field === 'theme.colour-primary' && i.severity === 'warning')).toBe(true)
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
  })
})

describe('theme overrides only ever target allowlisted, real CSS vars', () => {
  it('every override key across all tenants is in the themeable allowlist', () => {
    for (const tenant of Object.values(TENANT_REGISTRY)) {
      for (const key of Object.keys(tenant.theme)) {
        expect(THEMEABLE_CSS_VARS, `${tenant.tenantId}.${key}`).toContain(key)
      }
    }
  })
})

// ── Architecture invariants (protect the Phase V4.0 boundary) ─────────────────

describe('executive-viz layer stays brand-config-independent (brand flows in as props)', () => {
  const vizComponentsDir = path.join(process.cwd(), 'components', 'executive-viz')
  const vizLibDir = path.join(process.cwd(), 'lib', 'executive-viz')

  function tsFiles(dir: string): string[] {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => path.join(dir, f))
  }

  it('no executive-viz component or view model imports the white-label config', () => {
    for (const file of [...tsFiles(vizComponentsDir), ...tsFiles(vizLibDir)]) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/from ['"]@\/lib\/white-label/)
    }
  })

  it('PlatformFocus renders no hardcoded product name (the one brand string is a prop)', () => {
    const src = fs.readFileSync(path.join(vizComponentsDir, 'PlatformFocus.tsx'), 'utf8')
    // the rendered description must be prop-driven, not the old literal
    expect(src).not.toContain('your entire Fantasy OS footprint')
    expect(src).toContain('scopeLabel')
  })
})
