/**
 * [UPDATED] POST: Bulk update league names, themes, or settings for tournament child leagues.
 */
import * as prismaJson from '@/lib/prisma-json'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logTournamentAudit } from '@/lib/tournament-mode/TournamentAuditService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const tournament = await prisma.legacyTournament.findUnique({ where: { id: tournamentId }, select: { creatorId: true, settings: true } })
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tournament.creatorId !== userId) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const updates = body.updates as Array<{ leagueId: string; name?: string }> | undefined
  const themePack = body.themePack as string | undefined
  const bannerUrl = body.bannerUrl as string | undefined
  let updated = 0

  // Bulk rename leagues
  if (updates && Array.isArray(updates)) {
    for (const u of updates) {
      if (!u.leagueId) continue
      const tl = await prisma.legacyTournamentLeague.findFirst({ where: { tournamentId, leagueId: u.leagueId } })
      if (!tl) continue
      if (u.name && typeof u.name === 'string') {
        await prisma.league.update({ where: { id: u.leagueId }, data: { name: u.name.trim().slice(0, 120) } })
        updated++
      }
    }
  }

  // Bulk theme update
  if (themePack || bannerUrl !== undefined) {
    const currentSettings = (tournament.settings as Record<string, unknown>) ?? {}
    const hubSettings = (currentSettings.hubSettings as Record<string, unknown>) ?? {}
    const newHub = { ...hubSettings }
    if (themePack) newHub.themePack = themePack
    if (bannerUrl !== undefined) newHub.bannerUrl = bannerUrl || null
    await prisma.legacyTournament.update({
      where: { id: tournamentId },
      data: { settings: prismaJson.toPrismaJsonInput({ ...currentSettings, hubSettings: newHub }) },
    })
  }

  await logTournamentAudit(tournamentId, 'bulk_update', { actorId: userId, metadata: { updated, themePack, bannerUrl: bannerUrl !== undefined } })
  return NextResponse.json({ ok: true, updated })
}
