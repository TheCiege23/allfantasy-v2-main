/**
 * Decision OS — Phase 7.19 White-Label Partner Onboarding: fixtures.
 *
 * Pure exported constants only — never a database seed script, never a
 * Prisma model (ADR D2). Useful for tests and for scaffolding a future
 * partner sandbox / admin UI against a known-valid record.
 */

import type { PartnerTenantConfig } from './partner-types'

/** A minimal, always-valid 'standard' tier partner — passes validatePartnerTenantConfig with zero errors and zero warnings. */
export const SANDBOX_PARTNER_TENANT_CONFIG: PartnerTenantConfig = {
  tenantId: 'tenant_sandbox_001',
  profile: {
    partnerId: 'partner_sandbox',
    displayName: 'AllFantasy Sandbox Partner',
    status: 'active',
    licenseTier: 'standard',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  allowedOrigins: {
    origins: ['https://sandbox.allfantasy.app'],
  },
  embedPermissions: {
    allowedEmbedTargets: ['iframe', 'web_component'],
  },
  branding: {
    partnerBrandId: 'sandbox',
    preferredMode: 'light',
    colorOverrides: {},
  },
  privacy: {
    requireStrictPrivacy: false,
    maxEntitiesExposedOverride: null,
  },
  featureFlags: {
    enableBenchmarkComparison: false,
    enableArchetypeLabel: false,
    enableBehavioralPatterns: false,
    enableCompanyIntelligence: false,
  },
  whiteLabelPlatform: null,
  apiKeys: [
    {
      keyId: 'key_sandbox_001',
      keyPrefix: 'afk_test_7f3a9c',
      environment: 'test',
      status: 'active',
      scopes: ['intelligence:platform:basic'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
    },
  ],
}

/** An 'enterprise' tier partner with full white-label branding — demonstrates the top of the tier ladder. */
export const ENTERPRISE_PARTNER_TENANT_CONFIG: PartnerTenantConfig = {
  tenantId: 'tenant_enterprise_001',
  profile: {
    partnerId: 'partner_enterprise_demo',
    displayName: 'AllFantasy Enterprise Demo Partner',
    status: 'active',
    licenseTier: 'enterprise',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  allowedOrigins: {
    origins: ['https://widgets.enterprise-demo.example.com'],
  },
  embedPermissions: {
    allowedEmbedTargets: ['iframe', 'web_component', 'js_embed', 'react_wrapper'],
  },
  branding: {
    partnerBrandId: 'enterprise_demo',
    preferredMode: 'enterprise_branding',
    colorOverrides: {
      accent: '#0a84ff',
      surface: '#101010',
    },
  },
  privacy: {
    requireStrictPrivacy: false,
    maxEntitiesExposedOverride: null,
  },
  featureFlags: {
    enableBenchmarkComparison: true,
    enableArchetypeLabel: true,
    enableBehavioralPatterns: true,
    enableCompanyIntelligence: true,
  },
  whiteLabelPlatform: null,
  apiKeys: [
    {
      keyId: 'key_enterprise_001',
      keyPrefix: 'afk_live_9d2e11',
      environment: 'live',
      status: 'active',
      scopes: ['intelligence:platform:basic', 'intelligence:platform:full', 'intelligence:league:read', 'intelligence:manager:read'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
    },
  ],
}
