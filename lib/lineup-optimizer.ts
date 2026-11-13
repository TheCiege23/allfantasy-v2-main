export interface LineupPlayer {
  name: string
  position: string
  impactValue: number
  vorpValue: number
}

export interface RosterSlots {
  startingQB: number
  startingRB: number
  startingWR: number
  startingTE: number
  startingFlex: number
  superflex: boolean
}

interface LineupResult {
  totalImpact: number
  totalVorp: number
  starters: LineupPlayer[]
}

const DEFAULT_ROSTER_SLOTS: RosterSlots = {
  startingQB: 1,
  startingRB: 2,
  startingWR: 2,
  startingTE: 1,
  startingFlex: 2,
  superflex: false,
}

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE'])
const SUPERFLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE'])

function optimizeLineup(
  players: LineupPlayer[],
  slots: RosterSlots = DEFAULT_ROSTER_SLOTS
): LineupResult {
  const byPos: Record<string, LineupPlayer[]> = {}
  for (const p of players) {
    const pos = p.position.toUpperCase()
    if (!byPos[pos]) byPos[pos] = []
    byPos[pos].push(p)
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.impactValue - a.impactValue)
  }

  const used = new Set<string>()
  const starters: LineupPlayer[] = []

  function fillSlots(pos: string, count: number) {
    const pool = byPos[pos] || []
    let filled = 0
    for (const p of pool) {
      if (filled >= count) break
      const key = `${p.name}__${p.position}`
      if (used.has(key)) continue
      used.add(key)
      starters.push(p)
      filled++
    }
  }

  fillSlots('QB', slots.startingQB)
  fillSlots('RB', slots.startingRB)
  fillSlots('WR', slots.startingWR)
  fillSlots('TE', slots.startingTE)

  const flexCount = slots.startingFlex - (slots.superflex ? 1 : 0)
  const flexCandidates: LineupPlayer[] = []
  for (const p of players) {
    const key = `${p.name}__${p.position}`
    if (used.has(key)) continue
    if (FLEX_ELIGIBLE.has(p.position.toUpperCase())) {
      flexCandidates.push(p)
    }
  }
  flexCandidates.sort((a, b) => b.impactValue - a.impactValue)
  for (let i = 0; i < Math.min(flexCount, flexCandidates.length); i++) {
    const key = `${flexCandidates[i].name}__${flexCandidates[i].position}`
    used.add(key)
    starters.push(flexCandidates[i])
  }

  if (slots.superflex) {
    const sfCandidates: LineupPlayer[] = []
    for (const p of players) {
      const key = `${p.name}__${p.position}`
      if (used.has(key)) continue
      if (SUPERFLEX_ELIGIBLE.has(p.position.toUpperCase())) {
        sfCandidates.push(p)
      }
    }
    sfCandidates.sort((a, b) => b.impactValue - a.impactValue)
    if (sfCandidates.length > 0) {
      const key = `${sfCandidates[0].name}__${sfCandidates[0].position}`
      used.add(key)
      starters.push(sfCandidates[0])
    }
  }

  const totalImpact = starters.reduce((s, p) => s + p.impactValue, 0)
  const totalVorp = starters.reduce((s, p) => s + p.vorpValue, 0)

  return { totalImpact, totalVorp, starters }
}

export interface LineupDelta {
  impactBefore: number
  impactAfter: number
  vorpBefore: number
  vorpAfter: number
  impactDelta: number
  vorpDelta: number
}

export function computeLineupDelta(
  currentRoster: LineupPlayer[],
  playersGiving: string[],
  playersReceiving: LineupPlayer[],
  slots: RosterSlots = DEFAULT_ROSTER_SLOTS
): LineupDelta {
  const before = optimizeLineup(currentRoster, slots)

  const givingSet = new Set(playersGiving.map(n => n.toLowerCase()))
  const afterRoster = currentRoster.filter(p => !givingSet.has(p.name.toLowerCase()))
  afterRoster.push(...playersReceiving)

  const after = optimizeLineup(afterRoster, slots)

  return {
    impactBefore: before.totalImpact,
    impactAfter: after.totalImpact,
    vorpBefore: before.totalVorp,
    vorpAfter: after.totalVorp,
    impactDelta: after.totalImpact - before.totalImpact,
    vorpDelta: after.totalVorp - before.totalVorp,
  }
}

export function computeLineupFairness(
  deltaYou: LineupDelta,
  deltaThem: LineupDelta,
  scale: number = 800,
  scale2: number = 400
): number {
  const impactDiff = deltaYou.impactDelta - deltaThem.impactDelta
  const vorpDiff = deltaYou.vorpDelta - deltaThem.vorpDelta

  const fairnessScore =
    50 +
    35 * Math.tanh(impactDiff / scale) +
    15 * Math.tanh(vorpDiff / scale2)

  return Math.round(Math.max(0, Math.min(100, fairnessScore)))
}

export function computeValueFairness(
  youGetComposite: number,
  youGiveComposite: number
): number {
  if (youGiveComposite <= 0 && youGetComposite <= 0) return 50
  const total = youGiveComposite + youGetComposite
  if (total <= 0) return 50
  const delta = youGetComposite - youGiveComposite
  const score = 50 + 50 * Math.tanh(delta / (total * 0.3))
  return Math.round(Math.max(0, Math.min(100, score)))
}
