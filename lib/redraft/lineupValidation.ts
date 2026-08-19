import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'

export type RedraftLineupIssueSeverity = 'error' | 'warning'

export type RedraftLineupValidationIssue = {
  code: string
  severity: RedraftLineupIssueSeverity
  message: string
  playerId?: string
  playerName?: string
  slotType?: string
}

export type RedraftLineupValidationResult = {
  ok: boolean
  issues: RedraftLineupValidationIssue[]
  errorCount: number
  warningCount: number
}

export type RedraftLineupPlayer = {
  id?: string
  playerId: string
  playerName: string
  position: string
  team?: string | null
  sport: string
  slotType: string
  isLocked?: boolean | null
  injuryStatus?: string | null
  byeWeek?: number | null
  droppedAt?: Date | string | null
}

export type RedraftLineupMove = {
  playerId: string
  fromSlot?: string
  toSlot: string
}

const REQUIRED_FOOTBALL_POSITIONS = ['QB', 'RB', 'WR'] as const
const NON_STARTER_SLOTS = new Set(['BENCH', 'BN', 'IR', 'TAXI', 'DEVY', 'RESERVE'])
const INJURY_ERROR_STATUSES = new Set([
  'OUT',
  'O',
  'IR',
  'INJURED_RESERVE',
  'INJURED RESERVE',
  'PUP',
  'NFI',
  'RESERVE',
  'SUSP',
  'SUSPENDED',
  'COVID',
  'COVID-19',
  'INACTIVE',
  'DNR',
])
const INJURY_WARNING_STATUSES = new Set(['QUESTIONABLE', 'Q', 'DOUBTFUL', 'D'])

export function normalizeToken(input: string | null | undefined): string {
  const value = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '_')
  if (value === 'D/ST' || value === 'DST' || value === 'DEFENSE') return 'DEF'
  if (value === 'FLEX') return 'FLX'
  if (value === 'SUPERFLEX' || value === 'SUPER_FLEX') return 'SF'
  if (value === 'BN') return 'BENCH'
  return value
}

function issue(input: Omit<RedraftLineupValidationIssue, 'severity'> & { severity?: RedraftLineupIssueSeverity }) {
  return {
    severity: input.severity ?? 'error',
    ...input,
  }
}

function activePlayers(players: RedraftLineupPlayer[]): RedraftLineupPlayer[] {
  return players.filter((player) => !player.droppedAt)
}

function starterCapacityBySlot(sport: string): Map<string, number> {
  const config = getRedraftSportConfig(sport)
  const counts = new Map<string, number>()
  for (const slot of config.starterSlots) {
    const normalized = normalizeToken(slot)
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return counts
}

function allowedPositionsForSlot(sport: string, slotType: string): string[] {
  const config = getRedraftSportConfig(sport)
  const slot = normalizeToken(slotType)
  const flexPositions = config.flexPositions[slot]
  if (flexPositions?.length) return flexPositions.map(normalizeToken)
  return [slot]
}

function isStarterSlot(slotType: string, capacities: Map<string, number>): boolean {
  return capacities.has(normalizeToken(slotType))
}

function isNonStarterSlot(slotType: string): boolean {
  return NON_STARTER_SLOTS.has(normalizeToken(slotType))
}

function isPlayerEligibleForSlot(sport: string, player: RedraftLineupPlayer, capacities: Map<string, number>): boolean {
  const slot = normalizeToken(player.slotType)
  const position = normalizeToken(player.position)
  if (!slot || !position || !isStarterSlot(slot, capacities)) return true
  return allowedPositionsForSlot(sport, slot).includes(position)
}

function normalizedInjuryStatus(player: RedraftLineupPlayer): string {
  return normalizeToken(player.injuryStatus)
}

export function applyRedraftLineupMoves(
  players: RedraftLineupPlayer[],
  moves: RedraftLineupMove[],
): { players: RedraftLineupPlayer[]; issues: RedraftLineupValidationIssue[] } {
  const issues: RedraftLineupValidationIssue[] = []
  const byPlayerId = new Map(activePlayers(players).map((player) => [player.playerId, player]))
  const moveByPlayerId = new Map<string, RedraftLineupMove>()

  for (const move of moves) {
    const playerId = String(move.playerId ?? '').trim()
    const toSlot = String(move.toSlot ?? '').trim()
    if (!playerId || !toSlot) {
      issues.push(issue({ code: 'invalid_lineup_move', message: 'Lineup moves must include playerId and toSlot.' }))
      continue
    }
    const player = byPlayerId.get(playerId)
    if (!player) {
      issues.push(issue({ code: 'player_not_on_roster', message: `Player ${playerId} is not active on this roster.`, playerId }))
      continue
    }
    const fromSlot = String(move.fromSlot ?? '').trim()
    if (fromSlot && normalizeToken(fromSlot) !== normalizeToken(player.slotType)) {
      issues.push(
        issue({
          code: 'lineup_move_source_mismatch',
          message: `${player.playerName} is no longer in ${fromSlot}. Refresh before saving lineup changes.`,
          playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
      continue
    }
    if (player.isLocked && normalizeToken(player.slotType) !== normalizeToken(toSlot)) {
      issues.push(
        issue({
          code: 'locked_player_move',
          message: `${player.playerName} is locked and cannot be moved from ${player.slotType}.`,
          playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
      continue
    }
    moveByPlayerId.set(playerId, { ...move, playerId, toSlot })
  }

  return {
    issues,
    players: players.map((player) => {
      const move = moveByPlayerId.get(player.playerId)
      return move ? { ...player, slotType: move.toSlot } : player
    }),
  }
}

export function validateRedraftLineup(args: {
  sport: string
  week: number
  players: RedraftLineupPlayer[]
  previousPlayers?: RedraftLineupPlayer[]
  extraIssues?: RedraftLineupValidationIssue[]
  /**
   * Commissioner roster config (G10). When provided, starter slot set + capacities
   * and bench/IR/taxi limits come from the league's settings; when omitted, the
   * static sport-config defaults are used (backward-compatible).
   */
  rosterConfig?: ResolvedRosterConfig
}): RedraftLineupValidationResult {
  const sport = args.sport
  const week = Math.max(1, Math.floor(Number(args.week) || 1))
  const issues: RedraftLineupValidationIssue[] = [...(args.extraIssues ?? [])]
  const players = activePlayers(args.players)
  const previousByPlayerId = new Map(activePlayers(args.previousPlayers ?? []).map((player) => [player.playerId, player]))
  const capacities = args.rosterConfig?.starterCapacities ?? starterCapacityBySlot(sport)
  const starterCounts = new Map<string, number>()
  const startedPositionCounts = new Map<string, number>()
  const seen = new Set<string>()

  for (const player of players) {
    if (seen.has(player.playerId)) {
      issues.push(
        issue({
          code: 'duplicate_player',
          message: `${player.playerName} appears more than once on the active roster.`,
          playerId: player.playerId,
          playerName: player.playerName,
        }),
      )
      continue
    }
    seen.add(player.playerId)

    const slot = normalizeToken(player.slotType)
    const previous = previousByPlayerId.get(player.playerId)
    if (previous?.isLocked && normalizeToken(previous.slotType) !== slot) {
      issues.push(
        issue({
          code: 'locked_player_move',
          message: `${player.playerName} is locked and cannot be moved from ${previous.slotType}.`,
          playerId: player.playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
    }

    if (!isStarterSlot(slot, capacities)) {
      if (!isNonStarterSlot(slot)) {
        issues.push(
          issue({
            code: 'illegal_lineup_slot',
            message: `${player.playerName} is assigned to unsupported slot ${player.slotType}.`,
            playerId: player.playerId,
            playerName: player.playerName,
            slotType: player.slotType,
          }),
        )
      }
      continue
    }

    starterCounts.set(slot, (starterCounts.get(slot) ?? 0) + 1)
    const position = normalizeToken(player.position)
    if (position) startedPositionCounts.set(position, (startedPositionCounts.get(position) ?? 0) + 1)

    if (!isPlayerEligibleForSlot(sport, player, capacities)) {
      issues.push(
        issue({
          code: 'starter_position_ineligible',
          message: `${player.playerName} (${player.position}) is not eligible for ${player.slotType}.`,
          playerId: player.playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
    }

    if (player.byeWeek != null && Number(player.byeWeek) === week) {
      issues.push(
        issue({
          code: 'starter_on_bye',
          message: `${player.playerName} is on bye in Week ${week} and cannot be started.`,
          playerId: player.playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
    }

    const injuryStatus = normalizedInjuryStatus(player)
    if (INJURY_ERROR_STATUSES.has(injuryStatus)) {
      issues.push(
        issue({
          code: 'starter_ineligible_injury',
          message: `${player.playerName} is ${player.injuryStatus} and cannot be started.`,
          playerId: player.playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
    } else if (INJURY_WARNING_STATUSES.has(injuryStatus)) {
      issues.push(
        issue({
          code: 'starter_injury_risk',
          severity: 'warning',
          message: `${player.playerName} is ${player.injuryStatus}; confirm status before lock.`,
          playerId: player.playerId,
          playerName: player.playerName,
          slotType: player.slotType,
        }),
      )
    }
  }

  for (const [slot, count] of starterCounts) {
    const capacity = capacities.get(slot) ?? 0
    if (count > capacity) {
      issues.push(
        issue({
          code: 'starter_slot_overflow',
          message: `${slot} has ${count} starters but only ${capacity} slot${capacity === 1 ? '' : 's'} are allowed.`,
          slotType: slot,
        }),
      )
    }
  }

  for (const [slot, capacity] of capacities) {
    const count = starterCounts.get(slot) ?? 0
    if (count < capacity) {
      issues.push(
        issue({
          code: 'missing_starter_slot',
          message: `${slot} requires ${capacity} starter${capacity === 1 ? '' : 's'}; currently ${count}.`,
          slotType: slot,
        }),
      )
    }
  }

  for (const position of REQUIRED_FOOTBALL_POSITIONS) {
    if (!capacities.has(position)) continue
    if ((startedPositionCounts.get(position) ?? 0) === 0) {
      issues.push(
        issue({
          code: 'missing_required_position',
          message: `${position} is required in every legal lineup.`,
          slotType: position,
        }),
      )
    }
  }

  // Bench / IR / taxi limits + max roster size — only when the commissioner roster
  // config is known (G10). Counts active players by slot category against limits.
  const rc = args.rosterConfig
  if (rc) {
    let bench = 0
    let ir = 0
    let taxi = 0
    for (const player of players) {
      const slot = normalizeToken(player.slotType)
      if (slot === 'BENCH') bench += 1
      else if (slot === 'IR' || slot === 'RESERVE') ir += 1
      else if (slot === 'TAXI' || slot === 'DEVY') taxi += 1
    }
    if (bench > rc.benchSlots) {
      issues.push(issue({ code: 'bench_slot_overflow', message: `Bench has ${bench} players but only ${rc.benchSlots} bench slot${rc.benchSlots === 1 ? '' : 's'} are allowed.`, slotType: 'BENCH' }))
    }
    if (ir > rc.irSlots) {
      issues.push(issue({ code: 'ir_slot_overflow', message: `IR has ${ir} players but only ${rc.irSlots} IR slot${rc.irSlots === 1 ? '' : 's'} are allowed.`, slotType: 'IR' }))
    }
    if (taxi > rc.taxiSlots) {
      issues.push(
        issue({
          code: rc.taxiSlots === 0 ? 'taxi_not_enabled' : 'taxi_slot_overflow',
          message: rc.taxiSlots === 0 ? 'Taxi squad is not enabled for this league.' : `Taxi has ${taxi} players but only ${rc.taxiSlots} taxi slot${rc.taxiSlots === 1 ? '' : 's'} are allowed.`,
          slotType: 'TAXI',
        }),
      )
    }
    if (players.length > rc.maxRosterSize) {
      issues.push(issue({ code: 'roster_over_max', message: `Roster has ${players.length} players but the league max is ${rc.maxRosterSize}.` }))
    }
  }

  const errorCount = issues.filter((entry) => entry.severity === 'error').length
  const warningCount = issues.length - errorCount
  return {
    ok: errorCount === 0,
    issues,
    errorCount,
    warningCount,
  }
}
