import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { runSeasonOutcomeEvidenceJob } from '@/lib/tournament/seasonOutcomeEvidenceWorker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store' }
const id = z.string().trim().min(1).max(200)
const inputSchema = z.object({ tournamentId: id, freezeId: id, leagueKey: id, period: z.number().int().min(1).max(30),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()

/** Owner-only, explicitly enabled internal candidate capture. Never returns raw provider rows. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
  try {
    const input = inputSchema.parse(raw)
    return NextResponse.json(await runSeasonOutcomeEvidenceJob(userId, input.tournamentId, input.freezeId,
      input.leagueKey, input.period, input.sourceDate), { headers })
  } catch (error) {
    if (error instanceof BlueprintOperationError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Check the evidence capture fields.' }, { status: 400, headers })
    return NextResponse.json({ error: 'Tournament evidence capture is unavailable. Retry later.' }, { status: 409, headers })
  }
}
