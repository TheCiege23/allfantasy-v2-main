import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { QUIZ_TRADES, calculatePreferences } from '@/lib/trade-quiz-data'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export const GET = withApiUsage({ endpoint: "/api/legacy/trade/preferences", tool: "LegacyTradePreferences" })(async (req: NextRequest) => {
  const url = new URL(req.url)
  const gate = await requireLegacySleeperIdentity(req, {
    requestedUsername: url.searchParams?.get('sleeper_username')?.trim() ?? null,
    rateLimit: { action: 'trade_preferences_read', maxRequests: 60, windowMs: 60_000 },
  })
  if (!gate.ok) return gate.response
  const sleeperUsername = gate.identity.sleeperUsername.toLowerCase()

  const prefs = await prisma.tradePreferences.findUnique({
    where: { sleeperUsername },
  })

  return NextResponse.json({
    hasCompletedQuiz: prefs?.quizCompleted ?? false,
    preferences: prefs ? {
      youthVsProduction: prefs.youthVsProduction,
      consolidationVsDepth: prefs.consolidationVsDepth,
      picksVsPlayers: prefs.picksVsPlayers,
      riskTolerance: prefs.riskTolerance,
      qbPriority: prefs.qbPriority,
      tePriority: prefs.tePriority,
    } : null,
    quizTrades: QUIZ_TRADES,
  })
})

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/preferences", tool: "LegacyTradePreferences" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    // A write keyed on the username — previously anyone could overwrite anyone's quiz
    // preferences by naming them.
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'trade_preferences_write', maxRequests: 20, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername.toLowerCase()
    const responses = body.responses as Array<{ tradeId: number; choice: 'A' | 'B' }>


    if (!Array.isArray(responses) || responses.length < 5) {
      return NextResponse.json({ error: 'Must answer at least 5 questions' }, { status: 400 })
    }

    const calculatedPrefs = calculatePreferences(responses)

    const prefs = await prisma.tradePreferences.upsert({
      where: { sleeperUsername },
      create: {
        sleeperUsername,
        ...calculatedPrefs,
        quizCompleted: true,
        quizResponses: responses,
      },
      update: {
        ...calculatedPrefs,
        quizCompleted: true,
        quizResponses: responses,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      preferences: {
        youthVsProduction: prefs.youthVsProduction,
        consolidationVsDepth: prefs.consolidationVsDepth,
        picksVsPlayers: prefs.picksVsPlayers,
        riskTolerance: prefs.riskTolerance,
        qbPriority: prefs.qbPriority,
        tePriority: prefs.tePriority,
      },
    })
  } catch (e) {
    console.error('Trade preferences error:', e)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }
})

