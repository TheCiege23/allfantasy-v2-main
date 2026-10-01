import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { prisma } from "@/lib/prisma"
import { getAiOpponentsSettings } from "@/lib/ai/opponents/leagueSettings"
import { ensureBotProfilesSeeded } from "@/lib/ai/opponents/seedProfiles"
import { getBotProfileByArchetype } from "@/lib/ai/opponents/botProfiles"
import type { BotArchetypeId } from "@/lib/ai/opponents/types"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const rows = await prisma.aiOpponentTeamAssignment.findMany({
    where: { leagueId: params.leagueId },
    include: { profile: true, team: { select: { id: true, teamName: true, externalId: true } } },
  })
  return NextResponse.json({ assignments: rows })
}

export async function POST(req: Request, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })
  if (!getAiOpponentsSettings(league.settings).enabled) {
    return NextResponse.json({ error: "Enable AI opponents in league settings first" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    leagueTeamId: string
    archetypeId?: BotArchetypeId
    isTakeover?: boolean
    thinkSpeed?: string
  }
  if (!body.leagueTeamId) return NextResponse.json({ error: "leagueTeamId required" }, { status: 400 })

  const team = await prisma.leagueTeam.findFirst({
    where: { id: body.leagueTeamId, leagueId: params.leagueId },
  })
  if (!team) return NextResponse.json({ error: "Team not in league" }, { status: 404 })

  await ensureBotProfilesSeeded()
  const arch = body.archetypeId ?? "balanced_builder"
  const prof = getBotProfileByArchetype(arch)
  if (!prof) return NextResponse.json({ error: "Invalid archetype" }, { status: 400 })

  const dbProfile = await prisma.aiOpponentProfile.findUnique({ where: { botId: prof.botId } })
  if (!dbProfile) return NextResponse.json({ error: "Bot profile missing — run seed" }, { status: 500 })

  const assignment = await prisma.aiOpponentTeamAssignment.upsert({
    where: { leagueTeamId: body.leagueTeamId },
    create: {
      leagueId: params.leagueId,
      leagueTeamId: body.leagueTeamId,
      botProfileId: dbProfile.id,
      isTakeover: Boolean(body.isTakeover),
      thinkSpeed: body.thinkSpeed ?? "normal",
    },
    update: {
      botProfileId: dbProfile.id,
      isTakeover: Boolean(body.isTakeover),
      thinkSpeed: body.thinkSpeed ?? "normal",
      paused: false,
    },
    include: { profile: true },
  })

  return NextResponse.json({ assignment })
}
