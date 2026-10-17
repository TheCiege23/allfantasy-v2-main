import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { reviewSeasonOpeningStandings } from '@/lib/tournament/seasonScoreLedger'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const id = z.string().trim().min(1).max(200)
const command = z.object({ tournamentId: id, freezeId: id, throughPeriod: z.number().int().min(1).max(30) }).strict()
const headers = { 'Cache-Control': 'no-store' }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    let raw: unknown
    try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const input = command.parse(raw)
    return NextResponse.json(await reviewSeasonOpeningStandings(session.user.id, input.tournamentId, input.freezeId, input.throughPeriod), { headers })
  } catch (e) {
    if (e instanceof BlueprintOperationError) return NextResponse.json({ error: e.message }, { status: e.status, headers })
    if (e instanceof z.ZodError) return NextResponse.json({ error: 'Choose an opening scoring week.' }, { status: 400, headers })
    return NextResponse.json({ error: 'Standings verification is unavailable. Retry after checking the saved scoring weeks.' }, { status: 409, headers })
  }
}
