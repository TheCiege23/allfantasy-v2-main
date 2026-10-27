import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { getPirateDashboard, seedPirateClaims } from '@/lib/pirate/service'
import { isPirateLeague, readPirateRules } from '@/lib/pirate/rules'

export const dynamic = 'force-dynamic'

async function userId() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const actor = await userId()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const access = await resolveLeagueMembership(leagueId, actor)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    await seedPirateClaims(leagueId)
    return NextResponse.json(await getPirateDashboard(leagueId, actor))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pirate League unavailable' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const actor = await userId()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const gate = await assertLeagueCommissioner(leagueId, actor)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!isPirateLeague(gate.league)) return NextResponse.json({ error: 'Not a Pirate League' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const current = readPirateRules(gate.league.settings)
  const protectionLimit = body.protectionLimit == null ? current.protectionLimit : Number(body.protectionLimit)
  const claimHours = body.claimHours == null ? current.claimHours : Number(body.claimHours)
  const selectionHours = body.selectionHours == null ? current.selectionHours : Number(body.selectionHours)
  const overflowGraceHours = body.overflowGraceHours == null ? current.overflowGraceHours : Number(body.overflowGraceHours)
  if (!Number.isInteger(protectionLimit) || protectionLimit < 1 || protectionLimit > 10 ||
      !Number.isInteger(claimHours) || claimHours < 1 || claimHours > 72 ||
      !Number.isInteger(selectionHours) || selectionHours < 1 || selectionHours > 72 ||
      !Number.isInteger(overflowGraceHours) || overflowGraceHours < 0 || overflowGraceHours > 72 ||
      (body.playoffClaims != null && typeof body.playoffClaims !== 'boolean')) {
    return NextResponse.json({ error: 'Invalid Pirate League settings' }, { status: 400 })
  }
  const settings = gate.league.settings && typeof gate.league.settings === 'object' && !Array.isArray(gate.league.settings)
    ? gate.league.settings as Record<string, unknown> : {}
  const conceptRules = settings.conceptRules && typeof settings.conceptRules === 'object' && !Array.isArray(settings.conceptRules)
    ? settings.conceptRules as Record<string, unknown> : {}
  const extensions = conceptRules.extensions && typeof conceptRules.extensions === 'object' && !Array.isArray(conceptRules.extensions)
    ? conceptRules.extensions as Record<string, unknown> : {}
  const pirate = {
    protectionLimit, claimHours, selectionHours, overflowGraceHours,
    playoffClaims: body.playoffClaims == null ? current.playoffClaims : body.playoffClaims,
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...settings, conceptRules: { ...conceptRules, extensions: { ...extensions, pirate } } } as Prisma.InputJsonValue },
  })
  return NextResponse.json({ rules: pirate })
}
