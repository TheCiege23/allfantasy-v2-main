import { NextRequest, NextResponse } from 'next/server'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { recordTradeSurfaceShadow } from '@/lib/decision-os/trade/surfaceShadow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// AF_TRADE_UNIFICATION_BRIEF: this endpoint previously returned a HARDCODED
// placeholder analysis (grade B/B, "counter") for every trade, behind a paid
// entitlement — a direct violation of the honesty positioning. Until the keeper
// surface consumes the canonical trade decision (Phase 2+ convergence), it now
// says so plainly instead of fabricating grades. The keeper WAR ROOM trade
// analysis (lib/keeper-war-room/keeperTradeEngine.ts via
// /api/leagues/[leagueId]/keeper-war-room/trade-analyze) is real and unaffected.
export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate

  let body: { tradeId?: string; leagueId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.tradeId || !body.leagueId) {
    return NextResponse.json({ error: 'tradeId and leagueId required' }, { status: 400 })
  }

  // Telemetry keeps measuring demand for this surface while it's unavailable.
  recordTradeSurfaceShadow({
    surface: 'keeper',
    userId: typeof gate === 'string' ? gate : null,
    leagueId: body.leagueId,
    surfaceVerdict: null,
    surfaceAnalysisMode: 'coming_soon',
  })

  return NextResponse.json(
    {
      available: false,
      status: 'coming_soon',
      message:
        'Keeper-adjusted trade analysis is coming soon. For a full keeper trade breakdown today, use the Keeper War Room trade analyzer.',
      alternative: {
        label: 'Keeper War Room trade analysis',
        endpoint: '/api/leagues/{leagueId}/keeper-war-room/trade-analyze',
      },
    },
    { status: 501 },
  )
}
