/**
 * [UPDATED] app/api/tournament/[tournamentId]/theme/route.ts
 * GET: Returns current tournament theme/banner settings.
 * PATCH: Updates tournament theme/banner (commissioner only).
 */
import * as prismaJson from '@/lib/prisma-json'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLegacyTournamentAccess, canEditHubSettings } from '@/lib/tournament/legacyTournamentAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params

  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { settings: true, hubSettings: true },
  })
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hubSettings = (tournament.hubSettings as Record<string, unknown>) ?? {}
  const settings = (tournament.settings as Record<string, unknown>) ?? {}
  const bannerTheme = settings.bannerTheme as string | undefined

  return NextResponse.json({
    theme: {
      bannerUrl: (hubSettings.bannerUrl as string) ?? null,
      themePack: (hubSettings.themePack as string) ?? 'default',
      bannerTheme: bannerTheme ?? null,
    },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const access = await getLegacyTournamentAccess(userId, tournamentId)
  if (!canEditHubSettings(access)) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true, hubSettings: true, settings: true },
  })
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const bannerUrl = body.bannerUrl as string | undefined
  const themePack = body.themePack as string | undefined

  const VALID_THEME_PACKS = ['default', 'tribal', 'jungle', 'torch', 'sand', 'battle']

  if (themePack && !VALID_THEME_PACKS.includes(themePack)) {
    return NextResponse.json({ error: `Invalid theme pack. Valid: ${VALID_THEME_PACKS.join(', ')}` }, { status: 400 })
  }

  const currentHub = (tournament.hubSettings as Record<string, unknown>) ?? {}
  const newHub = { ...currentHub }
  if (bannerUrl !== undefined) newHub.bannerUrl = bannerUrl || null
  if (themePack) newHub.themePack = themePack

  const currentSettings = (tournament.settings as Record<string, unknown>) ?? {}
  if (themePack) currentSettings.bannerTheme = themePack

  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: {
      hubSettings: prismaJson.toPrismaJsonInput(newHub),
      settings: prismaJson.toPrismaJsonInput(currentSettings),
    },
  })

  return NextResponse.json({
    theme: {
      bannerUrl: newHub.bannerUrl ?? null,
      themePack: newHub.themePack ?? 'default',
    },
  })
}
