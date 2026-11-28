/**
 * AI insight for a single player trend (PROMPT 135).
 * GET ?playerId=...&sport=NFL
 *
 * 🛑 Three model calls per request (DeepSeek, Grok, OpenAI — lib/player-trend/TrendDetectionAI.ts). It answered
 * anonymous callers with no limit. Since 2026-11-28 (owner): sign-in first, then the durable daily cap
 * AI_COST_GATES.player_trend_insight immediately before the model calls, so a bad request costs no allowance.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { getTrendFeedItemForPlayer } from '@/lib/player-trend/TrendDetectionService'
import { getTrendAIInsight } from '@/lib/player-trend/TrendDetectionAI'
import { isSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json(
        { error: 'Sign in required', code: 'sign_in_required', message: "Sign in to use Chimmy's trend insights." },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const playerId = searchParams?.get('playerId')?.trim()
    const sport = searchParams?.get('sport')?.trim()

    if (!playerId || !sport) {
      return NextResponse.json(
        { error: 'Missing playerId or sport' },
        { status: 400 }
      )
    }
    if (!isSupportedSport(sport)) {
      return NextResponse.json(
        { error: 'Invalid sport' },
        { status: 400 }
      )
    }

    const item = await getTrendFeedItemForPlayer(playerId, sport)
    if (!item) {
      return NextResponse.json(
        { error: 'No trend data for this player/sport' },
        { status: 404 }
      )
    }

    // The daily cap (429), immediately before the three model calls.
    const gated = await aiCostGate(request, 'player_trend_insight', userId, { email: session?.user?.email ?? null })
    if (gated) return gated

    const insight = await getTrendAIInsight(item)
    return NextResponse.json({
      data: item,
      insight,
    })
  } catch (e) {
    console.error('[player-trend/insight]', e)
    return NextResponse.json(
      { error: 'Failed to fetch trend insight' },
      { status: 500 }
    )
  }
}
