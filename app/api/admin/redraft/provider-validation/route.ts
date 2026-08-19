import { NextResponse } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { buildNflRedraftProviderValidationDashboard } from '@/lib/nfl-provider/nflRedraftProviderValidationDashboard'
import { loadNflRedraftPremiumProductionEvidence } from '@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource'
import type { NflRedraftPremiumApiCanonicalIds } from '@/lib/redraft-premium/nflRedraftPremiumApiContracts'
import type { NflRedraftPremiumServiceId } from '@/lib/redraft-premium/nflRedraftPremiumServices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICE_IDS = new Set<NflRedraftPremiumServiceId>([
  'basic_runtime_facts',
  'war_room',
  'commissioner_digest',
  'manager_brief',
  'matchup_prep',
  'waiver_report',
  'trade_review',
  'draft_prep',
])

function clean(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function numberParam(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function serviceIdParam(value: string | null): NflRedraftPremiumServiceId {
  const cleaned = clean(value)
  return cleaned && SERVICE_IDS.has(cleaned as NflRedraftPremiumServiceId)
    ? cleaned as NflRedraftPremiumServiceId
    : 'basic_runtime_facts'
}

/**
 * GET /api/admin/redraft/provider-validation
 *
 * Internal/admin-only NFL Redraft provider validation dashboard.
 * Optional query params: leagueId, teamId, managerId, matchupId, playerId, gameId, week, season, serviceId.
 */
export async function GET(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    const url = new URL(request.url)
    const generatedAtIso = new Date().toISOString()
    const canonicalIds: NflRedraftPremiumApiCanonicalIds = {
      leagueId: clean(url.searchParams.get('leagueId')),
      teamId: clean(url.searchParams.get('teamId')),
      managerId: clean(url.searchParams.get('managerId')),
      matchupId: clean(url.searchParams.get('matchupId')),
      playerId: clean(url.searchParams.get('playerId')),
      week: numberParam(url.searchParams.get('week')),
      season: numberParam(url.searchParams.get('season')),
    }
    const gameId = clean(url.searchParams.get('gameId'))
    const serviceId = serviceIdParam(url.searchParams.get('serviceId'))
    const evidencePackets = canonicalIds.leagueId
      ? await loadNflRedraftPremiumProductionEvidence({
          serviceId,
          canonicalIds,
          ingestedAtIso: generatedAtIso,
        })
      : []

    const dashboard = buildNflRedraftProviderValidationDashboard({
      now: new Date(generatedAtIso),
      evidencePackets,
      playerId: canonicalIds.playerId,
      gameId,
    })

    return NextResponse.json({
      ok: true,
      route: '/api/admin/redraft/provider-validation',
      ...dashboard,
    })
  } catch (error) {
    console.error('[api/admin/redraft/provider-validation]', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load NFL redraft provider validation dashboard',
      },
      { status: 500 },
    )
  }
}
