import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isSportsDataEnabled, sportsDataGateDiagnostics } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedIntelligenceIntegrationService } from '@/lib/fantasy-os/sports-runtime/intelligenceIntegration'
import { describeEspnIdentityCoverage } from '@/lib/sports-data-gateway/runtime/espnIdentityPopulation'

export const dynamic = 'force-dynamic'

/**
 * Fantasy OS Phase 5E-h — operator observability for the certified sports-data plane.
 *
 * Admin-gated AND behind the `observability` server-only feature gate (off by default, independently reversible).
 * Exposes provider health, certified snapshot freshness, evidence availability, snapshot versions, and gate
 * diagnostics. It NEVER exposes credentials, connection strings, or raw provider payloads. Read-only.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  if (!isSportsDataEnabled('observability')) {
    return NextResponse.json({ enabled: false, reason: 'FANTASY_OS_SPORTS_DATA_OBSERVABILITY_ENABLED is off' }, { status: 200 })
  }

  const url = new URL(request.url)
  const season = url.searchParams.get('season')?.trim() || String(new Date().getFullYear())
  const week = url.searchParams.get('week')?.trim() || '1'

  const svc = new CertifiedIntelligenceIntegrationService()
  const platform = await svc.describePlatformSportsContext({ season, week })

  // Phase 5F-c: safe ESPN identity-population coverage (counts only — never player rows, ids, or payloads).
  let identityCoverage: { identityMapRows: number; withEspnId: number; withSleeperId: number } | { error: string } | undefined
  try {
    identityCoverage = await describeEspnIdentityCoverage()
  } catch {
    identityCoverage = { error: 'identity coverage unavailable' }
  }

  return NextResponse.json({
    enabled: true,
    generatedAt: platform.generatedAt,
    providerHealth: platform.providerHealth, // provenance only — no env var names, no credentials
    snapshotFreshness: platform.snapshotFreshness,
    evidenceAvailability: platform.evidenceAvailability,
    identityCoverage, // ESPN↔canonical mapping counts (Phase 5F-c) — counts only
    gateDiagnostics: sportsDataGateDiagnostics(), // gate names + booleans only
    unsupported: platform.unsupported,
  })
}
