import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

export type TradeRosterViolation = {
  franchiseId: string
  code: 'ROSTER_SIZE_EXCEEDED' | 'INVALID_IR_ASSIGNMENT' | 'DUPLICATE_PLAYER' | 'PLAYER_POOL_RESTRICTED' | 'UNRESOLVED_PLAYER_IDENTITY'
  message: string
  playerId?: string
  slot?: string
  limit?: number
  actual?: number
}

export type TradeRosterPlayer = {
  playerId: string
  position: string
  sport: string
  team?: string | null
  slotType?: string | null
  injuryStatus?: string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function validateProjectedRedraftRoster(input: {
  franchiseId: string
  sport: string
  leagueSettings: unknown
  currentPlayers: TradeRosterPlayer[]
  outgoingPlayerIds: string[]
  incomingPlayers: TradeRosterPlayer[]
}) {
  const outgoing = new Set(input.outgoingPlayerIds)
  const projected = [...input.currentPlayers.filter((player) => !outgoing.has(player.playerId)), ...input.incomingPlayers]
  const violations: TradeRosterViolation[] = []
  const config = resolveRedraftRosterConfig(input.sport, input.leagueSettings)
  const ids = new Set<string>()
  const settings = record(input.leagueSettings)
  const playerPool = record(settings.playerPool ?? settings.player_pool)
  const allowedSchools = Array.isArray(playerPool.schoolIds) ? new Set(playerPool.schoolIds.map(String)) : null
  const allowedConferences = Array.isArray(playerPool.conferences) ? new Set(playerPool.conferences.map(String)) : null
  const allowFcs = playerPool.includeFcs === true

  for (const player of projected) {
    if (!player.playerId || !player.position || !player.sport) {
      violations.push({ franchiseId: input.franchiseId, code: 'UNRESOLVED_PLAYER_IDENTITY', message: 'A roster player has incomplete identity or eligibility data.', playerId: player.playerId || undefined })
      continue
    }
    if (ids.has(player.playerId)) violations.push({ franchiseId: input.franchiseId, code: 'DUPLICATE_PLAYER', message: 'The projected roster contains the same player more than once.', playerId: player.playerId })
    ids.add(player.playerId)
    if (player.sport.toUpperCase() !== input.sport.toUpperCase()) violations.push({ franchiseId: input.franchiseId, code: 'PLAYER_POOL_RESTRICTED', message: 'A player is outside the league sport pool.', playerId: player.playerId })
    const metadata = record(player as unknown)
    if (input.sport.toUpperCase() === 'NCAAF') {
      if (!allowFcs && String(metadata.division ?? '').toUpperCase() === 'FCS') violations.push({ franchiseId: input.franchiseId, code: 'PLAYER_POOL_RESTRICTED', message: 'FCS players are not enabled for this league.', playerId: player.playerId })
      if (allowedSchools && metadata.schoolId && !allowedSchools.has(String(metadata.schoolId))) violations.push({ franchiseId: input.franchiseId, code: 'PLAYER_POOL_RESTRICTED', message: 'A player is outside the configured school pool.', playerId: player.playerId })
      if (allowedConferences && metadata.conference && !allowedConferences.has(String(metadata.conference))) violations.push({ franchiseId: input.franchiseId, code: 'PLAYER_POOL_RESTRICTED', message: 'A player is outside the configured conference pool.', playerId: player.playerId })
    }
    if (String(player.slotType ?? '').toUpperCase() === 'IR' && !player.injuryStatus) violations.push({ franchiseId: input.franchiseId, code: 'INVALID_IR_ASSIGNMENT', message: 'A healthy or unresolved player cannot occupy IR.', playerId: player.playerId, slot: 'IR' })
  }
  if (projected.length > config.maxRosterSize) violations.push({ franchiseId: input.franchiseId, code: 'ROSTER_SIZE_EXCEEDED', message: `Projected roster exceeds the saved limit of ${config.maxRosterSize}.`, limit: config.maxRosterSize, actual: projected.length })
  return { legal: violations.length === 0, projectedRoster: { playerIds: projected.map((player) => player.playerId), activeCount: projected.filter((player) => !['BENCH', 'BN', 'IR'].includes(String(player.slotType ?? '').toUpperCase())).length, benchCount: projected.filter((player) => ['BENCH', 'BN'].includes(String(player.slotType ?? '').toUpperCase())).length, irCount: projected.filter((player) => String(player.slotType ?? '').toUpperCase() === 'IR').length }, violations, warnings: [] as Array<{ code: string; message: string }> }
}
