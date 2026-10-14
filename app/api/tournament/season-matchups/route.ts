import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { previewSeasonOpeningMatchups, publishSeasonOpeningMatchups } from '@/lib/tournament/seasonScoreLedger'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const id = z.string().trim().min(1).max(200)
const base = { tournamentId: id, freezeId: id, key: id, period: z.number().int().min(1).max(30) }
const command = z.discriminatedUnion('action', [z.object({ ...base, action: z.literal('preview') }).strict(), z.object({ ...base, action: z.literal('publish'), previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict()])
const headers = { 'Cache-Control': 'no-store' }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    let raw: unknown
    try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const input = command.parse(raw)
    const result = input.action === 'preview' ? await previewSeasonOpeningMatchups(session.user.id, input.tournamentId, input.freezeId, input.key, input.period) : await publishSeasonOpeningMatchups(session.user.id, input.tournamentId, input.freezeId, input.key, input.period, input.previewToken)
    return NextResponse.json(result, { headers })
  } catch (e) {
    if (e instanceof BlueprintOperationError) return NextResponse.json({ error: e.message }, { status: e.status, headers })
    if (e instanceof z.ZodError) return NextResponse.json({ error: 'Check the matchup schedule fields.' }, { status: 400, headers })
    return NextResponse.json({ error: 'Matchup verification is unavailable. Verify the completed draft and prepared rosters, then preview again.' }, { status: 409, headers })
  }
}
