import { NextRequest, NextResponse } from 'next/server'
import { testKeyMetadataHandler } from '@/lib/decision-os/sdk/partner-sandbox-handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/sandbox/partner/test-key-metadata
// Returns the SHAPE of a sandbox API key's metadata only — the Phase 7.19
// fixture example, never a real credential. Gated by
// PARTNER_SANDBOX_API_ENABLED=true. No API key required — see
// PHASE_7_20_PARTNER_SANDBOX_API_ADR.md D3.
export async function GET(req: NextRequest) {
  const ctx = {
    headers: req.headers,
    searchParams: new URL(req.url).searchParams,
    body: undefined,
  }
  const r = testKeyMetadataHandler(ctx)
  return NextResponse.json(r.body, { status: r.status })
}
