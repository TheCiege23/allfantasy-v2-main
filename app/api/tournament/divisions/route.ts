import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { DivisionsBlueprintError } from '@/lib/tournament/divisions/blueprint'
import { DivisionsOperationError, saveDivisionsBlueprint, updateDivisionsBlueprint } from '@/lib/tournament/divisions/divisionsStore'
import {
  addCoCommissioner, advanceRound, callTies, closeAndPlace, commitSeeding, confirmCorrectionsClosed, followTournament, joinTournament,
  leaveTournament, markRevealSeen, notifyBubble, openRegistration, provisionLeagues, removeCoCommissioner, setDraftTime,
} from '@/lib/tournament/divisions/lifecycle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const id = z.string().trim().min(1).max(200)
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), plan: z.unknown() }),
  z.object({ action: z.literal('update'), tournamentId: id, plan: z.unknown() }),
  // registration
  z.object({ action: z.literal('open_registration'), tournamentId: id, closesAt: z.string().datetime({ offset: true }), allowPreference: z.boolean(), allowGrouping: z.boolean() }),
  z.object({ action: z.literal('join'), tournamentId: id, preference: z.union([z.literal(0), z.literal(1), z.null()]), ref: z.string().trim().max(80).nullable() }),
  z.object({ action: z.literal('leave'), tournamentId: id }),
  z.object({ action: z.literal('follow'), tournamentId: id }),
  z.object({ action: z.literal('close_and_place'), tournamentId: id }),
  z.object({ action: z.literal('provision_leagues'), tournamentId: id }),
  z.object({ action: z.literal('reveal_seen'), tournamentId: id }),
  z.object({ action: z.literal('set_draft_time'), tournamentId: id, tournamentLeagueId: id, at: z.string().datetime({ offset: true }) }),
  // staff
  z.object({ action: z.literal('add_co_commissioner'), tournamentId: id, username: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('remove_co_commissioner'), tournamentId: id, assigneeId: id }),
  // control
  z.object({ action: z.literal('confirm_corrections'), tournamentId: id, week: z.number().int().min(1).max(30) }),
  z.object({ action: z.literal('call_ties'), tournamentId: id, calls: z.record(z.string().max(200), z.number().int().min(-1000).max(1000)) }),
  z.object({ action: z.literal('commit_seeding'), tournamentId: id }),
  z.object({ action: z.literal('notify_bubble'), tournamentId: id }),
  z.object({ action: z.literal('advance_round'), tournamentId: id, round: z.number().int().min(1).max(10), overrides: z.record(z.string().max(40), id).default({}) }),
])

/** Every divisions-format action: plan, registration, placement, reveal, seeding and rounds. */
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
    switch (input.action) {
      case 'save': return NextResponse.json({ tournamentId: await saveDivisionsBlueprint(userId, input.plan) }, { status: 201 })
      case 'update': return NextResponse.json({ ok: true, ...await updateDivisionsBlueprint(userId, input.tournamentId, input.plan) })
      case 'open_registration': return NextResponse.json(await openRegistration(userId, input.tournamentId, input))
      case 'join': return NextResponse.json(await joinTournament(userId, input.tournamentId, input))
      case 'leave': return NextResponse.json(await leaveTournament(userId, input.tournamentId))
      case 'follow': return NextResponse.json(await followTournament(userId, input.tournamentId))
      case 'close_and_place': return NextResponse.json(await closeAndPlace(userId, input.tournamentId))
      case 'provision_leagues': return NextResponse.json(await provisionLeagues(userId, input.tournamentId))
      case 'reveal_seen': return NextResponse.json(await markRevealSeen(userId, input.tournamentId))
      case 'set_draft_time': return NextResponse.json(await setDraftTime(userId, input.tournamentId, input.tournamentLeagueId, input.at))
      case 'add_co_commissioner': return NextResponse.json(await addCoCommissioner(userId, input.tournamentId, input.username))
      case 'remove_co_commissioner': return NextResponse.json(await removeCoCommissioner(userId, input.tournamentId, input.assigneeId))
      case 'confirm_corrections': return NextResponse.json(await confirmCorrectionsClosed(userId, input.tournamentId, input.week))
      case 'call_ties': return NextResponse.json(await callTies(userId, input.tournamentId, input.calls))
      case 'commit_seeding': return NextResponse.json(await commitSeeding(userId, input.tournamentId))
      case 'notify_bubble': return NextResponse.json(await notifyBubble(userId, input.tournamentId))
      case 'advance_round': return NextResponse.json(await advanceRound(userId, input.tournamentId, input.round, input.overrides))
    }
  } catch (e) {
    if (e instanceof DivisionsBlueprintError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 400 })
    if (e instanceof DivisionsOperationError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[tournament/divisions] Operation failed', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Could not complete that. Please try again.' }, { status: 500 })
  }
}
