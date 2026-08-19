/**
 * GET /api/intelligence/snapshot?leagueId=optional
 * Unified time context (UTC + user TZ), platform health, and optional validated league intelligence context.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { buildIntelligenceSnapshot } from '@/lib/intelligence/buildIntelligenceSnapshot'
import { IntelligenceQueryService } from '@/lib/intelligence/IntelligenceQueryService'
import { detectCommissionerIntelligenceIntent, buildCommissionerGrounding } from '@/lib/intelligence/chimmy/commissionerGrounding'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim() || null

  try {
    const snapshot = await buildIntelligenceSnapshot({ userId, leagueId })

    // G15.9 — optional commissioner-intelligence grounding (Chimmy). Additive + best-effort:
    // only when leagueId + commissioner intent (or ?commissioner=1) AND the user is a commissioner.
    // Never breaks the base snapshot.
    const q = req.nextUrl.searchParams.get('q') ?? ''
    const wantCommissioner = req.nextUrl.searchParams.get('commissioner') === '1' || detectCommissionerIntelligenceIntent(q)
    let commissionerIntelligence: unknown
    if (leagueId && wantCommissioner) {
      try {
        const access = await assertLeagueCommissioner(leagueId, userId)
        if (access.ok) {
          const service = new IntelligenceQueryService(prisma)
          commissionerIntelligence = await buildCommissionerGrounding({ service, leagueId, principal: { userId } })
        }
      } catch {
        /* best-effort: never break the base snapshot */
      }
    }

    return NextResponse.json(commissionerIntelligence ? { ...snapshot, commissionerIntelligence } : snapshot)
  } catch (e) {
    console.error('[intelligence/snapshot]', e)
    return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 })
  }
}
