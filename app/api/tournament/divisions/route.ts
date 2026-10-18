import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { DivisionsBlueprintError } from '@/lib/tournament/divisions/blueprint'
import { DivisionsOperationError, saveDivisionsBlueprint, updateDivisionsBlueprint } from '@/lib/tournament/divisions/divisionsStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const id = z.string().trim().min(1).max(200)
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), plan: z.unknown() }),
  z.object({ action: z.literal('update'), tournamentId: id, plan: z.unknown() }),
])

/** Save or update a divisions & conferences tournament plan (steps 1–2 of the planner). */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = actionSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const input = parsed.data
    if (input.action === 'save') return NextResponse.json({ tournamentId: await saveDivisionsBlueprint(userId, input.plan) }, { status: 201 })
    return NextResponse.json({ ok: true, ...await updateDivisionsBlueprint(userId, input.tournamentId, input.plan) })
  } catch (e) {
    if (e instanceof DivisionsBlueprintError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 400 })
    if (e instanceof DivisionsOperationError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[tournament/divisions] Operation failed', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Could not save the tournament plan. Please try again.' }, { status: 500 })
  }
}
