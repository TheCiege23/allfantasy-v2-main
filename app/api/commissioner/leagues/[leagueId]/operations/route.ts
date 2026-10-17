import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { clientLeagueSettings } from '@/lib/league/clientLeagueSettings'

/** League operations: post to public dashboard, set orphan seeking, ranked visibility, orphan difficulty. */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '').toLowerCase()

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) || {}

  if (action === 'post_to_dashboard' || action === 'public_dashboard') {
    const value = body?.value !== false
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, publicDashboard: value } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', publicDashboard: value, settings: clientLeagueSettings(updated.settings) })
  }

  if (action === 'set_orphan_seeking' || action === 'orphan_seeking') {
    const value = body?.value !== false
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, orphanSeeking: value } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', orphanSeeking: value, settings: clientLeagueSettings(updated.settings) })
  }

  if (action === 'set_ranked_visibility' || action === 'ranked_visibility') {
    const value = body?.value !== false
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, rankedVisibility: value } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', rankedVisibility: value, settings: clientLeagueSettings(updated.settings) })
  }

  if (action === 'update_orphan_difficulty' || action === 'orphan_difficulty') {
    const description = String(body?.description ?? body?.value ?? '')
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, orphanDifficulty: description } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', orphanDifficulty: description, settings: clientLeagueSettings(updated.settings) })
  }

  return NextResponse.json({
    error: 'Invalid action. Use: post_to_dashboard, set_orphan_seeking, set_ranked_visibility, update_orphan_difficulty',
  }, { status: 400 })
}
