import "server-only"
import { prisma } from "@/lib/prisma"

// ── Types ─────────────────────────────────────────────────────────────────────

type WorldCupRosterPlayer = {
  id: string
  providerPlayerId: string
  name: string
  shortName: string | null
  position: string | null
  positionCode: string | null
  shirtNumber: number | null
  age: number | null
  club: string | null
  nationality: string | null
  photoUrl: string | null
  isCaptain: boolean
  lastSyncedAt: string | null
}

type WorldCupPlayerAvailability = {
  playerName: string
  providerPlayerId: string
  status: string
  bodyPart: string | null
  notes: string | null
  reportDate: string
}

type WorldCupRosterReport = {
  teamId: string
  teamName: string
  players: WorldCupRosterPlayer[]
  captain: WorldCupRosterPlayer | null
  playerCount: number
  byPosition: Record<string, WorldCupRosterPlayer[]>
  injuries: WorldCupPlayerAvailability[]
  suspensions: WorldCupPlayerAvailability[]
  lastSyncedAt: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUSPENSION_STATUSES = new Set(["suspended", "ban", "red card suspension", "accumulated yellows"])

function isSuspension(status: string): boolean {
  const s = status.toLowerCase()
  return SUSPENSION_STATUSES.has(s) || s.includes("suspend") || s.includes("ban")
}

// ── Main functions ────────────────────────────────────────────────────────────

export async function getTeamRoster(teamId: string): Promise<WorldCupRosterReport | null> {
  const [teamRow, players] = await Promise.all([
    (prisma as any).worldCupTeam.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    }),
    (prisma as any).worldCupPlayer
      .findMany({
        where: { teamId, isActive: true },
        orderBy: [{ isCaptain: "desc" }, { positionCode: "asc" }, { shirtNumber: "asc" }],
        select: {
          id: true,
          providerPlayerId: true,
          name: true,
          shortName: true,
          position: true,
          positionCode: true,
          shirtNumber: true,
          age: true,
          club: true,
          nationality: true,
          photoUrl: true,
          isCaptain: true,
          lastSyncedAt: true,
        },
      })
      .catch(() => []) as Promise<any[]>,
  ])

  if (!teamRow) return null

  const rosterPlayers: WorldCupRosterPlayer[] = (players as any[]).map((p) => ({
    id: p.id,
    providerPlayerId: p.providerPlayerId,
    name: p.name,
    shortName: p.shortName ?? null,
    position: p.position ?? null,
    positionCode: p.positionCode ?? null,
    shirtNumber: p.shirtNumber ?? null,
    age: p.age ?? null,
    club: p.club ?? null,
    nationality: p.nationality ?? null,
    photoUrl: p.photoUrl ?? null,
    isCaptain: Boolean(p.isCaptain),
    lastSyncedAt: p.lastSyncedAt ? new Date(p.lastSyncedAt).toISOString() : null,
  }))

  const captain = rosterPlayers.find((p) => p.isCaptain) ?? null

  const byPosition: Record<string, WorldCupRosterPlayer[]> = {}
  for (const p of rosterPlayers) {
    const key = p.positionCode ?? p.position ?? "UNK"
    byPosition[key] = [...(byPosition[key] ?? []), p]
  }

  const lastSyncedAt =
    rosterPlayers.length > 0
      ? rosterPlayers.map((p) => p.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null
      : null

  // Fetch injuries from InjuryReportRecord by matching player names or provider IDs
  const providerIds = rosterPlayers.map((p) => p.providerPlayerId)
  const injuryRows = providerIds.length > 0
    ? await (prisma as any).injuryReportRecord
        .findMany({
          where: {
            sport: "WC_SOCCER",
            playerId: { in: providerIds },
          },
          orderBy: { reportDate: "desc" },
          take: 50,
          select: {
            playerName: true,
            playerId: true,
            status: true,
            bodyPart: true,
            notes: true,
            reportDate: true,
          },
        })
        .catch(() => []) as Promise<any[]>
    : []

  const injuries: WorldCupPlayerAvailability[] = []
  const suspensions: WorldCupPlayerAvailability[] = []

  const seenPlayerIds = new Set<string>()
  for (const row of injuryRows as any[]) {
    if (seenPlayerIds.has(row.playerId)) continue
    seenPlayerIds.add(row.playerId)
    const rec: WorldCupPlayerAvailability = {
      playerName: row.playerName,
      providerPlayerId: row.playerId,
      status: row.status,
      bodyPart: row.bodyPart ?? null,
      notes: row.notes ?? null,
      reportDate: new Date(row.reportDate).toISOString().slice(0, 10),
    }
    if (isSuspension(row.status)) suspensions.push(rec)
    else injuries.push(rec)
  }

  return {
    teamId: teamRow.id,
    teamName: teamRow.name,
    players: rosterPlayers,
    captain,
    playerCount: rosterPlayers.length,
    byPosition,
    injuries,
    suspensions,
    lastSyncedAt,
  }
}

export async function searchWorldCupPlayers(
  query: string
): Promise<{ id: string; name: string; teamName: string; position: string | null; isCaptain: boolean }[]> {
  if (!query || query.trim().length < 2) return []
  const rows = await (prisma as any).worldCupPlayer
    .findMany({
      where: {
        name: { contains: query.trim(), mode: "insensitive" },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        position: true,
        isCaptain: true,
        team: { select: { name: true } },
      },
      take: 20,
      orderBy: [{ isCaptain: "desc" }, { name: "asc" }],
    })
    .catch(() => []) as any[]

  return (rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    teamName: r.team?.name ?? "Unknown",
    position: r.position ?? null,
    isCaptain: Boolean(r.isCaptain),
  }))
}

/** Lightweight digest for all teams — used in Chimmy context injection. */
export async function loadRosterDigest(): Promise<ChimmyRosterDigestRow[]> {
  const [players, injuries] = await Promise.all([
    (prisma as any).worldCupPlayer
      .findMany({
        where: { isActive: true },
        select: {
          name: true,
          positionCode: true,
          isCaptain: true,
          lastSyncedAt: true,
          team: { select: { name: true } },
        },
        orderBy: [{ isCaptain: "desc" }, { positionCode: "asc" }, { shirtNumber: "asc" }],
      })
      .catch(() => []) as Promise<any[]>,
    (prisma as any).injuryReportRecord
      .findMany({
        where: {
          sport: "WC_SOCCER",
          reportDate: { gte: new Date(Date.now() - 14 * 86_400_000) },
        },
        orderBy: { reportDate: "desc" },
        select: { playerName: true, team: true, status: true },
        take: 200,
      })
      .catch(() => []) as Promise<any[]>,
  ])

  if ((players as any[]).length === 0) return []

  const injuryByTeam = new Map<string, { name: string; status: string }[]>()
  for (const r of injuries as any[]) {
    const key = (r.team ?? "").toLowerCase()
    if (!key) continue
    const existing = injuryByTeam.get(key) ?? []
    existing.push({ name: r.playerName, status: r.status })
    injuryByTeam.set(key, existing)
  }

  const teamMap = new Map<string, {
    captain: string | null
    gk: string[]; def: string[]; mid: string[]; att: string[]
    playerCount: number
    lastSyncedAt: string | null
  }>()

  for (const p of players as any[]) {
    const teamName: string = p.team?.name ?? "Unknown"
    const existing = teamMap.get(teamName) ?? {
      captain: null, gk: [], def: [], mid: [], att: [],
      playerCount: 0, lastSyncedAt: null,
    }
    existing.playerCount++
    if (p.isCaptain && !existing.captain) existing.captain = p.name
    const code = (p.positionCode ?? "").toUpperCase()
    if (code === "GK") existing.gk.push(p.name)
    else if (code === "DEF") existing.def.push(p.name)
    else if (code === "MID") existing.mid.push(p.name)
    else if (code === "ATT" || code === "FWD") existing.att.push(p.name)
    const sync = p.lastSyncedAt ? new Date(p.lastSyncedAt).toISOString() : null
    if (sync && (!existing.lastSyncedAt || sync > existing.lastSyncedAt)) {
      existing.lastSyncedAt = sync
    }
    teamMap.set(teamName, existing)
  }

  return Array.from(teamMap.entries()).map(([teamName, data]) => {
    const teamKey = teamName.toLowerCase()
    return {
      teamName,
      captain: data.captain,
      gk: data.gk.slice(0, 3),
      def: data.def.slice(0, 6),
      mid: data.mid.slice(0, 6),
      att: data.att.slice(0, 4),
      playerCount: data.playerCount,
      injuredNames: (injuryByTeam.get(teamKey) ?? []).slice(0, 5).map((i) => `${i.name} (${i.status})`),
      lastSyncedAt: data.lastSyncedAt,
    }
  })
}

export type ChimmyRosterDigestRow = {
  teamName: string
  captain: string | null
  gk: string[]
  def: string[]
  mid: string[]
  att: string[]
  playerCount: number
  injuredNames: string[]
  lastSyncedAt: string | null
}
