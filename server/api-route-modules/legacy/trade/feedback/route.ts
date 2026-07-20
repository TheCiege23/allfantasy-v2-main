import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/feedback", tool: "LegacyTradeFeedback" })(async (req: NextRequest) => {
  try {
    const body = await req.json()

    /*
     * Replaces a hand-rolled limiter that never fired: it did `if (!allowed)` on
     * `consumeRateLimit`'s RESULT OBJECT, which is always truthy, so the 429 branch was
     * dead. PR #278 fixes that same line independently — expect a conflict on this hunk
     * and keep this version, which routes the limit through the shared gate.
     */
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'trade_feedback', maxRequests: 20, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername.slice(0, 50)
    const leagueId = String(body.league_id || '').trim().slice(0, 50)
    const leagueName = body.league_name ? String(body.league_name).slice(0, 100) : null
    const targetManager = String(body.target_manager || '').trim().slice(0, 50)
    const aiGrade = body.ai_grade ? String(body.ai_grade).slice(0, 10) : null
    const rating = parseInt(body.rating, 10)

    const youGive = Array.isArray(body.you_give) 
      ? body.you_give.filter((x: any) => typeof x === 'string').slice(0, 10).map((s: string) => s.slice(0, 100))
      : []
    const youReceive = Array.isArray(body.you_receive) 
      ? body.you_receive.filter((x: any) => typeof x === 'string').slice(0, 10).map((s: string) => s.slice(0, 100))
      : []

    if (!sleeperUsername) {
      return NextResponse.json({ error: 'Missing sleeper_username' }, { status: 400 })
    }
    if (!leagueId) {
      return NextResponse.json({ error: 'Missing league_id' }, { status: 400 })
    }
    if (!targetManager) {
      return NextResponse.json({ error: 'Missing target_manager' }, { status: 400 })
    }
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 })
    }
    if (youGive.length === 0 || youReceive.length === 0) {
      return NextResponse.json({ error: 'Invalid trade data' }, { status: 400 })
    }

    const feedback = await prisma.tradeFeedback.create({
      data: {
        sleeperUsername,
        leagueId,
        leagueName,
        targetManager,
        youGive,
        youReceive,
        aiGrade,
        rating,
      },
    })

    return NextResponse.json({ success: true, id: feedback.id })
  } catch (e) {
    console.error('trade feedback error', e)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/trade/feedback", tool: "LegacyTradeFeedback" })(async (req: NextRequest) => {
  try {
    const sessionCookie = cookies().get('admin_session')?.value
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = parseInt(req.nextUrl.searchParams?.get('limit') || '50', 10)
    const minRating = parseInt(req.nextUrl.searchParams?.get('min_rating') || '0', 10)
    const maxRating = parseInt(req.nextUrl.searchParams?.get('max_rating') || '5', 10)

    const feedback = await prisma.tradeFeedback.findMany({
      where: {
        rating: {
          gte: Math.max(1, minRating),
          lte: Math.min(5, maxRating),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        sleeperUsername: true,
        leagueName: true,
        targetManager: true,
        youGive: true,
        youReceive: true,
        aiGrade: true,
        rating: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ feedback })
  } catch (e) {
    console.error('get trade feedback error', e)
    return NextResponse.json({ error: 'Failed to get feedback' }, { status: 500 })
  }
})

