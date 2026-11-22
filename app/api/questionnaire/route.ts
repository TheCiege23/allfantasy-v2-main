import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { questionnaireSchema, sanitizeString } from '@/lib/validation'

export const POST = withApiUsage({ endpoint: "/api/questionnaire", tool: "Questionnaire" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const result = questionnaireSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid data' },
        { status: 400 }
      )
    }

    const data = result.data

    await prisma.questionnaireResponse.create({
      data: {
        email: sanitizeString(data.email),
        favoriteSport: data.favoriteSport,
        favoriteLeagueType: data.favoriteLeagueType,
        competitiveness: data.competitiveness,
        draftPreference: data.draftPreference,
        painPoint: data.painPoint,
        experimentalInterest: data.experimentalInterest,
        freeText: data.freeText ? sanitizeString(data.freeText) : null,
      }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Questionnaire error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
})
