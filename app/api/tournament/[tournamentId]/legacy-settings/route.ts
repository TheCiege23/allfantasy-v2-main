import * as prismaJson from '@/lib/prisma-json'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLegacyTournamentAccess, canEditHubSettings } from '@/lib/tournament/legacyTournamentAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function shallowMergeJson(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...patch }
}

/**
 * PATCH: Merge `hubSettings` and/or top-level `settings` JSON for LegacyTournament.
 * Used by commissioner dashboard settings modal.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const access = await getLegacyTournamentAccess(userId, tournamentId)
  if (!canEditHubSettings(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { hubSettings?: Record<string, unknown>; settings?: Record<string, unknown> }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { hubSettings: true, settings: true, lockedAt: true },
  })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const structuralKeys = ['participantPoolSize', 'qualificationWeeks', 'conferenceMode']
  if (t.lockedAt && body.settings) {
    for (const k of structuralKeys) {
      if (k in (body.settings ?? {})) {
        return NextResponse.json(
          { error: 'Tournament is locked — structural settings cannot be changed via this endpoint' },
          { status: 400 },
        )
      }
    }
  }

  const currentHub = (t.hubSettings as Record<string, unknown>) ?? {}
  const currentSettings = (t.settings as Record<string, unknown>) ?? {}

  const nextHub =
    body.hubSettings && typeof body.hubSettings === 'object' && !Array.isArray(body.hubSettings)
      ? shallowMergeJson(currentHub, body.hubSettings)
      : currentHub
  const nextSettings =
    body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
      ? shallowMergeJson(currentSettings, body.settings)
      : currentSettings

  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: {
      hubSettings: prismaJson.toPrismaJsonInput(nextHub),
      settings: prismaJson.toPrismaJsonInput(nextSettings),
    },
  })

  return NextResponse.json({ ok: true, hubSettings: nextHub, settings: nextSettings })
}
