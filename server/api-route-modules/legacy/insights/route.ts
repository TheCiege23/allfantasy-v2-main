import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { generateUserInsights, getUnreadInsights, markInsightRead, dismissInsight } from '@/lib/insights-engine'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'

export const GET = withApiUsage({ endpoint: "/api/legacy/insights", tool: "LegacyInsights" })(async (request: NextRequest) => {
  const auth = requireAuthOrOrigin(request)
  if (!auth.authenticated) {
    return forbiddenResponse(auth.error || 'Unauthorized')
  }

  const { searchParams } = new URL(request.url)
  const username = searchParams?.get('username')

  if (!username) {
    return NextResponse.json({ error: 'Username required' }, { status: 400 })
  }

  try {
    const insights = await getUnreadInsights(username, 20)
    return NextResponse.json({ insights, count: insights.length })
  } catch (error) {
    console.error('Failed to fetch insights:', error)
    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/insights", tool: "LegacyInsights" })(async (request: NextRequest) => {
  const auth = requireAuthOrOrigin(request)
  if (!auth.authenticated) {
    return forbiddenResponse(auth.error || 'Unauthorized')
  }

  const ip = getClientIp(request)
  const rateLimitResult = consumeRateLimit({
    scope: 'legacy',
    action: 'insights_generate',
    ip,
    maxRequests: 3,
    windowMs: 60000,
    includeIpInKey: true,
  })

  if (!rateLimitResult.success) {
    return NextResponse.json({
      error: 'Rate limited. Please wait before trying again.',
      retryAfter: rateLimitResult.retryAfterSec,
    }, { status: 429 })
  }

  try {
    const body = await request.json()
    const { username, leagueId } = body

    if (!username) {
      return NextResponse.json({ error: 'Username required' }, { status: 400 })
    }

    const result = await generateUserInsights(username, username, leagueId)
    return NextResponse.json({
      insights: result.insights,
      count: result.insights.length,
      audit: result.audit,
    })
  } catch (error) {
    console.error('Failed to generate insights:', error)
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 })
  }
})

export const PATCH = withApiUsage({ endpoint: "/api/legacy/insights", tool: "LegacyInsights" })(async (request: NextRequest) => {
  const auth = requireAuthOrOrigin(request)
  if (!auth.authenticated) {
    return forbiddenResponse(auth.error || 'Unauthorized')
  }

  try {
    const body = await request.json()
    const { insightId, action } = body

    if (!insightId || !action) {
      return NextResponse.json({ error: 'insightId and action required' }, { status: 400 })
    }

    if (action === 'read') {
      await markInsightRead(insightId)
    } else if (action === 'dismiss') {
      await dismissInsight(insightId)
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to update insight:', error)
    return NextResponse.json({ error: 'Failed to update insight' }, { status: 500 })
  }
})

