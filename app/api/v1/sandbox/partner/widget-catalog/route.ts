import { NextRequest, NextResponse } from 'next/server'
import { widgetCatalogHandler } from '@/lib/decision-os/sdk/partner-sandbox-handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/sandbox/partner/widget-catalog?licenseTier=standard
// Gated by PARTNER_SANDBOX_API_ENABLED=true. No API key required — see
// PHASE_7_20_PARTNER_SANDBOX_API_ADR.md D3.
export async function GET(req: NextRequest) {
  const ctx = {
    headers: req.headers,
    searchParams: new URL(req.url).searchParams,
    body: undefined,
  }
  const r = widgetCatalogHandler(ctx)
  return NextResponse.json(r.body, { status: r.status })
}
