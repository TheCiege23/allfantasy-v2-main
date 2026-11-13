import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export type CombatRole = 'Survivor' | 'Zombie' | 'Whisperer'
type CombatKind = 'survivor_bash' | 'whisperer_bash' | 'whisperer_maul'
export const INITIAL_WHISPERER_OFFER_HOURS = 24
export const BETA_AMBUSH_LIMIT = 2

/** Wednesday after the scoring slate opened, at 21:00 Eastern, including DST. */
export function betaCombatDeadline(firstKickoff: Date): Date {
  const date = formatInTimeZone(firstKickoff, 'America/New_York', 'yyyy-MM-dd')
  const calendar = new Date(`${date}T12:00:00Z`)
  const days = (3 - calendar.getUTCDay() + 7) % 7 || 7
  calendar.setUTCDate(calendar.getUTCDate() + days)
  return fromZonedTime(`${calendar.toISOString().slice(0, 10)}T21:00:00`, 'America/New_York')
}

export function betaCombatKind(winner: CombatRole, loser: CombatRole, margin: number): CombatKind | null {
  if (!Number.isFinite(margin) || Math.round(margin * 100) < 6000) return null
  if (winner === 'Survivor' && loser === 'Survivor') return 'survivor_bash'
  if (winner === 'Survivor' && loser === 'Whisperer') return 'whisperer_bash'
  if (winner === 'Zombie' && loser === 'Whisperer') return 'whisperer_maul'
  return null
}

export type AmbushPair = { homeRosterId: string; awayRosterId: string }
type AmbushMatchup = AmbushPair & { id: string }

/** A remap is a complete permutation of the current field; unchanged locked pairs stay intact. */
export function planBetaAmbush(current: AmbushMatchup[], proposed: AmbushPair[], locked: Set<string>) {
  if (current.length !== proposed.length || !current.length) throw new Error('Submit every matchup in the current week.')
  const oldIds = current.flatMap(m => [m.homeRosterId, m.awayRosterId])
  const newIds = proposed.flatMap(m => [m.homeRosterId, m.awayRosterId])
  if (newIds.some(id => typeof id !== 'string' || !id) || new Set(oldIds).size !== oldIds.length ||
      new Set(newIds).size !== newIds.length || [...oldIds].sort().join('|') !== [...newIds].sort().join('|')) {
    throw new Error('Every current team must appear exactly once; byes and duplicate teams cannot be remapped.')
  }
  const remaining = [...proposed]
  const result: Array<AmbushMatchup & { changed: boolean }> = []
  // Preserve each unchanged pair's exact row and home/away orientation, including score receipts.
  for (const old of current) {
    const index = remaining.findIndex(p => p.homeRosterId === old.homeRosterId && p.awayRosterId === old.awayRosterId || p.homeRosterId === old.awayRosterId && p.awayRosterId === old.homeRosterId)
    if (index >= 0) { remaining.splice(index, 1); result.push({ ...old, changed: false }) }
    else if (locked.has(old.homeRosterId) || locked.has(old.awayRosterId)) throw new Error('A team in a changed matchup has already locked.')
  }
  const unused = current.filter(old => !result.some(row => row.id === old.id))
  unused.forEach((old, index) => result.push({ id: old.id, ...remaining[index], changed: true }))
  if (!result.some(row => row.changed)) throw new Error('Choose at least one matchup change before using an ambush.')
  return result
}
