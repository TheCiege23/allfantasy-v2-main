import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
import { loadSeasonRecovery, proposeSeasonCorrection, requestSeasonWithdrawal, resolveSeasonRecovery } from '@/lib/tournament/seasonRecovery'
import { loadSeasonIntegrity, updateSeasonIntegrity } from '@/lib/tournament/seasonIntegrity'
import { recoveryId, recoveryReason, scoreCorrectionSchema } from '@/lib/tournament/seasonRecoveryContract'
import { runSeasonTournament } from '@/lib/tournament/seasonTournamentAutomation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
const headers = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ tournamentId: string }> }
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('withdraw'), participantId: recoveryId.optional(), reason: recoveryReason }).strict(),
  z.object({ action: z.literal('correct'), score: scoreCorrectionSchema, reason: recoveryReason }).strict(),
  z.object({ action: z.literal('resolve'), caseId: recoveryId, outcome: z.enum(['apply', 'retain', 'reopen']), reason: recoveryReason }).strict(),
  z.object({ action: z.literal('retry') }).strict(),
])
const querySchema = z.object({
  stage: z.coerce.number().int().min(1).max(3),
  period: z.coerce.number().int().min(1).max(30),
})

function failure(error: unknown) {
  if (error instanceof BlueprintOperationError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
  if (error instanceof z.ZodError) return NextResponse.json({ error: 'Check the recovery fields and provide a reason.' }, { status: 400, headers })
  return NextResponse.json({ error: 'Recovery could not be confirmed. Retry the same action.' }, { status: 500, headers })
}

export async function GET(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers })
  const { tournamentId } = await context.params
  try {
    const params = request.nextUrl.searchParams
    if (params.get('integrity') === '1') return NextResponse.json(await loadSeasonIntegrity(tournamentId, session.user.id), { headers })
    const selection = params.has('stage') || params.has('period') ? querySchema.parse({ stage: params.get('stage'), period: params.get('period') }) : undefined
    return NextResponse.json(await loadSeasonRecovery(session.user.id, tournamentId, selection?.stage, selection?.period), { headers })
  } catch (error) { return failure(error) }
}

export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers })
  const { tournamentId } = await context.params
  try {
    const body = await request.json().catch(() => null)
    if (request.nextUrl.searchParams.get('integrity') === '1') {
      await updateSeasonIntegrity(tournamentId, userId, body)
      return NextResponse.json({ saved: true }, { headers })
    }
    const input = actionSchema.parse(body)
    switch (input.action) {
      case 'withdraw': return NextResponse.json(await requestSeasonWithdrawal(userId, tournamentId, input.reason, input.participantId), { headers })
      case 'correct': return NextResponse.json(await proposeSeasonCorrection(userId, tournamentId, input.score, input.reason), { headers })
      case 'resolve': return NextResponse.json(await resolveSeasonRecovery(userId, tournamentId, input.caseId, input.outcome, input.reason), { headers })
      case 'retry': {
        const shell = await prisma.tournamentShell.findFirst({
          where: { id: tournamentId, commissionerId: userId, status: 'rules_published',
            auditLogs: { some: { action: 'season_rules_published' } } }, select: { id: true },
        })
        if (!shell) throw new BlueprintOperationError('Tournament recovery is unavailable.', 404)
        const run = await runSeasonTournament(tournamentId)
        return NextResponse.json({ processed: run.processed, advanced: run.advanced, failed: run.errors.length }, { headers })
      }
    }
  } catch (error) { return failure(error) }
}
