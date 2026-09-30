import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * GET: Returns the roster slot configuration for this league.
 * This defines what positions are allowed and how many starters/bench slots.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId

  // Check if user is in the league
  const [leagueAsOwner, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({ where: { id: leagueId, userId } }),
    (prisma as any).roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])

  if (!leagueAsOwner && !rosterAsMember) {
    return NextResponse.json({ error: "League not found" }, { status: 404 })
  }

  // Get the league's roster configuration
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: {
      rosterSize: true,
      starters: true,
      settings: true,
      sport: true,
    },
  })

  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 })
  }

  // Build roster slots based on league settings
  // Default NFL roster slots
  const defaultSlots = [
    { position: "QB", starters: 1, max: 4 },
    { position: "RB", starters: 2, max: 6 },
    { position: "WR", starters: 2, max: 8 },
    { position: "TE", starters: 1, max: 4 },
    { position: "FLEX", starters: 1, max: 2 },
    { position: "K", starters: 1, max: 2 },
  ]

  // Try to get slots from league settings
  let slots = defaultSlots
  if (league.settings && typeof league.settings === 'object') {
    const settings = league.settings as any
    if (settings.rosterSlots && Array.isArray(settings.rosterSlots)) {
      slots = settings.rosterSlots
    }
  }

  // If sport is NFL and league has specific starter counts
  if (league.sport === 'NFL') {
    // Check for superflex, TEP, IDP, etc.
    const isSuperflex = league.settings?.superflex || false
    const isIDP = league.settings?.idpEnabled || false

    if (isSuperflex) {
      const flexIndex = slots.findIndex((s: any) => s.position === 'FLEX')
      if (flexIndex !== -1) {
        slots[flexIndex] = { position: "SUPER_FLEX", starters: 1, max: 2 }
      } else {
        slots.push({ position: "SUPER_FLEX", starters: 1, max: 2 })
      }
    }

    if (isIDP) {
      slots.push(
        { position: "DL", starters: 2, max: 4 },
        { position: "LB", starters: 2, max: 4 },
        { position: "DB", starters: 2, max: 4 },
        { position: "IDP_FLEX", starters: 1, max: 2 }
      )
    }
  }

  // Calculate total starters and bench
  const totalStarters = slots.reduce((sum: number, slot: any) => sum + slot.starters, 0)
  const benchSize = (league.rosterSize || 15) - totalStarters

  return NextResponse.json({
    slots,
    totalStarters,
    benchSize,
    totalRosterSize: league.rosterSize || 15,
  })
}