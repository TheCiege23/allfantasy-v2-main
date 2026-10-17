import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { freezeSeasonOpeningField, openSeasonRegistration, pauseSeasonRegistration, joinSeasonTournament, changeSeasonEntry, loadSeasonRegistration } from '@/lib/tournament/seasonRegistration'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const id = z.string().trim().min(1).max(200)
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), tournamentId: id, publicationId: id, closesAt: z.string().datetime({ offset: true }), waitlistLimit: z.number().int().min(0).max(192) }),
  z.object({ action: z.literal('freeze'), tournamentId: id, publicationId: id }),
  z.object({ action: z.literal('pause'), tournamentId: id }),
  z.object({ action: z.literal('join'), tournamentId: id, token: z.string().regex(/^[a-f0-9]{64}$/), publicationId: id, acceptedHash: z.string().min(1).max(200), acceptedRules: z.literal(true) }),
  z.object({ action: z.literal('withdraw'), tournamentId: id }),
  z.object({ action: z.literal('remove'), tournamentId: id, participantId: id, reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('restore'), tournamentId: id, participantId: id }),
])
function failure(e: unknown) {
  if (e instanceof BlueprintOperationError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof z.ZodError) return NextResponse.json({ error: 'Check the registration fields and accept the published rules.' }, { status: 400 })
  // Never log the request body, URL or invite token.
  return NextResponse.json({ error: 'Could not update registration. Please retry.' }, { status: 500 })
}
async function currentUser() {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  return session?.user?.id
}
export async function GET(req: NextRequest) {
  const userId = await currentUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ board: await loadSeasonRegistration(userId, id.parse(req.nextUrl.searchParams.get('tournamentId'))) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (e) { return failure(e) }
}
export async function POST(req: NextRequest) {
  const userId = await currentUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  try {
    const input = schema.parse(raw)
    switch (input.action) {
      case 'open': return NextResponse.json(await openSeasonRegistration(userId, input.tournamentId, input.publicationId, input.closesAt, input.waitlistLimit), { headers: { 'Cache-Control': 'no-store' } })
      case 'freeze': return NextResponse.json(await freezeSeasonOpeningField(userId, input.tournamentId, input.publicationId), { headers: { 'Cache-Control': 'no-store' } })
      case 'pause': return NextResponse.json(await pauseSeasonRegistration(userId, input.tournamentId))
      case 'join': return NextResponse.json(await joinSeasonTournament(userId, input.tournamentId, input.token, input.publicationId, input.acceptedHash))
      case 'withdraw': return NextResponse.json(await changeSeasonEntry(userId, input.tournamentId, 'withdraw'))
      case 'remove': return NextResponse.json(await changeSeasonEntry(userId, input.tournamentId, 'remove', input.participantId, input.reason))
      case 'restore': return NextResponse.json(await changeSeasonEntry(userId, input.tournamentId, 'restore', input.participantId))
    }
  } catch (e) { return failure(e) }
}
