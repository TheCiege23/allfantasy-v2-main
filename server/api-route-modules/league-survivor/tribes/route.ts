import { isNativePlatform } from '@/lib/dashboard/platform-label'
/**
 * POST: Create Survivor tribes (commissioner only). PROMPT 349 QA.
 * Body: { formation: 'random'|'commissioner', rosterToTribeIndex?: Record<string, number>, tribeNames?: string[], seed?: number }
 * Rosters are resolved from league; if not provided, all league rosters are used.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { createTribes, getTribesWithMembers, setTribeName } from '@/lib/survivor/SurvivorTribeService'
import { bootstrapTribeChatMembers } from '@/lib/survivor/SurvivorChatMembershipService'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { composeTribeName, extractLeadingTribeIcon, stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (league && isNativePlatform(league.platform)) return NextResponse.json({ error: 'Native tribes are assigned by the system from the saved tribe setup after the draft.' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const formation = body.formation === 'commissioner' ? 'commissioner' : 'random'
  const rosterToTribeIndex = typeof body.rosterToTribeIndex === 'object' ? body.rosterToTribeIndex : undefined
  const tribeNames = Array.isArray(body.tribeNames) ? body.tribeNames : undefined
  const seed = typeof body.seed === 'number' ? body.seed : undefined

  let rosterIds: string[] = body.rosterIds
  if (!Array.isArray(rosterIds) || rosterIds.length === 0) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { id: true },
    })
    rosterIds = rosters.map((r) => r.id)
  }

  const result = await createTribes(leagueId, {
    rosterIds,
    formation,
    rosterToTribeIndex,
    tribeNames,
    seed,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await bootstrapTribeChatMembers(leagueId).catch((err) => {
    console.warn('[Survivor] Tribe chat bootstrap non-fatal:', err)
  })

  return NextResponse.json({ ok: true, tribes: result.tribes })
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })

  const tribes = await getTribesWithMembers(leagueId)
  return NextResponse.json({
    tribes: tribes.map((tribe) => ({
      ...tribe,
      emoji: extractLeadingTribeIcon(tribe.name),
      plainName: stripLeadingTribeIcon(tribe.name),
    })),
  })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const tribeId = typeof body.tribeId === 'string' ? body.tribeId.trim() : ''
  const name = typeof body.name === 'string' ? body.name : ''
  const emoji = typeof body.emoji === 'string' ? body.emoji : null
  if (!tribeId) return NextResponse.json({ error: 'tribeId required' }, { status: 400 })

  const finalName = composeTribeName(emoji, name).slice(0, 128)
  const result = await setTribeName(leagueId, tribeId, finalName)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true, tribeId, name: finalName, emoji: extractLeadingTribeIcon(finalName) })
}
