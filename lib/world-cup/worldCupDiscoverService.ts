import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { WorldCupJoinGateSnapshot } from "./worldCupJoinGate"
import { evaluateWorldCupNewParticipantJoinGate } from "./worldCupJoinGate"

export type { WorldCupJoinBlockedReason, WorldCupJoinGateSnapshot } from "./worldCupJoinGate"

type WorldCupDiscoverCard = WorldCupJoinGateSnapshot & {
  id: string
  name: string
  seasonYear: number
  tournamentKey: string
  status: string
  visibility: string
  inviteCode: string
  updatedAt: string
}

export async function listPublicWorldCupChallengesForDiscover(input: {
  q?: string | null
  seasonYear?: number | null
  /** open | locked | final | all */
  status?: string | null
  take?: number
}): Promise<WorldCupDiscoverCard[]> {
  const take = Math.min(Math.max(input.take ?? 48, 1), 100)

  const where: Prisma.WorldCupBracketChallengeWhereInput = {
    visibility: "public",
  }

  if (input.seasonYear != null && Number.isFinite(input.seasonYear)) {
    where.seasonYear = input.seasonYear
  }

  if (input.status && input.status !== "all") {
    where.status = input.status
  }

  const q = input.q?.trim()
  if (q) {
    where.name = { contains: q, mode: "insensitive" }
  }

  const rows = await prisma.worldCupBracketChallenge.findMany({
    where,
    take,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      seasonYear: true,
      tournamentKey: true,
      status: true,
      visibility: true,
      inviteCode: true,
      maxParticipants: true,
      pickLockStrategy: true,
      pickLockAt: true,
      sourcePayload: true,
      updatedAt: true,
      matches: { select: { startsAt: true, status: true } },
      _count: { select: { participants: true } },
    },
  })

  return rows.map((row) => {
    const gate = evaluateWorldCupNewParticipantJoinGate({
      challenge: row,
      matches: row.matches,
      sourcePayload: row.sourcePayload,
      participantCount: row._count.participants,
    })
    return {
      id: row.id,
      name: row.name,
      seasonYear: row.seasonYear,
      tournamentKey: row.tournamentKey,
      status: row.status,
      visibility: row.visibility,
      inviteCode: row.inviteCode,
      updatedAt: row.updatedAt.toISOString(),
      ...gate,
    }
  })
}
