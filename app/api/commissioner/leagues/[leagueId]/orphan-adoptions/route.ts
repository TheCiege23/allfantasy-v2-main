import { getServerSession } from "next-auth"
import { NextRequest, NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { trackDiscoveryOrphanAdoption } from "@/lib/discovery-analytics/server"
import {
  getOrphanAdoptionRequests,
  withOrphanAdoptionRequests,
  type OrphanAdoptionRequest,
} from "@/lib/orphan-marketplace"
import { prisma } from "@/lib/prisma"

type SessionWithUser = { user?: { id?: string } } | null

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const statusFilter = req.nextUrl.searchParams?.get("status")?.trim().toLowerCase() || ""

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const requests = getOrphanAdoptionRequests(league.settings)
    .filter((request) => {
      if (!statusFilter) return true
      return request.status === statusFilter
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return NextResponse.json({ ok: true, requests })
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const commissionerId = session?.user?.id
  if (!commissionerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, commissionerId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : ""
  const decisionRaw = typeof body?.decision === "string" ? body.decision.trim().toLowerCase() : ""
  const commissionerNote = typeof body?.commissionerNote === "string" ? body.commissionerNote.trim().slice(0, 400) : ""
  const decision = decisionRaw === "approve" ? "approved" : decisionRaw === "reject" ? "rejected" : null

  if (!requestId || !decision) {
    return NextResponse.json({ error: "requestId and decision (approve|reject) are required." }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const league = await tx.league.findUnique({
        where: { id: params.leagueId },
        select: { id: true, settings: true },
      })
      if (!league) throw new Error("League not found")

      const requests = getOrphanAdoptionRequests(league.settings)
      const idx = requests.findIndex((request) => request.id === requestId)
      if (idx < 0) throw new Error("Adoption request not found")

      const request = requests[idx]!
      if (request.status !== "pending") {
        throw new Error(`Request is already ${request.status}.`)
      }

      let resolvedRequest: OrphanAdoptionRequest = {
        ...request,
        status: decision,
        resolvedAt: new Date().toISOString(),
        resolvedBy: commissionerId,
        commissionerNote: commissionerNote || null,
      }

      if (decision === "approved") {
        const roster = await tx.roster.findFirst({
          where: { id: request.rosterId, leagueId: params.leagueId },
          select: { id: true, platformUserId: true },
        })
        if (!roster) throw new Error("Roster no longer exists.")
        if (!String(roster.platformUserId || "").startsWith("orphan-")) {
          throw new Error("Roster is no longer orphaned.")
        }

        const existingMember = await tx.roster.findFirst({
          where: { leagueId: params.leagueId, platformUserId: request.userId },
          select: { id: true },
        })
        if (existingMember) throw new Error("Requester already manages a team in this league.")

        await tx.roster.update({
          where: { id: request.rosterId },
          data: { platformUserId: request.userId },
        })

        const [profile, appUser] = await Promise.all([
          tx.userProfile.findFirst({
            where: { userId: request.userId },
            select: { displayName: true, sleeperUsername: true },
          }),
          tx.appUser.findUnique({
            where: { id: request.userId },
            select: { username: true, displayName: true },
          }),
        ])
        const displayName =
          profile?.displayName?.trim() ||
          appUser?.displayName?.trim() ||
          appUser?.username?.trim() ||
          profile?.sleeperUsername?.trim() ||
          request.requesterName

        await tx.leagueTeam.updateMany({
          where: {
            leagueId: params.leagueId,
            OR: [{ externalId: roster.id }, { externalId: roster.platformUserId }, { externalId: request.userId }],
          },
          data: {
            externalId: roster.id,
            ownerName: displayName,
          },
        })

        // Auto-close other pending requests for the same roster.
        for (let i = 0; i < requests.length; i += 1) {
          const row = requests[i]
          if (!row || row.id === request.id) continue
          if (row.rosterId === request.rosterId && row.status === "pending") {
            requests[i] = {
              ...row,
              status: "rejected",
              resolvedAt: resolvedRequest.resolvedAt,
              resolvedBy: commissionerId,
              commissionerNote: "Another request for this roster was approved.",
            }
          }
        }
      }

      requests[idx] = resolvedRequest
      await tx.league.update({
        where: { id: params.leagueId },
        data: { settings: withOrphanAdoptionRequests(league.settings, requests) as any },
      })

      return resolvedRequest
    })

    if (result.status === "approved") {
      await trackDiscoveryOrphanAdoption(
        { leagueId: params.leagueId, rosterId: result.rosterId, userId: result.userId },
        { commissionerId, source: "orphan_adoptions_route" }
      )
    }

    return NextResponse.json({ ok: true, request: result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to review orphan adoption request."
    const status = /not found|no longer exists/i.test(message) ? 404 : /already|no longer orphaned|already manages/i.test(message) ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

