import type { LineupSlotDef, OptimizerPlayer, SlotAssignment } from './types'

/** Valid [DEF, MID, FWD] outfield counts (GK separate). */
const SOCCER_VALID_FORMATIONS: [number, number, number][] = [
  [3, 4, 3],
  [3, 5, 2],
  [4, 3, 3],
  [4, 4, 2],
  [4, 5, 1],
  [5, 3, 2],
  [5, 4, 1],
]

function byPos(players: OptimizerPlayer[], pos: string): OptimizerPlayer[] {
  return players.filter((p) => p.position === pos)
}

/**
 * Pick best valid formation by total fantasy points (top-N per line).
 */
export function optimizeSoccerFormation(
  ranked: OptimizerPlayer[],
  _template: { lineupSlots: unknown },
): { assignments: SlotAssignment[]; totalPoints: number; formation: string; log?: string } {
  const gks = byPos(ranked, 'GK').sort((a, b) => b.points - a.points)
  const defs = byPos(ranked, 'DEF').sort((a, b) => b.points - a.points)
  const mids = byPos(ranked, 'MID').sort((a, b) => b.points - a.points)
  const fwds = byPos(ranked, 'FWD').sort((a, b) => b.points - a.points)

  let best: {
    assignments: SlotAssignment[]
    totalPoints: number
    formation: string
  } | null = null

  for (const [d, m, f] of SOCCER_VALID_FORMATIONS) {
    if (defs.length < d || mids.length < m || fwds.length < f || gks.length < 1) continue
    const assignments: SlotAssignment[] = []
    assignments.push({ slot: 'GK', player: gks[0]! })
    for (let i = 0; i < d; i++) assignments.push({ slot: 'DEF', player: defs[i]! })
    for (let i = 0; i < m; i++) assignments.push({ slot: 'MID', player: mids[i]! })
    for (let i = 0; i < f; i++) assignments.push({ slot: 'FWD', player: fwds[i]! })
    const total = assignments.reduce((s, a) => s + a.player.points, 0)
    const formation = `${d}-${m}-${f}`
    if (!best || total > best.totalPoints) {
      best = { assignments, totalPoints: total, formation }
    }
  }

  if (!best) {
    const partial: SlotAssignment[] = []
    let log = 'No valid full formation — partial lineup'
    if (gks[0]) partial.push({ slot: 'GK', player: gks[0] })
    let i = 0
    while (partial.length < 11 && i < ranked.length) {
      const p = ranked[i++]!
      if (partial.some((x) => x.player.playerId === p.playerId)) continue
      if (p.position === 'GK' && partial.some((x) => x.slot === 'GK')) continue
      const slot =
        p.position === 'DEF' ? 'DEF' : p.position === 'MID' ? 'MID' : p.position === 'FWD' ? 'FWD' : 'MID'
      partial.push({ slot, player: p })
    }
    const totalPoints = partial.reduce((s, a) => s + a.player.points, 0)
    return { assignments: partial, totalPoints, formation: 'partial', log }
  }

  return { ...best, log: `formation=${best.formation}` }
}

export function templateSlotsToLineupSlots(raw: unknown): LineupSlotDef[] {
  if (!Array.isArray(raw)) return []
  return raw as LineupSlotDef[]
}
