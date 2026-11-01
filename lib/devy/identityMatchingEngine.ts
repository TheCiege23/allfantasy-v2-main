import type { DevyManagerMapping, DevyMergeConflict, DevyPlayerMapping } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type Manager = {
  userId?: string
  username?: string
  displayName?: string
}

export type ExternalPlayerRow = {
  externalId: string
  externalName: string
  externalPosition?: string
  externalTeam?: string
  externalSchool?: string
  managerExternalUserId?: string
  sourcePlatform: string
  sourceId: string
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
    }
  }
  return dp[m]![n]!
}

export function extractExternalPlayersFromSources(sessionId: string): Promise<ExternalPlayerRow[]> {
  return collectPlayers(sessionId)
}

export async function collectPlayers(sessionId: string): Promise<ExternalPlayerRow[]> {
  const sources = await prisma.devyImportSource.findMany({ where: { sessionId } })
  const out: ExternalPlayerRow[] = []
  for (const src of sources) {
    const raw = src.rawData as Record<string, unknown> | null
    if (!raw) continue
    const platform = src.sourcePlatform || 'custom'

    if (Array.isArray(raw.players)) {
      for (const p of raw.players as Record<string, unknown>[]) {
        out.push({
          externalId: String(p.externalId ?? p.id ?? ''),
          externalName: String(p.externalName ?? p.name ?? 'Unknown'),
          externalPosition: p.externalPosition ? String(p.externalPosition) : p.position ? String(p.position) : undefined,
          externalTeam: p.externalTeam ? String(p.externalTeam) : p.team ? String(p.team) : undefined,
          externalSchool: p.externalSchool ? String(p.externalSchool) : p.school ? String(p.school) : undefined,
          managerExternalUserId: p.managerExternalUserId ? String(p.managerExternalUserId) : undefined,
          sourcePlatform: platform,
          sourceId: src.id,
        })
      }
      continue
    }

    if (Array.isArray(raw.rosters) && raw.sleeperPlayerNames && typeof raw.sleeperPlayerNames === 'object') {
      const names = raw.sleeperPlayerNames as Record<string, string>
      for (const roster of raw.rosters as Record<string, unknown>[]) {
        // Key the owner exactly as matchManagers keys a manager (`username || user_id`), because
        // executeMerge finds a player's manager by that key. Keying on the raw owner_id never
        // matched a manager whose username is set, so every Sleeper player was skipped at merge.
        const owner = roster.ownerUsername
          ? String(roster.ownerUsername)
          : roster.owner_id
            ? String(roster.owner_id)
            : undefined
        const players = Array.isArray(roster.players) ? (roster.players as string[]) : []
        for (const pid of players) {
          out.push({
            externalId: pid,
            externalName: names[pid] || `sleeper:${pid}`,
            externalPosition: undefined,
            externalTeam: undefined,
            externalSchool: undefined,
            managerExternalUserId: owner,
            sourcePlatform: platform,
            sourceId: src.id,
          })
        }
      }
    }
  }
  return out.filter(p => p.externalId.length > 0)
}

async function matchOnePlayer(row: ExternalPlayerRow): Promise<
  Omit<DevyPlayerMapping, 'id' | 'createdAt' | 'sessionId'>
> {
  let internalPlayerId: string | null = null
  let internalPlayerName: string | null = null
  let matchConfidence: DevyPlayerMapping['matchConfidence'] = 'unmatched'
  let matchMethod: string | null = null
  let requiresReview = true
  let playerType: string | null = row.externalSchool && !row.externalTeam ? 'devy' : 'nfl_veteran'

  const byId = await prisma.player.findFirst({
    where: { id: row.externalId },
    select: { id: true, name: true, position: true, league: true, devyEligible: true },
  })
  if (byId) {
    internalPlayerId = byId.id
    internalPlayerName = byId.name
    matchConfidence = 'exact'
    matchMethod = 'id_lookup'
    requiresReview = false
    playerType = byId.devyEligible || byId.league === 'NCAA' ? 'devy' : 'nfl_veteran'
    return {
      externalId: row.externalId,
      externalName: row.externalName,
      externalPlatform: row.sourcePlatform,
      externalPosition: row.externalPosition ?? null,
      externalTeam: row.externalTeam ?? null,
      externalSchool: row.externalSchool ?? null,
      internalPlayerId,
      internalPlayerName,
      matchConfidence,
      matchMethod,
      isConfirmedByCommissioner: false,
      requiresReview,
      playerType,
    }
  }

  const nn = normalizeName(row.externalName)
  const token = row.externalName.split(/\s+/)[0] ?? ''
  const candidates = await prisma.player.findMany({
    where: {
      OR: [
        { name: { equals: row.externalName, mode: 'insensitive' } },
        { name: { startsWith: token, mode: 'insensitive' } },
      ],
    },
    take: 60,
    select: { id: true, name: true, position: true, league: true, devyEligible: true },
  })

  const exact = candidates.filter(c => normalizeName(c.name) === nn)
  if (exact.length === 1) {
    const c = exact[0]!
    internalPlayerId = c.id
    internalPlayerName = c.name
    matchConfidence = 'high'
    matchMethod = 'name_exact'
    requiresReview = false
    playerType = c.devyEligible || c.league === 'NCAA' ? 'devy' : 'nfl_veteran'
  } else {
    let best: { id: string; name: string; d: number; league: string; devyEligible: boolean } | null = null
    for (const c of candidates) {
      const d = levenshtein(nn, normalizeName(c.name))
      if (!best || d < best.d) {
        best = { id: c.id, name: c.name, d, league: c.league, devyEligible: c.devyEligible }
      }
    }
    if (best && best.d <= 2) {
      internalPlayerId = best.id
      internalPlayerName = best.name
      matchConfidence = best.d === 0 ? 'high' : 'medium'
      matchMethod = 'name_fuzzy'
      requiresReview = best.d > 1
      playerType = best.devyEligible || best.league === 'NCAA' ? 'devy' : 'nfl_veteran'
    } else {
      matchConfidence = 'low'
      matchMethod = 'name_fuzzy'
      requiresReview = true
    }
  }

  if (row.externalSchool && !row.externalTeam) {
    const schoolMatch = await prisma.player.findMany({
      where: {
        devyEligible: true,
        name: { contains: row.externalName.split(' ')[0] ?? '', mode: 'insensitive' },
      },
      take: 5,
    })
    if (schoolMatch.length === 1) {
      internalPlayerId = schoolMatch[0]!.id
      internalPlayerName = schoolMatch[0]!.name
      matchConfidence = 'medium'
      matchMethod = 'school_name_devy'
      playerType = 'devy'
      requiresReview = true
    }
  }

  return {
    externalId: row.externalId,
    externalName: row.externalName,
    externalPlatform: row.sourcePlatform,
    externalPosition: row.externalPosition ?? null,
    externalTeam: row.externalTeam ?? null,
    externalSchool: row.externalSchool ?? null,
    internalPlayerId,
    internalPlayerName,
    matchConfidence,
    matchMethod,
    isConfirmedByCommissioner: false,
    requiresReview,
    playerType,
  }
}

export async function matchPlayers(sessionId: string): Promise<DevyPlayerMapping[]> {
  await prisma.devyPlayerMapping.deleteMany({ where: { sessionId } })
  const rows = await collectPlayers(sessionId)
  const created: DevyPlayerMapping[] = []
  for (const row of rows) {
    const data = await matchOnePlayer(row)
    const m = await prisma.devyPlayerMapping.create({
      data: {
        sessionId,
        ...data,
      },
    })
    created.push(m)
  }
  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: { status: 'matching' },
  })
  return created
}

export async function matchManagers(sessionId: string, existingLeagueManagers: Manager[]): Promise<DevyManagerMapping[]> {
  await prisma.devyManagerMapping.deleteMany({ where: { sessionId } })
  const sources = await prisma.devyImportSource.findMany({ where: { sessionId } })
  const external: { username: string; displayName: string; platform: string; userId: string }[] = []

  for (const src of sources) {
    const raw = src.rawData as Record<string, unknown> | null
    if (!raw) continue
    const platform = src.sourcePlatform || 'custom'
    if (Array.isArray(raw.users)) {
      for (const u of raw.users as Record<string, unknown>[]) {
        external.push({
          userId: String(u.user_id ?? u.userId ?? ''),
          username: String(u.username ?? ''),
          displayName: String(u.display_name ?? u.displayName ?? ''),
          platform,
        })
      }
    } else if (Array.isArray(raw.players)) {
      // A CSV source has no user list — its owners are the owner column. Without a manager row
      // for each, executeMerge could not place a single CSV player on a roster.
      const seen = new Set(external.filter(e => e.platform === platform).map(e => e.username))
      for (const p of raw.players as Record<string, unknown>[]) {
        const owner = typeof p.managerExternalUserId === 'string' ? p.managerExternalUserId.trim() : ''
        if (!owner || seen.has(owner)) continue
        seen.add(owner)
        external.push({ userId: '', username: owner, displayName: owner, platform })
      }
    }
  }

  const created: DevyManagerMapping[] = []
  for (const ex of external) {
    let internalUserId: string | null = null
    let internalUsername: string | null = null
    let matchConfidence: DevyManagerMapping['matchConfidence'] = 'unmatched'
    let requiresReview = true

    const byUser = existingLeagueManagers.find(
      m => m.userId && ex.userId && m.userId === ex.userId,
    )
    if (byUser?.userId) {
      internalUserId = byUser.userId
      internalUsername = byUser.username ?? null
      matchConfidence = 'exact'
      requiresReview = false
    } else {
      const byName = existingLeagueManagers.find(
        m =>
          (m.username && ex.username && m.username.toLowerCase() === ex.username.toLowerCase()) ||
          (m.displayName && ex.displayName && normalizeName(m.displayName) === normalizeName(ex.displayName)),
      )
      if (byName?.userId) {
        internalUserId = byName.userId
        internalUsername = byName.username ?? null
        matchConfidence = 'high'
        requiresReview = false
      }
    }

    const mm = await prisma.devyManagerMapping.create({
      data: {
        sessionId,
        externalUsername: ex.username || ex.userId,
        externalDisplayName: ex.displayName || ex.username,
        externalPlatform: ex.platform,
        internalUserId,
        internalUsername,
        matchConfidence,
        isConfirmedByCommissioner: false,
        requiresReview,
      },
    })
    created.push(mm)
  }

  return created
}

export async function detectMergeConflicts(sessionId: string): Promise<DevyMergeConflict[]> {
  await prisma.devyMergeConflict.deleteMany({ where: { sessionId } })

  const mappings = await prisma.devyPlayerMapping.findMany({ where: { sessionId } })
  const conflicts: DevyMergeConflict[] = []

  const byInternal = new Map<string, typeof mappings>()
  for (const m of mappings) {
    if (!m.internalPlayerId) continue
    const list = byInternal.get(m.internalPlayerId) ?? []
    list.push(m)
    byInternal.set(m.internalPlayerId, list)
  }
  for (const [pid, list] of byInternal) {
    if (list.length > 1) {
      const c = await prisma.devyMergeConflict.create({
        data: {
          sessionId,
          conflictType: 'duplicate_player',
          description: `Player ${pid} matched from multiple external rows.`,
          affectedEntities: { playerIds: [pid], mappingIds: list.map(l => l.id) },
          resolution: 'pending',
        },
      })
      conflicts.push(c)
    }
  }

  const nflIds = new Set(
    mappings
      .filter(m => (m.playerType === 'nfl_veteran' || m.playerType === 'nfl_rookie') && m.internalPlayerId)
      .map(m => m.internalPlayerId!),
  )
  for (const m of mappings) {
    if (m.playerType === 'devy' && m.internalPlayerId && nflIds.has(m.internalPlayerId)) {
      const c = await prisma.devyMergeConflict.create({
        data: {
          sessionId,
          conflictType: 'graduated_devy_on_nfl_roster',
          description: `Player ${m.externalName} appears as devy and on NFL roster across sources.`,
          affectedEntities: { playerIds: [m.internalPlayerId] },
          resolution: 'pending',
        },
      })
      conflicts.push(c)
    }
  }

  const managers = await prisma.devyManagerMapping.findMany({ where: { sessionId } })
  for (const mgr of managers) {
    if (!mgr.internalUserId) {
      const c = await prisma.devyMergeConflict.create({
        data: {
          sessionId,
          conflictType: 'username_mismatch',
          description: `Manager ${mgr.externalDisplayName} could not be matched to an AllFantasy user.`,
          affectedEntities: { managerIds: [mgr.id] },
          resolution: 'pending',
        },
      })
      conflicts.push(c)
    }
  }

  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: { status: 'conflict_review' },
  })

  return conflicts
}
