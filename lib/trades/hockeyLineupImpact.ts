type HockeyLineupPlayer = { playerId: string; position: string; pointsPerGame: number }

const PLAYER_POSITIONS = new Set(['C', 'LW', 'RW', 'D', 'G', 'F'])
const STARTER_SLOTS = new Set(['C', 'LW', 'RW', 'D', 'G', 'F', 'FLEX_CW', 'W', 'SKT', 'UTIL'])
const FORWARDS = new Set(['C', 'LW', 'RW', 'F'])
const SKATERS = new Set(['C', 'LW', 'RW', 'D', 'F'])
const tokens = (position: string) => position.toUpperCase().split(/[,/;\s]+/).filter(Boolean)
const round = (value: number) => Math.round(value * 100) / 100

export function validHockeyPosition(position: string | null): boolean {
  const parts = tokens(position ?? '')
  return parts.length > 0 && parts.every((part) => PLAYER_POSITIONS.has(part)) &&
    !(parts.includes('G') && parts.some((part) => part !== 'G'))
}

export function hockeySlotEligible(position: string, slot: string): boolean {
  if (!validHockeyPosition(position)) return false
  const parts = tokens(position)
  const label = slot.toUpperCase()
  if (label === 'G') return parts.includes('G')
  if (parts.includes('G')) return false
  if (label === 'F' || label === 'FLEX_CW') return parts.some((part) => FORWARDS.has(part))
  if (label === 'W') return parts.some((part) => part === 'LW' || part === 'RW')
  if (label === 'SKT' || label === 'UTIL') return parts.some((part) => SKATERS.has(part))
  return parts.includes(label)
}

/** Exact maximum-weight assignment. Unsupported slots return null; unfilled slots are counted. */
export function bestHockeyLineupAssignment(
  players: HockeyLineupPlayer[], starterSlots: Record<string, number>,
): { points: number; filledSlots: number; slotCount: number } | null {
  const slots: string[] = []
  for (const [name, count] of Object.entries(starterSlots)) {
    const slot = name.toUpperCase()
    if (!STARTER_SLOTS.has(slot) || !Number.isInteger(count) || count < 0 || count > 25) return null
    for (let index = 0; index < count; index++) slots.push(slot)
  }
  if (!slots.length || slots.length > 25 || players.some((player) =>
    !validHockeyPosition(player.position) || !Number.isFinite(player.pointsPerGame))) return null
  // Rectangular Hungarian assignment with one dummy per slot. A filled real slot must be
  // eligible; the dummies merely make an impossible lineup detectable without guessing.
  const n = slots.length
  const m = players.length + n
  const u = Array(n + 1).fill(0) as number[]
  const v = Array(m + 1).fill(0) as number[]
  const p = Array(m + 1).fill(0) as number[]
  const way = Array(m + 1).fill(0) as number[]
  const cost = (row: number, column: number) => column > players.length ? 1_000_000
    : hockeySlotEligible(players[column - 1]!.position, slots[row - 1]!)
      ? -players[column - 1]!.pointsPerGame : 2_000_000
  for (let row = 1; row <= n; row++) {
    p[0] = row
    let column = 0
    const minv = Array(m + 1).fill(Infinity) as number[]
    const used = Array(m + 1).fill(false) as boolean[]
    do {
      used[column] = true
      const current = p[column]!
      let delta = Infinity
      let next = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const reduced = cost(current, j) - u[current]! - v[j]!
        if (reduced < minv[j]) { minv[j] = reduced; way[j] = column }
        if (minv[j]! < delta) { delta = minv[j]!; next = j }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]!] += delta; v[j] += delta }
        else minv[j] -= delta
      }
      column = next
    } while (p[column] !== 0)
    do {
      const previous = way[column]!
      p[column] = p[previous]!
      column = previous
    } while (column !== 0)
  }
  let total = 0
  let filledSlots = 0
  for (let column = 1; column <= m; column++) if (p[column] && column <= players.length &&
    hockeySlotEligible(players[column - 1]!.position, slots[p[column]! - 1]!)) {
    total += players[column - 1]!.pointsPerGame
    filledSlots++
  }
  return { points: round(total), filledSlots, slotCount: n }
}
