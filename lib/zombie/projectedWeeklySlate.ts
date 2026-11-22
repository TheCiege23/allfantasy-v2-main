import type { ItemWeekMatchup } from './beta2025Items'

type ProjectedPlayer = {
  id: string
  positions: readonly string[]
} & ({ available: false } | { available: true; points: number | null })

/** Each entry describes one starting seat, including duplicate slots. */
type Seats = readonly (readonly string[])[]

/** Optimize legal assignments using one bit per seat. Null means the evidence cannot fill a lineup. */
export function projectedZombieLineupPoints(players: readonly ProjectedPlayer[], seats: Seats): number | null {
  if (seats.length === 0 || seats.length > 12 || new Set(players.map(player => player.id)).size !== players.length) return null
  const full = (1 << seats.length) - 1
  let totals = Array<number>(full + 1).fill(-Infinity)
  totals[0] = 0
  for (const player of players) {
    if (!player.available) continue
    const eligible = seats.flatMap((positions, i) => positions.some(position => player.positions.includes(position)) ? [1 << i] : [])
    if (!eligible.length) continue
    const points = player.points
    if (points === null || !Number.isFinite(points)) return null
    const next = [...totals]
    for (let assigned = 0; assigned <= full; assigned++) {
      if (!Number.isFinite(totals[assigned])) continue
      for (const seat of eligible) {
        if (assigned & seat) continue
        const filled = assigned | seat
        next[filled] = Math.max(next[filled], totals[assigned] + points)
      }
    }
    totals = next
  }
  return Number.isFinite(totals[full]) ? totals[full] : null
}

export function buildProjectedZombieSlate(input: {
  schedule: readonly Pick<ItemWeekMatchup, 'matchupId' | 'homeRosterId' | 'awayRosterId'>[]
  rosters: ReadonlyMap<string, readonly ProjectedPlayer[]>
  seats: Seats
}): ItemWeekMatchup[] | null {
  const { schedule, rosters, seats } = input
  const slate: ItemWeekMatchup[] = []
  const seen = new Set<string>()
  const matchupIds = new Set<string>()
  for (const match of schedule) {
    const { matchupId, homeRosterId, awayRosterId } = match
    if (homeRosterId === awayRosterId || seen.has(homeRosterId) || seen.has(awayRosterId) || matchupIds.has(matchupId)) return null
    const home = projectedZombieLineupPoints(rosters.get(homeRosterId) ?? [], seats)
    const away = projectedZombieLineupPoints(rosters.get(awayRosterId) ?? [], seats)
    if (home === null || away === null) return null
    seen.add(homeRosterId)
    seen.add(awayRosterId)
    matchupIds.add(matchupId)
    slate.push({ ...match, homeBaseScore: home, awayBaseScore: away, homeScore: home, awayScore: away,
      homeWeaponBonus: 0, awayWeaponBonus: 0 })
  }
  return slate.length && seen.size === rosters.size ? slate : null
}
