import { DEFAULT_SPORT, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import type { LineupOptimizerSportKey } from './types'
import type {
  LineupOptimizerInput,
  LineupOptimizerResult,
  OptimizerPlayerInput,
  OptimizerSlotInput,
} from './types'

type NormalizedPlayer = {
  id: string
  name: string
  team?: string
  projectedPoints: number
  positions: string[]
}

type NormalizedSlot = {
  id: string
  code: string
  label: string
  allowedPositions: Set<string>
  required: boolean
}

const FLEX_GROUPS: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  SFLEX: ['QB', 'RB', 'WR', 'TE'],
  UTIL: [
    'PG',
    'SG',
    'SF',
    'PF',
    'C',
    'QB',
    'RB',
    'WR',
    'TE',
    'GKP',
    'DEF',
    'MID',
    'FWD',
    'C',
    'LW',
    'RW',
    'D',
    'G',
    'SP',
    'RP',
    'P',
    '1B',
    '2B',
    '3B',
    'SS',
    'OF',
    'GOLFER',
    'DRIVER',
  ],
  ANY: [
    'PG',
    'SG',
    'SF',
    'PF',
    'C',
    'QB',
    'RB',
    'WR',
    'TE',
    'GKP',
    'DEF',
    'MID',
    'FWD',
    'C',
    'LW',
    'RW',
    'D',
    'G',
    'SP',
    'RP',
    'P',
    '1B',
    '2B',
    '3B',
    'SS',
    'OF',
    'GOLFER',
    'DRIVER',
  ],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
  W: ['LW', 'RW'],
}

const DEFAULT_SLOT_CODES: Record<SupportedSport, string[]> = {
  NFL: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DST'],
  NCAAF: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DST'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
  NCAAB: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
  NHL: ['C', 'C', 'LW', 'RW', 'D', 'D', 'G', 'UTIL'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'SP', 'RP', 'UTIL'],
  SOCCER: ['GKP', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD', 'UTIL'],
}

export function resolveOptimizerSportKey(raw?: string): LineupOptimizerSportKey {
  const u = raw?.trim().toUpperCase() ?? ''
  if (u === 'PGA' || u === 'GOLF') return 'GOLF'
  if (u === 'CUP' || u === 'NASCAR') return 'NASCAR'
  return normalizeToSupportedSport(raw)
}

export function defaultSlotCodesForSport(sportKey: LineupOptimizerSportKey): string[] {
  if (sportKey === 'GOLF') return ['GOLFER', 'GOLFER', 'GOLFER', 'GOLFER']
  if (sportKey === 'NASCAR') return ['DRIVER', 'DRIVER', 'DRIVER', 'DRIVER', 'FLEX']
  return DEFAULT_SLOT_CODES[sportKey]
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

function normalizePositionToken(raw: string): string {
  const token = raw.trim().toUpperCase()
  if (!token) return ''
  if (token === 'PK' || token === 'KICKER') return 'K'
  if (token === 'DEF/ST' || token === 'D/ST') return 'DST'
  return token
}

function parsePositions(rawPositions: string[]): string[] {
  const out = new Set<string>()
  for (const raw of rawPositions) {
    const parts = String(raw ?? '')
      .split(/[\/,|]+/)
      .map((part) => normalizePositionToken(part))
      .filter(Boolean)
    for (const part of parts) out.add(part)
  }
  return Array.from(out)
}

function normalizePlayers(players: OptimizerPlayerInput[]): NormalizedPlayer[] {
  return players
    .map((player, index) => {
      const positions = parsePositions(player.positions ?? [])
      const projectedPoints = Number(player.projectedPoints ?? 0)
      return {
        id: player.id?.trim() || `${player.name}-${index}`,
        name: player.name?.trim() || `Player ${index + 1}`,
        team: player.team?.trim() || undefined,
        projectedPoints: Number.isFinite(projectedPoints) ? projectedPoints : 0,
        positions,
      }
    })
    .filter((player) => player.positions.length > 0)
}

function slotAllowedPositions(code: string): string[] {
  const normalizedCode = normalizePositionToken(code)
  const flexAllowed = FLEX_GROUPS[normalizedCode]
  if (flexAllowed) return Array.from(new Set(flexAllowed))
  return [normalizedCode]
}

function normalizeSlots(input: {
  sport: LineupOptimizerSportKey
  slots?: OptimizerSlotInput[]
}): NormalizedSlot[] {
  const fallbackSlots: OptimizerSlotInput[] = defaultSlotCodesForSport(input.sport).map((code) => ({ code }))
  const sourceSlots: OptimizerSlotInput[] = input.slots?.length ? input.slots : fallbackSlots
  const slotInputs = sourceSlots.map((slot, index) => ({
    ...slot,
    id: slot.id?.trim() || `${slot.code}-${index + 1}`,
    code: normalizePositionToken(slot.code),
    label: slot.label?.trim() || normalizePositionToken(slot.code),
    required: slot.required !== false,
    allowedPositions: slot.allowedPositions?.length
      ? parsePositions(slot.allowedPositions)
      : slotAllowedPositions(slot.code),
  }))

  return slotInputs.map((slot) => ({
    id: slot.id,
    code: slot.code,
    label: slot.label,
    required: slot.required,
    allowedPositions: new Set(slot.allowedPositions),
  }))
}

function isPlayerEligibleForSlot(player: NormalizedPlayer, slot: NormalizedSlot): boolean {
  for (const position of player.positions) {
    if (slot.allowedPositions.has(position)) return true
  }
  return false
}

function bestEligiblePosition(player: NormalizedPlayer, slot: NormalizedSlot): string {
  return player.positions.find((position) => slot.allowedPositions.has(position)) ?? player.positions[0] ?? 'UTIL'
}

function buildDeterministicNotes(result: LineupOptimizerResult): string[] {
  const notes: string[] = []
  notes.push(`Deterministic optimizer maximized projected points to ${result.totalProjectedPoints.toFixed(1)}.`)
  if (result.unfilledSlots.length > 0) {
    notes.push(`Unfilled required slots: ${result.unfilledSlots.map((slot) => slot.slotCode).join(', ')}.`)
  } else {
    notes.push('All required lineup slots were filled with eligible players.')
  }
  if (result.bench.length > 0) {
    notes.push(`Top bench projection: ${result.bench[0].playerName} (${result.bench[0].projectedPoints.toFixed(1)}).`)
  }
  return notes
}

export function optimizeLineupDeterministic(input: LineupOptimizerInput): LineupOptimizerResult {
  const sport = resolveOptimizerSportKey(input.sport ?? DEFAULT_SPORT)
  const players = normalizePlayers(input.players)
  const slots = normalizeSlots({ sport, slots: input.slots })

  const sortedSlots = [...slots].sort((slotA, slotB) => {
    const countA = players.filter((player) => isPlayerEligibleForSlot(player, slotA)).length
    const countB = players.filter((player) => isPlayerEligibleForSlot(player, slotB)).length
    if (countA !== countB) return countA - countB
    return slotA.allowedPositions.size - slotB.allowedPositions.size
  })

  const memo = new Map<string, { score: number; assignment: Array<number | null> }>()

  function dfs(slotIndex: number, usedMask: bigint): { score: number; assignment: Array<number | null> } {
    if (slotIndex >= sortedSlots.length) {
      return { score: 0, assignment: [] }
    }

    const cacheKey = `${slotIndex}:${usedMask.toString()}`
    const cached = memo.get(cacheKey)
    if (cached) return cached

    const slot = sortedSlots[slotIndex]
    let best: { score: number; assignment: Array<number | null> } | null = null

    for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
      const used = (usedMask & (1n << BigInt(playerIndex))) !== 0n
      if (used) continue
      const player = players[playerIndex]
      if (!isPlayerEligibleForSlot(player, slot)) continue

      const next = dfs(slotIndex + 1, usedMask | (1n << BigInt(playerIndex)))
      const score = player.projectedPoints + next.score
      if (!best || score > best.score) {
        best = {
          score,
          assignment: [playerIndex, ...next.assignment],
        }
      }
    }

    // Allow unfilled optional slots or required slots with no eligible players.
    if (!best && !slot.required) {
      const next = dfs(slotIndex + 1, usedMask)
      best = {
        score: next.score,
        assignment: [null, ...next.assignment],
      }
    }
    if (!best) {
      const next = dfs(slotIndex + 1, usedMask)
      best = {
        score: next.score,
        assignment: [null, ...next.assignment],
      }
    }

    memo.set(cacheKey, best)
    return best
  }

  const solved = dfs(0, 0n)
  const assignedPlayerIds = new Set<string>()
  const starters: LineupOptimizerResult['starters'] = []
  const unfilledSlots: LineupOptimizerResult['unfilledSlots'] = []

  for (let i = 0; i < sortedSlots.length; i += 1) {
    const slot = sortedSlots[i]
    const playerIndex = solved.assignment[i]
    if (playerIndex == null) {
      unfilledSlots.push({
        slotId: slot.id,
        slotCode: slot.code,
        slotLabel: slot.label,
      })
      continue
    }
    const player = players[playerIndex]
    assignedPlayerIds.add(player.id)
    starters.push({
      slotId: slot.id,
      slotCode: slot.code,
      slotLabel: slot.label,
      playerId: player.id,
      playerName: player.name,
      playerTeam: player.team,
      projectedPoints: roundToTenth(player.projectedPoints),
      selectedPosition: bestEligiblePosition(player, slot),
    })
  }

  starters.sort((starterA, starterB) => starterB.projectedPoints - starterA.projectedPoints)

  const bench = players
    .filter((player) => !assignedPlayerIds.has(player.id))
    .sort((playerA, playerB) => playerB.projectedPoints - playerA.projectedPoints)
    .map((player) => ({
      playerId: player.id,
      playerName: player.name,
      projectedPoints: roundToTenth(player.projectedPoints),
      positions: player.positions,
    }))

  const result: LineupOptimizerResult = {
    sport,
    totalProjectedPoints: roundToTenth(starters.reduce((sum, starter) => sum + starter.projectedPoints, 0)),
    starters,
    bench,
    unfilledSlots,
    deterministicNotes: [],
  }
  result.deterministicNotes = buildDeterministicNotes(result)
  return result
}
