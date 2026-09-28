import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { isAdminEmailAllowed, isAdminRole } from "@/lib/adminAuth"
import { getLeagueConfiguration } from "@/lib/commissioner-settings"
import { validateCommissionerPatch } from "@/lib/commissioner-settings"
import type { LeagueSettingsPatch } from "@/lib/commissioner-settings/types"
import { prisma } from "@/lib/prisma"
import { STRUCTURAL_LEAGUE_KEYS, structuralPatchRefusal } from "@/lib/league/structuralSettingsLock"
import { leagueChatThreadLinkRefusal } from "@/lib/league/leagueChatThreadLink"

type SessionUser = {
  id?: string
  role?: string | null
  email?: string | null
}

function isAdminUser(user: SessionUser | null | undefined): boolean {
  return Boolean(user && (isAdminRole(user.role) || isAdminEmailAllowed(user.email)))
}

async function assertCommissionerOrAdmin(leagueId: string, user: SessionUser | null | undefined) {
  if (!user?.id) throw new Error("Unauthorized")
  if (isAdminUser(user)) return
  await assertCommissioner(leagueId, user.id)
}

export async function GET(
  _req: Request,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const config = await getLeagueConfiguration(params.leagueId)
  if (!config) return NextResponse.json({ error: "League not found" }, { status: 404 })
  return NextResponse.json(config)
}

export async function PATCH(
  req: Request,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    await assertCommissionerOrAdmin(params.leagueId, session?.user)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as LeagueSettingsPatch
  const validation = validateCommissionerPatch(body)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  // Only this league's own chat may be linked (lib/league/leagueChatThreadLink.ts).
  const chatLinkRefusal = leagueChatThreadLinkRefusal(params.leagueId, body?.leagueChatThreadId)
  if (chatLinkRefusal) return NextResponse.json({ error: chatLinkRefusal }, { status: 400 })
  // Sport, season, team count, format and dynasty are fixed once the draft has started.
  if (STRUCTURAL_LEAGUE_KEYS.some((key) => (body as Record<string, unknown>)[key] !== undefined)) {
    const current = await prisma.league.findUnique({
      where: { id: params.leagueId },
      select: { sport: true, season: true, leagueSize: true, leagueType: true, isDynasty: true },
    })
    if (!current) return NextResponse.json({ error: "League not found" }, { status: 404 })
    const structuralRefusal = await structuralPatchRefusal(params.leagueId, body as Record<string, unknown>, current)
    if (structuralRefusal) return NextResponse.json({ error: structuralRefusal }, { status: 409 })
  }
  const { updateLeagueSettings } = await import("@/lib/commissioner-settings/CommissionerSettingsService")
  const updated = await updateLeagueSettings(params.leagueId, body)
  if (!updated) return NextResponse.json({ error: "League not found" }, { status: 404 })
  return NextResponse.json(updated)
}
