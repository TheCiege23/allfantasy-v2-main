/**
 * The draft grading maths, once, for every platform.
 *
 * ⚠ WHY THIS IS SHARED RATHER THAN COPIED. A grade is only meaningful if an A means
 * the same thing in a Sleeper league and an imported ESPN one. Two graders that
 * started identical and drifted would produce letters that cannot be compared, and
 * nothing would fail loudly when they did — the numbers would simply stop agreeing.
 * The Sleeper path and the imported path both call `gradePicks`, and there is no
 * second implementation to fall out of step with.
 *
 * The scale: each pick's points minus the MEDIAN produced by that round's picks, so a
 * pick is judged against what its own round actually returned rather than against an
 * absolute. Median rather than mean, because one league-winning pick per round would
 * otherwise drag the bar up and mark every other pick in that round a failure.
 */

export type DraftGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F'

export type DraftPickGrade = {
  pickNo: number
  round: number
  playerId: string | null
  playerName: string
  position: string | null
  byOwnerId: string | null
  byName: string
  /** Draft-year points and value-over-round-median (the initial read). */
  initialPoints: number | null
  initialValueOver: number | null
  /** Cumulative since the draft (equals initial in redraft leagues). */
  currentPoints: number | null
  currentValueOver: number | null
}

export type DraftManagerCard = {
  ownerId: string
  name: string
  avatar: string | null
  teamName: string | null
  picks: number
  initialScore: number
  currentScore: number
  initialGrade: DraftGradeLetter
  currentGrade: DraftGradeLetter
  trend: 'improved' | 'declined' | 'steady'
}

/** One pick, normalized away from any provider's wire shape. */
export type GradablePick = {
  pickNo: number
  round: number
  playerId: string | null
  playerName: string
  position: string | null
  byOwnerId: string | null
  byName: string
  teamName: string | null
  avatar: string | null
  initialPoints: number | null
  currentPoints: number | null
}

export function letterFor(avgPerPick: number): DraftGradeLetter {
  if (avgPerPick >= 25) return 'A'
  if (avgPerPick >= 10) return 'B'
  if (avgPerPick > -10) return 'C'
  if (avgPerPick > -25) return 'D'
  return 'F'
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export type GradedDraft = {
  rounds: number
  gradedPicks: DraftPickGrade[]
  managers: DraftManagerCard[]
  steals: DraftPickGrade[]
  busts: DraftPickGrade[]
}

/**
 * Grade one draft: value over round median, per pick and per manager.
 *
 * Picks with no points contribute nothing to a median and are not counted against the
 * manager who made them. A pick we cannot score is missing DATA, not a bad pick, and
 * averaging it in as a zero would quietly punish managers for gaps in our own
 * coverage rather than for their drafting.
 */
export function gradePicks(picks: GradablePick[]): GradedDraft {
  if (picks.length === 0) {
    return { rounds: 0, gradedPicks: [], managers: [], steals: [], busts: [] }
  }

  const rounds = Math.max(...picks.map((p) => p.round))

  const initialMedianByRound = new Map<number, number>()
  const currentMedianByRound = new Map<number, number>()
  for (let r = 1; r <= rounds; r += 1) {
    const inRound = picks.filter((p) => p.round === r)
    const mi = median(inRound.map((p) => p.initialPoints).filter((v): v is number => v != null))
    const mc = median(inRound.map((p) => p.currentPoints).filter((v): v is number => v != null))
    if (mi != null) initialMedianByRound.set(r, mi)
    if (mc != null) currentMedianByRound.set(r, mc)
  }

  const gradedPicks: DraftPickGrade[] = picks.map((p) => {
    const mi = initialMedianByRound.get(p.round)
    const mc = currentMedianByRound.get(p.round)
    return {
      pickNo: p.pickNo,
      round: p.round,
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      byOwnerId: p.byOwnerId,
      byName: p.byName,
      initialPoints: p.initialPoints,
      initialValueOver:
        p.initialPoints != null && mi != null ? Math.round((p.initialPoints - mi) * 10) / 10 : null,
      currentPoints: p.currentPoints,
      currentValueOver:
        p.currentPoints != null && mc != null ? Math.round((p.currentPoints - mc) * 10) / 10 : null,
    }
  })

  /* Owner identity travels with the pick, so a manager's display details come from
     their own picks rather than a second lookup that could disagree. */
  const ownerDetail = new Map<string, { name: string; teamName: string | null; avatar: string | null }>()
  for (const p of picks) {
    if (!p.byOwnerId || ownerDetail.has(p.byOwnerId)) continue
    ownerDetail.set(p.byOwnerId, { name: p.byName, teamName: p.teamName, avatar: p.avatar })
  }

  const byOwner = new Map<string, DraftPickGrade[]>()
  for (const g of gradedPicks) {
    if (!g.byOwnerId) continue
    const list = byOwner.get(g.byOwnerId) ?? []
    list.push(g)
    byOwner.set(g.byOwnerId, list)
  }

  const managers: DraftManagerCard[] = [...byOwner.entries()]
    .map(([ownerId, list]) => {
      const gradable = list.filter((g) => g.initialValueOver != null)
      const initialScore =
        Math.round(gradable.reduce((a, g) => a + (g.initialValueOver ?? 0), 0) * 10) / 10
      const currentScore =
        Math.round(list.reduce((a, g) => a + (g.currentValueOver ?? 0), 0) * 10) / 10
      const perPickInitial = gradable.length > 0 ? initialScore / gradable.length : 0
      const perPickCurrent = gradable.length > 0 ? currentScore / gradable.length : 0
      const detail = ownerDetail.get(ownerId)
      return {
        ownerId,
        name: detail?.name ?? 'Manager',
        avatar: detail?.avatar ?? null,
        teamName: detail?.teamName ?? null,
        picks: list.length,
        initialScore,
        currentScore,
        initialGrade: letterFor(perPickInitial),
        currentGrade: letterFor(perPickCurrent),
        trend:
          perPickCurrent > perPickInitial + 3
            ? ('improved' as const)
            : perPickCurrent < perPickInitial - 3
              ? ('declined' as const)
              : ('steady' as const),
      }
    })
    .sort((a, b) => b.currentScore - a.currentScore)

  const withCurrent = gradedPicks.filter((g) => g.currentValueOver != null)
  const steals = [...withCurrent]
    .sort((a, b) => (b.currentValueOver ?? 0) - (a.currentValueOver ?? 0))
    .slice(0, 3)
    .filter((g) => (g.currentValueOver ?? 0) > 0)
  const busts = [...withCurrent]
    .sort((a, b) => (a.currentValueOver ?? 0) - (b.currentValueOver ?? 0))
    .slice(0, 3)
    .filter((g) => (g.currentValueOver ?? 0) < 0)

  return { rounds, gradedPicks, managers, steals, busts }
}
