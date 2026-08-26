import { withApiUsage } from '@/lib/telemetry/usage'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import {
  listFranchises,
  loadFranchiseDetail,
  markLegObserved,
  recordCrossPlatformTrade,
  refreshTradeSettlement,
} from '@/lib/franchise/franchiseService'
import { describeCrossPlatformTrade } from '@/lib/franchise/franchiseLink'

/**
 * The cross-platform franchise: one team across two leagues on two platforms.
 *
 * ⚠ EVERY READ AND WRITE IS GATED ON OWNERSHIP OF THE LINK, not merely on being
 * signed in. A franchise names which teams in which leagues belong to someone,
 * so an ungated read would tell any account who owns what across the league.
 *
 * ⚠ AND NOTHING HERE EXECUTES A TRADE. Sleeper's API is read-only and Fantrax is
 * an import, so a cross-platform deal is recorded and watched, never performed.
 * The endpoint says so in its own response rather than leaving a manager to
 * assume otherwise.
 */

/** Ownership check, used by every branch below. */
async function ownedLink(linkId: string, userId: string) {
  const link = await prisma.franchiseLink.findFirst({
    where: { id: linkId, ownerUserId: userId },
    select: { id: true },
  })
  return link != null
}

export const GET = withApiUsage({ endpoint: '/api/legacy/franchise', tool: 'Franchise' })(
  async (request: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    const linkId = new URL(request.url).searchParams.get('linkId')

    if (!linkId) {
      const franchises = await listFranchises(auth.userId)
      return NextResponse.json({ franchises })
    }

    if (!(await ownedLink(linkId, auth.userId))) {
      /* Same answer for "not yours" and "does not exist" — a distinct 403 would
         confirm the link exists to someone who cannot see it. */
      return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })
    }

    const detail = await loadFranchiseDetail(linkId)
    if (!detail) return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })

    return NextResponse.json({
      ...detail,
      note: 'AllFantasy cannot execute a trade on either platform. Both halves are carried out by hand and tracked here.',
    })
  },
)

export const POST = withApiUsage({ endpoint: '/api/legacy/franchise', tool: 'Franchise' })(
  async (request: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    let body: {
      action?: string
      linkId?: string
      tradeId?: string
      summary?: string
      legs?: Array<{ role: 'pro' | 'college'; platform: string; sends: string[]; receives: string[] }>
      role?: 'pro' | 'college'
      status?: 'observed' | 'contradicted'
      basis?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (body.action === 'record-trade') {
      if (!body.linkId) return NextResponse.json({ error: 'linkId is required' }, { status: 400 })
      if (!(await ownedLink(body.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })
      }
      const legs = body.legs ?? []
      if (legs.length === 0) {
        return NextResponse.json({ error: 'at least one leg is required' }, { status: 400 })
      }
      /* One leg per role — the unique constraint enforces it, but answering 400
         beats surfacing a database error to the caller. */
      if (new Set(legs.map((l) => l.role)).size !== legs.length) {
        return NextResponse.json({ error: 'each role may appear once' }, { status: 400 })
      }

      const recorded = await recordCrossPlatformTrade({
        linkId: body.linkId,
        summary: body.summary ?? null,
        legs,
      })
      return NextResponse.json({
        ...recorded,
        description: describeCrossPlatformTrade(
          legs.map((l) => ({ ...l, status: 'pending' as const })),
        ),
      })
    }

    if (body.action === 'mark-leg') {
      if (!body.tradeId || !body.role || !body.status) {
        return NextResponse.json({ error: 'tradeId, role and status are required' }, { status: 400 })
      }
      const trade = await prisma.crossPlatformTrade.findUnique({
        where: { id: body.tradeId },
        select: { linkId: true },
      })
      if (!trade || !(await ownedLink(trade.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
      }

      const settlement = await markLegObserved({
        tradeId: body.tradeId,
        role: body.role,
        status: body.status,
        /* Always recorded, so a manager can tell an observation from an
           assumption later. */
        basis: body.basis ?? `marked ${body.status} by the franchise owner`,
      })
      return NextResponse.json({ settlement })
    }

    if (body.action === 'refresh-settlement') {
      if (!body.tradeId) return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
      const trade = await prisma.crossPlatformTrade.findUnique({
        where: { id: body.tradeId },
        select: { linkId: true },
      })
      if (!trade || !(await ownedLink(trade.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
      }
      return NextResponse.json({ settlement: await refreshTradeSettlement(body.tradeId) })
    }

    return NextResponse.json(
      { error: 'Unknown action. Use record-trade, mark-leg or refresh-settlement.' },
      { status: 400 },
    )
  },
)
