import type { SeasonBlueprint } from './seasonBlueprint'
export type SeasonDraftPlayer = { playerId: string; playerName: string; position: string; team?: string | null; adp?: number | null; rank?: number | null; projectedPoints?: number | null; draftIdProvenance?: { namespace: 'sleeper' | 'rolling_insights' | 'unknown'; sourceRecordId: string | null } }
const base = { NFL: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], NBA: ['PG', 'SG', 'SF', 'PF', 'C'] }
export function seasonPlayerPositions(sport: 'NFL' | 'NBA', position: string) {
  const tokens = position.toUpperCase().replace(/D\/ST|DEFENSE|DEF/g, 'DST').split(/[\s,\/|;-]+/).filter(Boolean)
  return [...new Set(tokens)].filter(p => base[sport].includes(p))
}
function eligible(c: SeasonBlueprint, slot: string): string[] {
  if (c.sport === 'NFL') return slot === 'FLEX' ? ['RB', 'WR', 'TE'] : slot === 'SUPERFLEX' ? ['QB', 'RB', 'WR', 'TE'] : [slot]
  return slot === 'G' ? ['PG', 'SG'] : slot === 'F' ? ['SF', 'PF'] : slot === 'UTIL' ? base.NBA : [slot]
}
export function seasonDraftSlots(c: SeasonBlueprint) {
  if (!c.rules) throw new Error('Frozen playing rules are required.')
  const starters = c.rules.starters.flatMap(s => Array.from({ length: s.count }, () => eligible(c, s.position)))
  const bench = [...new Set(starters.flat())]
  return [...starters, ...Array.from({ length: c.rules.bench }, () => bench)]
}
/** Maximum bipartite matching handles overlapping NBA/FLEX eligibility without greedy slot errors. */
export function assignSeasonDraftSlots(c: SeasonBlueprint, players: Pick<SeasonDraftPlayer, 'position'>[], slots = seasonDraftSlots(c)) {
  const owners = Array<number>(slots.length).fill(-1)
  function place(index: number, visited: Set<number>): boolean {
    const positions = seasonPlayerPositions(c.sport, players[index]!.position)
    for (let slot = 0; slot < slots.length; slot++) {
      if (visited.has(slot) || !slots[slot]!.some(p => positions.includes(p))) continue
      visited.add(slot)
      if (owners[slot] === -1 || place(owners[slot]!, visited)) { owners[slot] = index; return true }
    }
    return false
  }
  for (let i = 0; i < players.length; i++) place(i, new Set())
  return owners
}
export function matchSeasonDraftSlots(c: SeasonBlueprint, players: Pick<SeasonDraftPlayer, 'position'>[], slots = seasonDraftSlots(c)) {
  return assignSeasonDraftSlots(c, players, slots).filter(index => index >= 0).length
}
export function seasonRosterPickError(c: SeasonBlueprint, existing: Pick<SeasonDraftPlayer, 'position'>[], candidate: Pick<SeasonDraftPlayer, 'position'>) {
  if (existing.length >= c.rosterSize) return 'The drafted roster is full. IR slots are not draft slots.'
  const players = [...existing, candidate]
  if (matchSeasonDraftSlots(c, players) !== players.length) return 'This pick would prevent a legal completed starter and bench roster.'
  return null
}
export function selectSeasonAutodraft(c: SeasonBlueprint, existing: SeasonDraftPlayer[], pool: SeasonDraftPlayer[], taken: Set<string>) {
  const rank = (value: number | null | undefined) => value != null && Number.isFinite(value) && value > 0 ? value : Infinity
  return [...pool].filter(p => p.playerId && !taken.has(p.playerId) && !seasonRosterPickError(c, existing, p)).sort((a, b) =>
    (c.sport === 'NBA' ? rank(a.rank) - rank(b.rank) || rank(a.adp) - rank(b.adp) : rank(a.adp) - rank(b.adp) || rank(a.rank) - rank(b.rank))
    || (b.projectedPoints ?? -Infinity) - (a.projectedPoints ?? -Infinity) || a.playerId.localeCompare(b.playerId))[0] ?? null
}
export function assessSeasonDraftPool(c: SeasonBlueprint, pool: SeasonDraftPlayer[], teams: number) {
  const ids = new Set<string>(), unique: SeasonDraftPlayer[] = [], blockers: string[] = []
  for (const p of pool) {
    if (!p.playerId || !p.playerName || !seasonPlayerPositions(c.sport, p.position).length) { blockers.push('The pool contains an unidentified or unsupported player.'); continue }
    if (ids.has(p.playerId)) { blockers.push('The pool contains duplicate player identities.'); continue }
    ids.add(p.playerId); unique.push(p)
  }
  const slots = Array.from({ length: teams }, () => seasonDraftSlots(c)).flat()
  const matched = matchSeasonDraftSlots(c, unique, slots)
  const ranked = unique.filter(p => [p.adp, p.rank].some(value => value != null && Number.isFinite(value) && value > 0) || (p.projectedPoints != null && Number.isFinite(p.projectedPoints)))
  const rankedMatched = matchSeasonDraftSlots(c, ranked, slots)
  if (rankedMatched < slots.length) blockers.push('Ranked player coverage cannot support best-available autodraft for every roster slot (' + rankedMatched + '/' + slots.length + ').')
  if (matched < slots.length) blockers.push('The verified pool cannot fill every team’s starter and bench slots (' + matched + '/' + slots.length + ').')
  return { ready: blockers.length === 0, players: unique.length, rankedPlayers: ranked.length, required: slots.length, matched, blockers: [...new Set(blockers)] }
}
export function seasonAuctionMaxBid(budget: number, remainingSlots: number, minimumBid: number) {
  if (!Number.isInteger(budget) || !Number.isInteger(remainingSlots) || remainingSlots <= 0 || minimumBid < 1) return 0
  return Math.max(0, budget - (remainingSlots - 1) * minimumBid)
}
/** A late bid extends to at least N seconds from now; an early bid never shortens the clock. */
export function seasonAuctionBidDeadline(currentEnd: number, now: number, extensionSeconds: number) {
  if (!Number.isFinite(currentEnd) || currentEnd <= now) throw new Error('Bidding window expired.')
  return Math.max(currentEnd, now + extensionSeconds * 1000)
}
