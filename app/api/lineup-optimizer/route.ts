import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { optimizeLineup, LineupOptimizerInputSchema } from '@/lib/lineup-optimizer/lineup-optimizer-engine'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    // Plan gate before any rate-limit spend or AI call: `pro_lineup_optimizer` (lib/monetization/entitlements.ts).
    const gate = await requireFeatureEntitlement({ userId: session.user.id, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'pro_lineup_optimizer' })
    if (!gate.ok) return gate.response
    const body = await request.json()
    const parsed = LineupOptimizerInputSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    const result = optimizeLineup(parsed.data)
    return NextResponse.json({ data: result })
  } catch (err: any) {
    console.error('[lineup-optimizer] POST error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
