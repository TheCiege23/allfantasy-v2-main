import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"

export const runtime = "nodejs"

export async function POST(req: Request, props: { params: Promise<{ entryId: string }> }) {
  const params = await props.params
  try {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    const body = await req.json()
    const { nodeId, pickedTeamName } = body as {
      nodeId: string
      pickedTeamName: string
    }

    if (!nodeId || !pickedTeamName) {
      return NextResponse.json(
        { error: "Missing nodeId/pickedTeamName" },
        { status: 400 }
      )
    }

    const entry = await prisma.bracketEntry.findUnique({
      where: { id: params.entryId },
      select: {
        id: true,
        userId: true,
        leagueId: true,
        status: true,
        lockedAt: true,
        league: {
          select: {
            tournamentId: true,
            tournament: { select: { lockAt: true } },
          },
        },
      },
    })
    if (!entry || entry.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (entry.status === "LOCKED" || entry.status === "SCORED" || entry.status === "INVALIDATED" || entry.lockedAt) {
      return NextResponse.json(
        { error: "Picks are locked for this bracket" },
        { status: 409 },
      )
    }

    const tournamentLockAt = (entry as any).league?.tournament?.lockAt
    if (tournamentLockAt && new Date(tournamentLockAt) <= new Date()) {
      return NextResponse.json(
        { error: "Picks are locked for the tournament" },
        { status: 409 }
      )
    }

    const node = await prisma.bracketNode.findUnique({
      where: { id: nodeId },
    })
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 })
    }

    const game = node.sportsGameId
      ? await prisma.sportsGame.findUnique({
          where: { id: node.sportsGameId },
        })
      : null

    const locked = game?.startTime
      ? new Date(game.startTime) <= new Date()
      : false

    if (locked) {
      return NextResponse.json(
        { error: "Picks locked for this game" },
        { status: 409 }
      )
    }

    if (node.homeTeamName && node.awayTeamName) {
      if (
        pickedTeamName !== node.homeTeamName &&
        pickedTeamName !== node.awayTeamName
      ) {
        return NextResponse.json(
          { error: "Invalid team selection" },
          { status: 400 }
        )
      }
    } else {
      const feeders = await prisma.bracketNode.findMany({
        where: { nextNodeId: nodeId },
        select: { id: true, nextNodeSide: true },
      })

      const feederPicks = await prisma.bracketPick.findMany({
        where: {
          entryId: entry.id,
          nodeId: { in: feeders.map((f) => f.id) },
        },
        select: { nodeId: true, pickedTeamName: true },
      })

      const feederPickMap = new Map(
        feederPicks.map((fp) => [fp.nodeId, fp.pickedTeamName])
      )

      const validTeams: string[] = []
      if (node.homeTeamName) validTeams.push(node.homeTeamName)
      if (node.awayTeamName) validTeams.push(node.awayTeamName)

      for (const f of feeders) {
        const picked = feederPickMap.get(f.id)
        if (picked) validTeams.push(picked)
      }

      if (!validTeams.includes(pickedTeamName)) {
        return NextResponse.json(
          { error: "Invalid team selection — pick earlier rounds first" },
          { status: 400 }
        )
      }
    }

    const existingPick = await prisma.bracketPick.findUnique({
      where: { entryId_nodeId: { entryId: entry.id, nodeId } },
      select: { pickedTeamName: true },
    })

    await prisma.bracketPick.upsert({
      where: {
        entryId_nodeId: { entryId: entry.id, nodeId },
      },
      update: { pickedTeamName },
      create: { entryId: entry.id, nodeId, pickedTeamName },
    })

    if (existingPick?.pickedTeamName && existingPick.pickedTeamName !== pickedTeamName) {
      await cascadeClearDownstream(
        entry.id,
        nodeId,
        existingPick.pickedTeamName,
        (entry as any).league.tournamentId
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[bracket/pick] Error:", err)
    return NextResponse.json(
      { error: "Failed to save pick" },
      { status: 500 }
    )
  }
}

async function cascadeClearDownstream(
  entryId: string,
  changedNodeId: string,
  oldTeamName: string,
  tournamentId: string
) {
  const allNodes = await prisma.bracketNode.findMany({
    where: { tournamentId },
    select: {
      id: true,
      round: true,
      homeTeamName: true,
      awayTeamName: true,
      nextNodeId: true,
      nextNodeSide: true,
    },
  })

  const allPicks = await prisma.bracketPick.findMany({
    where: { entryId },
    select: { nodeId: true, pickedTeamName: true },
  })

  const pickMap: Record<string, string | null> = {}
  for (const p of allPicks) pickMap[p.nodeId] = p.pickedTeamName

  const sorted = [...allNodes].sort((a, b) => a.round - b.round)

  let maxIter = 10
  const toClear: string[] = []

  while (maxIter-- > 0) {
    const effective = new Map<string, { home: string | null; away: string | null }>()
    for (const n of allNodes) {
      effective.set(n.id, { home: n.homeTeamName, away: n.awayTeamName })
    }
    for (const n of sorted) {
      const picked = pickMap[n.id]
      if (!picked || !n.nextNodeId || !n.nextNodeSide) continue
      const cur = effective.get(n.nextNodeId)
      if (!cur) continue
      if (n.nextNodeSide === "home") {
        effective.set(n.nextNodeId, { ...cur, home: picked })
      } else {
        effective.set(n.nextNodeId, { ...cur, away: picked })
      }
    }

    let foundInvalid = false
    for (const n of allNodes) {
      const pick = pickMap[n.id]
      if (!pick) continue
      const eff = effective.get(n.id)
      if (!eff) continue
      if (pick !== eff.home && pick !== eff.away) {
        toClear.push(n.id)
        pickMap[n.id] = null
        foundInvalid = true
      }
    }

    if (!foundInvalid) break
  }

  if (toClear.length > 0) {
    await prisma.bracketPick.deleteMany({
      where: {
        entryId,
        nodeId: { in: toClear },
      },
    })
  }
}
