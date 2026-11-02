import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { respondBetaRoleWorkflow, startBetaWhispererOffers, reviewBetaVeterans } from '@/lib/zombie/beta2025RoleWorkflows'

export const dynamic = 'force-dynamic'
const errorText = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientValidationError
  ? 'The workflow could not be updated. Refresh and try again.' : error instanceof Error ? error.message : 'The workflow could not be updated.'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, include: { league: { select: { userId: true } }, whispererRecord: true } })
  if (!z || z.sport !== 'NFL') return NextResponse.json({ supported: false, workflows: [] })
  const owner = z.league.userId === session.user.id
  const rows = await prisma.zombieRoleWorkflow.findMany({ where: { zombieLeagueId: z.id, status: { in: ['pending', 'review_required'] },
    ...(owner ? {} : { actorUserId: session.user.id }) }, orderBy: { createdAt: 'asc' } })
  const canStartDraw = owner && !z.whispererRecord && rows.length === 0 && ['setup', 'registering', 'active', 'in_progress'].includes(z.status)
  const rosters = owner && (canStartDraw || rows.some(r => r.kind === 'initial_offer' && r.status === 'review_required')) ?
    await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }) : []
  const names = rosters.length ? await prisma.zombieLeagueTeam.findMany({ where: { leagueId }, select: { rosterId: true, fantasyTeamName: true, displayName: true, isVeteran: true } }) : []
  return NextResponse.json({ supported: true, owner, nominees: rosters.map(r => ({ id: r.platformUserId, name: names.find(t => t.rosterId === r.id)?.fantasyTeamName || names.find(t => t.rosterId === r.id)?.displayName || 'Manager', veteran: names.find(t => t.rosterId === r.id)?.isVeteran ?? false })),
    canStartDraw, correctionHoldFromWeek: z.correctionHoldFromWeek,
    canAmbush: z.correctionHoldFromWeek == null && ['active', 'in_progress'].includes(z.status) && z.experienceMode !== 'simple' && !z.whispererRecord?.wasDefeated && z.whispererRecord?.userId === session.user.id && z.whispererRecord.ambushesRemaining > 0,
    workflows: rows.map(row => ({ id: row.id, kind: row.kind, status: row.status, week: row.week, deadlineAt: row.deadlineAt,
      offerIndex: row.kind === 'initial_offer' && row.actorUserId === session.user!.id ? (row.state as { index?: number }).index : undefined,
      canRespond: z.correctionHoldFromWeek == null && row.actorUserId === session.user!.id && row.status === 'pending',
      // No candidate order, target ID, inventory or hidden Whisperer identity goes to another manager.
      choices: row.kind === 'initial_offer' ? ['accept', 'decline'] : row.kind === 'survivor_bash' ? ['spare', 'infect'] :
        row.kind === 'whisperer_bash' ? ['spare', 'replace'] : ['decline', 'become_whisperer'] })) })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.leagueId !== 'string') return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(body.leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    if (body.action === 'eligibility') {
      if (!Array.isArray(body.veteranUserIds) || body.veteranUserIds.some(id => typeof id !== 'string') || typeof body.reason !== 'string') return NextResponse.json({ error: 'Eligible managers and review reason required' }, { status: 400 })
      return NextResponse.json(await reviewBetaVeterans(body.leagueId, session.user.id, body.veteranUserIds, body.reason))
    }
    if (body.action === 'start' || body.action === 'nominate') {
      const owner = await prisma.league.findUnique({ where: { id: body.leagueId }, select: { userId: true } })
      if (owner?.userId !== session.user.id) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
      if (body.action === 'nominate' && (typeof body.nomineeId !== 'string' || typeof body.reason !== 'string')) return NextResponse.json({ error: 'Nominee and review reason required' }, { status: 400 })
      return NextResponse.json(await startBetaWhispererOffers(body.leagueId, body.action === 'nominate' ?
        { actorId: session.user.id, nomineeId: body.nomineeId as string, reason: body.reason as string } : undefined))
    }
    if (typeof body.workflowId !== 'string' || typeof body.decision !== 'string') return NextResponse.json({ error: 'workflowId and decision required' }, { status: 400 })
    return NextResponse.json(await respondBetaRoleWorkflow(body.leagueId, body.workflowId, session.user.id, body.decision, typeof body.offerIndex === 'number' ? body.offerIndex : undefined))
  } catch (error) { return NextResponse.json({ error: errorText(error) }, { status: 409 }) }
}
