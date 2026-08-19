import { NextRequest, NextResponse } from 'next/server'
import { validatePartnerConfigHandler } from '@/lib/decision-os/sdk/partner-sandbox-handlers'

export const dynamic = 'force-dynamic'

// POST /api/v1/sandbox/partner/validate-config
// Body: a PartnerTenantConfig (Phase 7.19).
// Gated by PARTNER_SANDBOX_API_ENABLED=true. No API key required — see
// PHASE_7_20_PARTNER_SANDBOX_API_ADR.md D3.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = undefined
  }
  const ctx = {
    headers: req.headers,
    searchParams: new URL(req.url).searchParams,
    body,
  }
  const r = validatePartnerConfigHandler(ctx)
  return NextResponse.json(r.body, { status: r.status })
}
