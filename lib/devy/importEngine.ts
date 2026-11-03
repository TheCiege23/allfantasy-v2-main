import type { DevyImportSession, DevyImportSource } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SleeperPlayer } from '@/lib/sleeper-client'
import { getLeagueInfo, getLeagueRosters, getLeagueUsers, getPlayersBySport } from '@/lib/sleeper-client'

function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

export async function createImportSession(leagueId: string, commissionerId: string): Promise<DevyImportSession> {
  return prisma.devyImportSession.create({
    data: {
      leagueId,
      commissionerId,
      status: 'pending',
    },
  })
}

type ConnectionData = Record<string, unknown> & {
  leagueId?: string
  csvText?: string
  headers?: string[]
}

type SleeperNameDeps = {
  findIdentities: (sleeperIds: string[]) => Promise<Array<{ sleeperId: string | null; canonicalName: string }>>
  loadSleeperPlayers: () => Promise<Record<string, SleeperPlayer>>
}

const defaultSleeperNameDeps: SleeperNameDeps = {
  findIdentities: (sleeperIds) =>
    prisma.playerIdentityMap.findMany({
      where: { sleeperId: { in: sleeperIds } },
      select: { sleeperId: true, canonicalName: true },
    }),
  loadSleeperPlayers: () => getPlayersBySport('nfl'),
}

/**
 * A Sleeper league's rostered player ids → display names, for EVERY rostered player.
 *
 * DB-first: our identity registry (`PlayerIdentityMap.sleeperId`) names most of them. Only the ids it
 * does not know fall back to Sleeper's player map, and that map is fetched only when at least one id
 * is missing. A failed registry read falls back to the map for all ids; an id neither knows reads
 * "Player <id>", as before.
 *
 * ⚠ THIS USED TO STOP AT 120 PLAYERS (`slice(0, 120)`) after loading Sleeper's whole player map anyway,
 * so the cap saved nothing — and a 12-team league rosters ~300, leaving every player after the 120th
 * unnamed and therefore unmatched in the import wizard.
 */
export async function resolveSleeperPlayerNames(
  playerIds: string[],
  deps: SleeperNameDeps = defaultSleeperNameDeps,
): Promise<Record<string, string>> {
  const unique = [...new Set(playerIds.filter((id) => typeof id === 'string' && id.trim() !== ''))]
  const out: Record<string, string> = {}
  if (unique.length === 0) return out
  const rows = await deps.findIdentities(unique).catch(() => [])
  for (const row of rows) {
    if (row.sleeperId && row.canonicalName?.trim()) out[row.sleeperId] = row.canonicalName.trim()
  }
  const missing = unique.filter((id) => !out[id])
  if (missing.length > 0) {
    const playersById = await deps.loadSleeperPlayers().catch((): Record<string, SleeperPlayer> => ({}))
    for (const id of missing) {
      const p = playersById[id]
      out[id] = p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || `Player ${id}`
    }
  }
  return out
}

async function buildSleeperBundle(leagueId: string): Promise<Record<string, unknown>> {
  const [league, rosters, users] = await Promise.all([
    getLeagueInfo(leagueId),
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
  ])
  if (!league) throw new Error('Sleeper league fetch failed')

  const playerIds: string[] = []
  for (const r of Array.isArray(rosters) ? rosters : []) {
    const rec = r as { players?: string[] }
    if (Array.isArray(rec.players)) playerIds.push(...rec.players)
  }
  const names = await resolveSleeperPlayerNames(playerIds)

  const usersById: Record<string, { user_id?: string; display_name?: string; username?: string }> = {}
  for (const u of Array.isArray(users) ? users : []) {
    const x = u as { user_id?: string }
    if (x.user_id) usersById[x.user_id] = u as { user_id?: string; display_name?: string; username?: string }
  }

  const enrichedRosters = (Array.isArray(rosters) ? rosters : []).map((roster: unknown) => {
    const rr = roster as { owner_id?: string; players?: string[]; roster_id?: number }
    const owner = rr.owner_id ? usersById[rr.owner_id] : undefined
    return {
      ...rr,
      ownerUsername: owner?.username,
      ownerDisplayName: owner?.display_name,
    }
  })

  return {
    platform: 'sleeper',
    league,
    rosters: enrichedRosters,
    users,
    sleeperPlayerNames: names,
    fetchedAt: new Date().toISOString(),
  }
}

function parseCsvToNormalized(csvText: string): Record<string, unknown> {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { csvRows: [], players: [] }
  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    const row: Record<string, string> = {}
    header.forEach((h, idx) => {
      row[h] = cols[idx] ?? ''
    })
    rows.push(row)
  }
  const players = rows.map((row, idx) => ({
    externalId: row.player_id || row.id || `csv_${idx}`,
    externalName: row.name || row.player || row.player_name || `Row ${idx}`,
    externalPosition: row.position || row.pos,
    externalTeam: row.team || row.nfl_team,
    externalSchool: row.school || row.college,
    managerExternalUserId: row.owner || row.username || row.user,
  }))
  return { csvRows: rows, header, players }
}

export async function connectSource(
  sessionId: string,
  sourceType: string,
  sourcePlatform: string,
  classification: string,
  connectionData: ConnectionData,
): Promise<DevyImportSource> {
  let rawData: Record<string, unknown> = { sourceType, sourcePlatform, classification }
  let connectionStatus: 'connected' | 'failed' | 'partial' = 'failed'

  try {
    if (sourceType === 'direct_connector') {
      if (sourcePlatform === 'sleeper' && connectionData.leagueId) {
        rawData = { ...(await buildSleeperBundle(String(connectionData.leagueId))), ...rawData }
        connectionStatus = 'connected'
      } else {
        rawData.connectionHint = 'No public connector for this platform; use league_id_entry or csv_upload.'
        connectionStatus = 'partial'
      }
    } else if (sourceType === 'league_id_entry') {
      if (sourcePlatform === 'sleeper' && connectionData.leagueId) {
        rawData = { ...(await buildSleeperBundle(String(connectionData.leagueId))), ...rawData }
        connectionStatus = 'connected'
      } else {
        rawData.storedLeagueId = connectionData.leagueId
        connectionStatus = 'partial'
      }
    } else if (sourceType === 'csv_upload') {
      const csvText = typeof connectionData.csvText === 'string' ? connectionData.csvText : ''
      rawData = { ...parseCsvToNormalized(csvText), ...rawData }
      connectionStatus = csvText.length > 0 ? 'connected' : 'failed'
    } else if (sourceType === 'manual') {
      rawData = {
        manualTemplate: true,
        fields: ['player_name', 'position', 'team', 'school', 'owner_username'],
        connectionData,
      }
      connectionStatus = 'connected'
    } else {
      rawData.unsupported = sourceType
      connectionStatus = 'failed'
    }
  } catch (e) {
    rawData.error = e instanceof Error ? e.message : 'unknown_error'
    connectionStatus = 'failed'
  }

  const src = await prisma.devyImportSource.create({
    data: {
      sessionId,
      sourceType,
      sourcePlatform: sourcePlatform || null,
      classification: classification || null,
      connectionStatus,
      rawData: rawData as object,
      importedAt: connectionStatus === 'connected' ? new Date() : null,
    },
  })

  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: { status: 'source_connected' },
  })

  return src
}

export async function classifySources(sessionId: string, classifications: Record<string, string>): Promise<void> {
  for (const id of Object.keys(classifications)) {
    await prisma.devyImportSource.updateMany({
      where: { id, sessionId },
      data: { classification: classifications[id] },
    })
  }

  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: { status: 'classified' },
  })
}
