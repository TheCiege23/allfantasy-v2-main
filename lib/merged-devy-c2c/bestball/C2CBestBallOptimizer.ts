/**
 * C2C best ball: pro side and optional college side. PROMPT 2/6.
 * Pro side reuses devy optimizer (college players excluded until promoted). College side optimizes college lineup when enabled.
 */

import type { C2CLeagueConfigShape, C2CLineupSlots } from '../types'
import {
  optimizeNflBestBallLineup,
  optimizeNbaBestBallLineup,
  DEFAULT_NFL_BESTBALL_SLOTS,
  DEFAULT_NBA_BESTBALL_SLOTS,
  type BestBallPlayerInput,
  type DevyBestBallSlotsNFL,
  type DevyBestBallSlotsNBA,
} from '@/lib/devy/bestball/DevyBestBallOptimizer'
import { getC2CAdapterForSport } from '../types'
import { NFL_C2C_COLLEGE_LINEUP_DEFAULT, NBA_C2C_COLLEGE_LINEUP_DEFAULT } from '../constants'

export interface C2CBestBallResult {
  pro: { totalPoints: number; starters: BestBallPlayerInput[] }
  college?: { totalPoints: number; starters: BestBallPlayerInput[] }
}

/**
 * Optimize pro best ball lineup. College (isNcaaDevy) players excluded; taxi per config.
 */
export function optimizeC2CProBestBall(
  players: BestBallPlayerInput[],
  config: C2CLeagueConfigShape
): { totalPoints: number; starters: BestBallPlayerInput[] } {
  const adapterId = getC2CAdapterForSport(config.sport)
  const slots: DevyBestBallSlotsNFL | DevyBestBallSlotsNBA =
    adapterId === 'nfl_c2c'
      ? {
          ...DEFAULT_NFL_BESTBALL_SLOTS,
          superflex: (config.proLineupSlots as Record<string, number>)?.SUPER_FLEX === 1,
        }
      : DEFAULT_NBA_BESTBALL_SLOTS

  const devyConfig = {
    taxiProRookiesScoreInBestBall: false,
  }

  if (adapterId === 'nfl_c2c') {
    return optimizeNflBestBallLineup(players, slots as DevyBestBallSlotsNFL, devyConfig)
  }
  return optimizeNbaBestBallLineup(players, slots as DevyBestBallSlotsNBA, devyConfig)
}

/**
 * Optimize college best ball lineup when config.bestBallCollege. Only college-eligible, non-promoted players.
 */
export function optimizeC2CCollegeBestBall(
  players: BestBallPlayerInput[],
  config: C2CLeagueConfigShape
): { totalPoints: number; starters: BestBallPlayerInput[] } {
  const collegeOnly = players.filter((p) => p.isNcaaDevy && !p.isProRookie)
  const adapterId = getC2CAdapterForSport(config.sport)
  const slots = config.collegeActiveLineupSlots ??
    (adapterId === 'nfl_c2c' ? NFL_C2C_COLLEGE_LINEUP_DEFAULT : NBA_C2C_COLLEGE_LINEUP_DEFAULT)

  if (adapterId === 'nfl_c2c') {
    const byPos: Record<string, typeof collegeOnly> = { QB: [], RB: [], WR: [], TE: [] }
    for (const p of collegeOnly) {
      const pos = p.position?.toUpperCase() ?? 'WR'
      if (byPos[pos]) byPos[pos].push(p)
    }
    for (const k of Object.keys(byPos)) {
      byPos[k].sort((a, b) => b.points - a.points)
    }
    const used = new Set<string>()
    const starters: BestBallPlayerInput[] = []
    const take = (pos: string, count: number) => {
      const pool = byPos[pos] ?? []
      let n = 0
      for (const p of pool) {
        if (n >= count) break
        if (used.has(p.playerId)) continue
        used.add(p.playerId)
        starters.push(p)
        n++
      }
    }
    take('QB', slots.QB ?? 0)
    take('RB', slots.RB ?? 0)
    take('WR', slots.WR ?? 0)
    take('TE', slots.TE ?? 0)
    const flexPool = collegeOnly.filter((p) => !used.has(p.playerId) && ['RB', 'WR', 'TE'].includes(p.position?.toUpperCase() ?? ''))
    flexPool.sort((a, b) => b.points - a.points)
    for (let i = 0; i < (slots.FLEX ?? 0) && i < flexPool.length; i++) {
      used.add(flexPool[i].playerId)
      starters.push(flexPool[i])
    }
    const totalPoints = starters.reduce((s, p) => s + p.points, 0)
    return { totalPoints, starters }
  }

  const NBA_G = new Set(['PG', 'SG', 'G'])
  const NBA_F = new Set(['SF', 'PF', 'F'])
  const NBA_C = new Set(['C'])
  const mapSlot = (pos: string): 'G' | 'F' | 'C' => {
    const u = pos.toUpperCase()
    if (NBA_G.has(u)) return 'G'
    if (NBA_F.has(u)) return 'F'
    if (NBA_C.has(u)) return 'C'
    return 'F'
  }
  const withSlot = collegeOnly.map((p) => ({ ...p, slot: mapSlot(p.position ?? '') }))
  const bySlot: Record<string, typeof withSlot> = { G: [], F: [], C: [] }
  for (const p of withSlot) {
    bySlot[p.slot].push(p)
  }
  for (const k of Object.keys(bySlot)) {
    bySlot[k].sort((a, b) => b.points - a.points)
  }
  const used = new Set<string>()
  const starters: BestBallPlayerInput[] = []
  const take = (slot: 'G' | 'F' | 'C', count: number) => {
    const pool = bySlot[slot] ?? []
    let n = 0
    for (const p of pool) {
      if (n >= count) break
      if (used.has(p.playerId)) continue
      used.add(p.playerId)
      starters.push(p)
      n++
    }
  }
  take('G', slots.G ?? 0)
  take('F', slots.F ?? 0)
  take('C', slots.C ?? 0)
  const flexPool = withSlot.filter((p) => !used.has(p.playerId))
  flexPool.sort((a, b) => b.points - a.points)
  for (let i = 0; i < (slots.FLEX ?? 0) && i < flexPool.length; i++) {
    used.add(flexPool[i].playerId)
    starters.push(flexPool[i])
  }
  const totalPoints = starters.reduce((s, p) => s + p.points, 0)
  return { totalPoints, starters }
}

/**
 * Full C2C best ball: pro + optional college.
 */
export function optimizeC2CBestBall(
  players: BestBallPlayerInput[],
  config: C2CLeagueConfigShape
): C2CBestBallResult {
  const pro = optimizeC2CProBestBall(players, config)
  const result: C2CBestBallResult = { pro }
  if (config.bestBallCollege) {
    result.college = optimizeC2CCollegeBestBall(players, config)
  }
  return result
}
