import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import {
  generateEliminationPage,
  generateFinalStagePreview,
  generateChopWeekWaiverRecap,
  generateWeeklyGuillotineRecap,
} from '@/lib/guillotine/ai/storylineGenerator'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  void req
  return NextResponse.json({ ok: true, message: 'Guilly storyline cron tick.' })
}

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate

  let body: {
    seasonId?: string
    type?: 'weekly_recap' | 'elimination_page' | 'waiver_war' | 'finals_preview'
    scoringPeriod?: number
    eliminationId?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const seasonId = body.seasonId?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  switch (body.type) {
    case 'elimination_page':
      if (!body.eliminationId) return NextResponse.json({ error: 'eliminationId required' }, { status: 400 })
      return NextResponse.json({ storyline: await generateEliminationPage(body.eliminationId) })
    case 'waiver_war':
      if (body.scoringPeriod == null) return NextResponse.json({ error: 'scoringPeriod required' }, { status: 400 })
      return NextResponse.json({ storyline: await generateChopWeekWaiverRecap(seasonId, body.scoringPeriod) })
    case 'finals_preview':
      return NextResponse.json({ storyline: await generateFinalStagePreview(seasonId) })
    default:
      if (body.scoringPeriod == null) return NextResponse.json({ error: 'scoringPeriod required' }, { status: 400 })
      return NextResponse.json({ storyline: await generateWeeklyGuillotineRecap(seasonId, body.scoringPeriod) })
  }
}
