import { prisma } from "@/lib/prisma"
import { sha256Hex } from "@/lib/tokens"

type BracketSnapshotPayload = {
  entryId: string
  leagueId: string
  tournamentId: string
  userId: string
  tiebreakerPoints: number | null
  picks: Array<{
    nodeId: string
    pickedTeamName: string | null
  }>
}

export async function lockTournamentBrackets(tournamentId: string, now = new Date()) {
  const leagues = await prisma.bracketLeague.findMany({
    where: { tournamentId },
    select: { id: true },
  })
  if (!leagues.length) return { lockedEntries: 0 }

  const leagueIds = leagues.map((l) => l.id)

  const entries = await prisma.bracketEntry.findMany({
    where: {
      leagueId: { in: leagueIds },
      status: { in: ["SUBMITTED", "LOCKED", "SCORED"] },
    },
    select: { id: true, leagueId: true, userId: true, status: true, lockedAt: true, tiebreakerPoints: true },
  })

  const lockTargets = entries.filter((e) => !e.lockedAt || e.status === "SUBMITTED")
  if (!lockTargets.length) return { lockedEntries: 0 }

  const entryIds = lockTargets.map((e) => e.id)

  await prisma.$transaction([
    prisma.bracketEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { status: "LOCKED", lockedAt: now },
    }),
  ])

  const picks = await prisma.bracketPick.findMany({
    where: { entryId: { in: entryIds } },
    select: { entryId: true, nodeId: true, pickedTeamName: true },
  })

  const picksByEntry = new Map<string, BracketSnapshotPayload["picks"]>()
  for (const p of picks) {
    if (!picksByEntry.has(p.entryId)) picksByEntry.set(p.entryId, [])
    picksByEntry.get(p.entryId)!.push({ nodeId: p.nodeId, pickedTeamName: p.pickedTeamName })
  }

  const snapshotWrites = []

  for (const entry of lockTargets) {
    const leagueId = entry.leagueId
    const payload: BracketSnapshotPayload = {
      entryId: entry.id,
      leagueId,
      tournamentId,
      userId: entry.userId,
      tiebreakerPoints: entry.tiebreakerPoints ?? null,
      picks: picksByEntry.get(entry.id) ?? [],
    }
    const json = payload as any
    const hash = sha256Hex(JSON.stringify(json))

    snapshotWrites.push(
      prisma.bracketEntrySnapshot.create({
        data: {
          entryId: entry.id,
          leagueId,
          tournamentId,
          userId: entry.userId,
          status: "LOCKED",
          lockedAt: now,
          bracketJson: json,
          bracketHash: hash,
        },
      }),
    )

    snapshotWrites.push(
      prisma.bracketEntry.update({
        where: { id: entry.id },
        data: { integrityHash: hash },
      }),
    )
  }

  if (snapshotWrites.length) {
    await prisma.$transaction(snapshotWrites)
  }

  return { lockedEntries: lockTargets.length }
}

