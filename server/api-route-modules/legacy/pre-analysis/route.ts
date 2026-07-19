import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { 
  runPreAnalysis, 
  getPreAnalysisStatus, 
  triggerBackgroundPreAnalysis 
} from '@/lib/trade-pre-analysis'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'

export const GET = withApiUsage({ endpoint: "/api/legacy/pre-analysis", tool: "LegacyPreAnalysis" })(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const username = searchParams?.get('username')
  const leagueId = searchParams?.get('leagueId')

  if (!username || !leagueId) {
    return NextResponse.json({ 
      error: 'Username and leagueId required' 
    }, { status: 400 })
  }

  try {
    const status = await getPreAnalysisStatus(username, leagueId)
    return NextResponse.json(status)
  } catch (error) {
    console.error('Pre-analysis status check failed:', error)
    return NextResponse.json({ 
      error: 'Failed to check analysis status' 
    }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/pre-analysis", tool: "LegacyPreAnalysis" })(async (request: NextRequest) => {
  const ip = getClientIp(request)
  const rateLimitResult = consumeRateLimit({
    scope: 'legacy',
    action: 'pre_analysis',
    ip,
    maxRequests: 5,
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
    const { username, leagueId, background } = body

    if (!username || !leagueId) {
      return NextResponse.json({ 
        error: 'Username and leagueId required' 
      }, { status: 400 })
    }

    if (background) {
      triggerBackgroundPreAnalysis(username, leagueId)
      return NextResponse.json({ 
        status: 'analyzing',
        message: 'Pre-analysis started in background' 
      })
    }

    const result = await runPreAnalysis(username, leagueId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Pre-analysis failed:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to run pre-analysis',
    }, { status: 500 })
  }
})

