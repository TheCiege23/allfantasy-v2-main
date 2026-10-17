import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { prisma } from "@/lib/prisma"
import { getAiOpponentsSettings, mergeAiOpponentsSettings } from "@/lib/ai/opponents/leagueSettings"
import type { AiOpponentsLeagueSettings } from "@/lib/ai/opponents/types"

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

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  return NextResponse.json({
    aiOpponents: getAiOpponentsSettings(league.settings),
  })
}

export async function PATCH(req: Request, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<AiOpponentsLeagueSettings>
  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const current = (league.settings as Record<string, unknown>) || {}
  const next = mergeAiOpponentsSettings(current, body)

  await prisma.league.update({
    where: { id: params.leagueId },
    data: { settings: next as object },
  })

  return NextResponse.json({ ok: true, aiOpponents: getAiOpponentsSettings(next) })
}
