/**
 * The league's group (lib/league-groups/leagueGroups.ts).
 * GET: any league member — the group name, whether they can change it, and (for a commissioner) the
 * names of the groups they have already made. PATCH: a commissioner with league rights.
 *
 * A group name is not a format rule, so a rules-lock vote does not freeze it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { applyLeagueGroup, planLeagueGroupPatch, readLeagueGroup } from '@/lib/league-groups/leagueGroups'
import { groupNamesSetBy } from '@/lib/league-groups/leagueGroupsRead'

export const dynamic = 'force-dynamic'

async function sessionUser(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  const canEdit = await canCommissionerAct(leagueId, userId, 'league')
  const group = readLeagueGroup(league.settings)
  return NextResponse.json({
    group: group ? { name: group.name } : null,
    canEdit,
    suggestions: canEdit ? await groupNamesSetBy(userId).catch(() => []) : [],
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!(await canCommissionerAct(leagueId, userId, 'league'))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const plan = planLeagueGroupPatch(await req.json().catch(() => null), userId)
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  const next = applyLeagueGroup(league.settings, plan.value)
  await prisma.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
  return NextResponse.json({ group: plan.value ? { name: plan.value.name } : null })
}
