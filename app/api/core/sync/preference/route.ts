import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { resolveLeagueAccess } from '@/lib/league-access'
import { prisma } from '@/lib/prisma'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { setSyncPaused } from '@/lib/core-app/syncPreferences'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response
  const body = await req.json().catch(() => null)
  if (typeof body?.leagueId !== 'string' || typeof body?.paused !== 'boolean') {
    return NextResponse.json({ error: 'Choose a league and whether to pause sync.' }, { status: 400 })
  }
  try {
    if (!await resolveLeagueAccess(body.leagueId, auth.userId)) {
      return NextResponse.json({ error: 'This league is not available to your account.' }, { status: 403 })
    }
    const league = await prisma.league.findUnique({ where: { id: body.leagueId }, select: { platform: true, platformLeagueId: true } })
    const provider = resolveProvider(String(league?.platform ?? ''))
    const sourceId = league?.platformLeagueId?.trim()
    if (!provider || !isImportProviderAvailable(provider) || !sourceId) {
      return NextResponse.json({ error: 'This league has no supported external connection.' }, { status: 400 })
    }
    await setSyncPaused(auth.userId, `${provider}:${sourceId}`, body.paused)
    return NextResponse.json({ ok: true, paused: body.paused })
  } catch {
    return NextResponse.json({ error: 'Your sync preference could not be saved. Please try again.' }, { status: 503 })
  }
}
