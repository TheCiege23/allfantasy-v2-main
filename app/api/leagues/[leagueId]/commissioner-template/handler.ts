/**
 * PATCH: apply or remove a league's Commissioner OS format template.
 *        Body `{ templateId: string | null }` — an id from `applicableTemplates`, or null to remove.
 *
 * 🛑 THIS IS THE FIRST WRITER OF A TEMPLATE PIN. Before it, `buildCommissionerTemplatePinFragment` had
 * no caller and 0 production leagues were pinned, so the EFL template was unreachable — including
 * for "EFL Dynasty League", the flat 32-team Sleeper league it was written for. A platform cannot
 * tell us a league promotes and relegates (Sleeper has no such setting), so the owner says so.
 *
 * ⚠ A HANDLER, NOT A ROUTE. This repo sits at Vercel's hard 2048-route ceiling, and the `[section]`
 * dispatcher exists so a new league endpoint costs zero routes.
 *
 * ⚠ OWNER-ONLY (`League.userId`). A template changes which mechanics Commissioner OS runs for the
 * whole league, the same class of decision as inviting a co-commissioner, which is also owner-only.
 *
 * ⚠ THE OFFER IS RECOMPUTED HERE, NEVER TRUSTED FROM THE CLIENT. A request can only pin a template
 * `applicableTemplates` offers for this league right now, at the version it chooses — so a client
 * cannot pin an unpublished id, a template for another sport, or a 32-team format onto 12 teams.
 *
 * The write takes the league row lock (the pattern in lib/league-join/classRequests.ts), and the pin
 * path is AllFantasy-owned (lib/league/afOwnedLeagueSettings.ts), so a re-sync keeps it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { applicableTemplates } from '@/lib/commissioner-os/profile/templateOffers'
import { readCommissionerTemplatePin, withCommissionerTemplatePin } from '@/lib/commissioner-os/profile/templatePin'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  let body: { templateId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (body.templateId !== null && typeof body.templateId !== 'string') {
    return NextResponse.json({ error: 'templateId must be a template id or null' }, { status: 400 })
  }

  const [league, teamCount] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        userId: true,
        platform: true,
        sport: true,
        season: true,
        status: true,
        settings: true,
        leagueType: true,
        leagueVariant: true,
        keeperCount: true,
        keeperCostSystem: true,
        keeperRoundPenalty: true,
        guillotineMode: true,
        survivorMode: true,
        isDynasty: true,
        lifecycleState: true,
      },
    }),
    prisma.leagueTeam.count({ where: { leagueId } }),
  ])
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.userId !== userId) {
    return NextResponse.json({ error: "Only the league's owner can set its format template" }, { status: 403 })
  }

  let pin: { id: string; version: string } | null = null
  if (typeof body.templateId === 'string') {
    const profile = resolveCommissionerLeagueProfile({ league, commissionerRole: 'commissioner', networkMembership: null })
    const offer = applicableTemplates({ sport: league.sport, canonicalFormatId: profile.canonicalFormatId, teamCount }).find(
      (t) => t.id === body.templateId,
    )
    if (!offer) {
      return NextResponse.json({ error: 'That template does not fit this league' }, { status: 400 })
    }
    pin = { id: offer.id, version: offer.version }
  }

  const written = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return null
    const next = withCommissionerTemplatePin(row.settings, pin)
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
    return readCommissionerTemplatePin(next)
  })
  if (written === null && pin !== null) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  return NextResponse.json({ ok: true, template: written })
}
