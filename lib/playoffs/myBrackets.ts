import "server-only"
import { prisma } from "@/lib/prisma"
import type { PlayoffSport } from "./types"

export type MyBracketLeague = {
  id: string
  name: string
  sport: PlayoffSport
  seasonYear: number
  entries: Array<{
    id: string
    name: string
    finalizedAt: Date | null
    _count: { picks: number }
  }>
}

/** Include drafts and past seasons; never load another manager's entries. */
export async function listMyBrackets(userId: string): Promise<MyBracketLeague[]> {
  if (!userId?.trim()) throw new Error("Authentication required")
  return (prisma as any).playoffBracketChallenge.findMany({
    where: { OR: [{ ownerUserId: userId }, { entries: { some: { userId } } }] },
    select: {
      id: true, name: true, sport: true, seasonYear: true,
      entries: {
        where: { userId },
        select: { id: true, name: true, finalizedAt: true, _count: { select: { picks: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  })
}
