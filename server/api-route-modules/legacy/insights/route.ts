import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { generateUserInsights, getUnreadInsights, markInsightRead, dismissInsight } from '@/lib/insights-engine'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'

export const GET = withApiUsage({ endpoint: "/api/legacy/insights", tool: "LegacyInsights" })(async (request: NextRequest) => {
  /*
   * All three handlers were gated by `requireAuthOrOrigin`, which passes any anonymous caller
   * sending a matching `Origin` header: GET read anyone's insights by username, POST generated
   * them for anyone, and PATCH marked any insight read/dismissed by id. The username is now
   * only compared; data is selected by the caller's own linked Sleeper identity. allowGuest:
   * InsightsPanel renders on the af-legacy surface a guest reaches after importing.
   */
  const { searchParams } = new URL(request.url)
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername: searchParams?.get('username'),
  })
  if (!gate.ok) return gate.response
  const username = gate.identity.sleeperUsername

  try {
    const insights = await getUnreadInsights(username, 20)
    return NextResponse.json({ insights, count: insights.length })
  } catch (error) {
    console.error('Failed to fetch insights:', error)
    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/insights", tool: "LegacyInsights" })(async (request: NextRequest) => {
  // CSRF protection for a state-changing call -- legitimate, but NOT authentication.
  if (!validateRequestOrigin(request)) return forbiddenResponse('Invalid request origin')

  const ip = getClientIp(request)
  const rateLimitResult = consumeRateLimit({
    scope: 'legacy',
    action: 'insights_generate',
    ip,
    maxRequests: 3,
    windowMs: 60000,
  })

  if (!rateLimitResult.success) {
    return NextResponse.json({
      error: 'Rate limited. Please wait before trying again.',
      retryAfter: rateLimitResult.retryAfterSec,
    }, { status: 429 })
  }

  try {
    const body = await request.json()
    const { leagueId } = body

    const gate = await requireLegacySleeperIdentity(request, {
      allowGuest: true,
      requestedUsername: typeof body?.username === 'string' ? body.username : null,
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

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
  // CSRF protection for a state-changing call -- legitimate, but NOT authentication.
  if (!validateRequestOrigin(request)) return forbiddenResponse('Invalid request origin')

  const gate = await requireLegacySleeperIdentity(request, { allowGuest: true })
  if (!gate.ok) return gate.response

  try {
    const body = await request.json()
    const { insightId, action } = body

    if (!insightId || !action) {
      return NextResponse.json({ error: 'insightId and action required' }, { status: 400 })
    }

    // The insight must be the caller's. Someone else's reads exactly like a missing one.
    const owned = await prisma.aIInsight.findUnique({
      where: { id: String(insightId) },
      select: { userId: true },
    })
    if (!owned || owned.userId.trim().toLowerCase() !== gate.identity.sleeperUsername.toLowerCase()) {
      return NextResponse.json({ error: 'Insight not found' }, { status: 404 })
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

