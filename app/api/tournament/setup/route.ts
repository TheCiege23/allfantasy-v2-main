import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  BlueprintOperationError, removeBlueprintStaff, saveSeasonBlueprint,
  setBlueprintStaff, updateSeasonBlueprint, checkBlueprintCalendar, publishSeasonRules,
} from '@/lib/tournament/seasonBlueprintStore'
import { z } from 'zod'
import {
  assignParticipantsToLeagues, buildConferencesAndLeagues,
  launchTournamentShell, openRegistration,
} from '@/lib/tournament/setupEngine'
import { assertTournamentCommissioner } from '@/lib/tournament/shellAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const id = z.string().trim().min(1).max(200)
const blueprintActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('blueprint_check_calendar'), tournamentId: id, revision: id }),
  z.object({ action: z.literal('blueprint_publish_rules'), tournamentId: id, revision: id, digest: z.string().regex(/^[a-f0-9]{64}$/), acceptExcludedGames: z.boolean(), acceptPendingGames: z.boolean() }),
  z.object({ action: z.literal('save_blueprint'), config: z.unknown() }),
  z.object({ action: z.literal('blueprint_update'), tournamentId: id, revision: id, config: z.unknown() }),
  z.object({
    action: z.literal('blueprint_add_staff'), tournamentId: id,
    username: z.string().trim().min(1).max(80),
    role: z.enum(['viewer', 'co_commissioner']).default('viewer'),
  }),
  z.object({ action: z.literal('blueprint_remove_staff'), tournamentId: id, assigneeId: id }),
])

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const body = raw as Record<string, unknown>
  if (typeof body.action === 'string' && (body.action === 'save_blueprint' || body.action.startsWith('blueprint_'))) {
    try {
      const input = blueprintActionSchema.parse(body)
      switch (input.action) {
        case 'blueprint_check_calendar':
          return NextResponse.json({ calendar: await checkBlueprintCalendar(userId, input.tournamentId, input.revision) })
        case 'blueprint_publish_rules':
          return NextResponse.json(await publishSeasonRules(userId, input.tournamentId, input.revision, input.digest, input.acceptExcludedGames, input.acceptPendingGames))
        case 'save_blueprint':
          return NextResponse.json({ tournamentId: await saveSeasonBlueprint(userId, input.config) }, { status: 201 })
        case 'blueprint_update':
          return NextResponse.json({ ok: true, ...await updateSeasonBlueprint(userId, input.tournamentId, input.revision, input.config) })
        case 'blueprint_add_staff':
          await setBlueprintStaff(userId, input.tournamentId, input.username, input.role)
          return NextResponse.json({ ok: true })
        case 'blueprint_remove_staff':
          await removeBlueprintStaff(userId, input.tournamentId, input.assigneeId)
          return NextResponse.json({ ok: true })
      }
    } catch (e) {
      if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues.map(i => i.message).join(' ') }, { status: 400 })
      if (e instanceof BlueprintOperationError) return NextResponse.json({ error: e.message }, { status: e.status })
      console.error('[tournament/blueprint] Operation failed', e)
      return NextResponse.json({ error: 'Could not update the tournament plan. Please try again.' }, { status: 500 })
    }
  }

  const tournamentId = typeof body.tournamentId === 'string' ? body.tournamentId.trim() : ''
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })
  try { await assertTournamentCommissioner(tournamentId, userId, true) } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['blueprint', 'rules_published'].includes(shell.status)) {
    return NextResponse.json({ error: 'This is a planning preview. Live setup actions are unavailable.' }, { status: 409 })
  }
  try {
    switch (body.action) {
      case 'build_leagues': await buildConferencesAndLeagues(tournamentId, shell.namingMode); break
      case 'open_registration': await openRegistration(tournamentId); break
      case 'assign_participants': await assignParticipantsToLeagues(tournamentId); break
      case 'launch': await launchTournamentShell(tournamentId); break
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Setup failed' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, shell: await prisma.tournamentShell.findUnique({ where: { id: tournamentId } }) })
}
