import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { reviewSeasonOpeningWeek, finalizeSeasonOpeningWeek } from '@/lib/tournament/seasonScoreLedger'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const id = z.string().trim().min(1).max(200)
const base = { tournamentId: id, freezeId: id, key: id, period: z.number().int().min(1).max(30) }
const command = z.discriminatedUnion('action', [z.object({ ...base, action: z.literal('review') }).strict(), z.object({ ...base, action: z.literal('finalize'), revision: z.number().int().min(1).max(250), reviewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict()])
const headers = { 'Cache-Control': 'no-store' }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    let raw: unknown
    try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const input = command.parse(raw)
    const result = input.action === 'review' ? await reviewSeasonOpeningWeek(userId, input.tournamentId, input.freezeId, input.key, input.period) : await finalizeSeasonOpeningWeek(userId, input.tournamentId, input.freezeId, input.key, input.period, input.revision, input.reviewToken)
    return NextResponse.json(result, { headers })
  } catch (e) {
    if (e instanceof BlueprintOperationError) return NextResponse.json({ error: e.message }, { status: e.status, headers })
    if (e instanceof z.ZodError) return NextResponse.json({ error: 'Check the scoring review fields.' }, { status: 400, headers })
    return NextResponse.json({ error: 'Scoring verification is unavailable. Review the saved draft and rosters, then retry.' }, { status: 409, headers })
  }
}
