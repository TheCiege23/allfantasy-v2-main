import { NextRequest, NextResponse } from 'next/server'
import { generateWaiverRecs } from '@/lib/redraft/ai/waiverAnalyzer'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate
  const userId = gate

  let body: { rosterId?: string; seasonId?: string; week?: number }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.rosterId || !body.seasonId || body.week == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const analysis = await generateWaiverRecs(userId, body.rosterId, body.seasonId, body.week)
  if (!analysis) return NextResponse.json({ error: 'Season or roster not found' }, { status: 404 })

  return NextResponse.json({
    recommendations: analysis.rankedAdds,
    analysis,
  })
}
