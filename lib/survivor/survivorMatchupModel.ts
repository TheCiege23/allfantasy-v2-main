/**
 * What the Matchup tab shows in a Survivor league (components/league/native/screens/NativeMatchupScreen.tsx).
 *
 * 🛑 SURVIVOR HAS NO HEAD-TO-HEAD OPPONENT, AND THE TAB SAID SO AS AN ERROR (owner report, 2026-11-24):
 * "Your team has no game in week 6", an "Empty" opponent column and no scores, because the tab only
 * knew the head-to-head schedule Survivor deliberately does not build. A castaway's week is decided by
 * where their TRIBE finishes (pre-merge: the lowest tribe goes to Elimination Council) or by their own
 * score against the island (post-merge: individual immunity). This lays that out from the Survivor
 * summary the Island tab already reads.
 *
 * Pure.
 */

export type SurvivorMatchupInput = {
  currentWeek: number
  merged: boolean
  myRosterId?: string | null
  myTribeId?: string | null
  tribes: ReadonlyArray<{ id: string; name: string; members: ReadonlyArray<{ rosterId: string }> }>
  tribeScores?: Record<string, number> | null
  memberScores?: Record<string, number> | null
  immunityRosterIds?: readonly string[] | null
  scoresFinalized?: boolean | null
  rosterDisplayNames?: Record<string, string> | null
  council?: { attendingTribeId: string | null; closedAt: string | null; isRevealed?: boolean } | null
}

export type SurvivorMatchupMember = { rosterId: string; name: string; score: number | null; mine: boolean; immune: boolean }
export type SurvivorMatchupTribe = {
  id: string
  name: string
  score: number | null
  rank: number
  mine: boolean
  attending: boolean
  members: SurvivorMatchupMember[]
}

export type SurvivorMatchupView = {
  week: number
  merged: boolean
  final: boolean
  myScore: number | null
  myImmune: boolean
  /** Pre-merge: tribes by score. Post-merge: one row, the merged island. */
  tribes: SurvivorMatchupTribe[]
  /** My place: among the tribes pre-merge, among every castaway post-merge. */
  myRank: { rank: number; of: number } | null
  /** One plain sentence on where the week stands for the viewer. */
  status: string
}

const score = (v: number | undefined | null): number | null => (v != null && Number.isFinite(v) ? v : null)

export function buildSurvivorMatchupView(s: SurvivorMatchupInput): SurvivorMatchupView {
  const names = s.rosterDisplayNames ?? {}
  const immune = new Set(s.immunityRosterIds ?? [])
  const memberScore = (id: string) => score(s.memberScores?.[id])
  const openCouncil = s.council && !s.council.closedAt && !s.council.isRevealed ? s.council : null
  const final = Boolean(s.scoresFinalized)

  const tribes: SurvivorMatchupTribe[] = s.tribes
    .filter((t) => t.members.length > 0)
    .map((t) => {
      const members = t.members
        .map((m) => ({ rosterId: m.rosterId, name: names[m.rosterId] ?? 'Castaway', score: memberScore(m.rosterId), mine: m.rosterId === s.myRosterId, immune: immune.has(m.rosterId) }))
        .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.name.localeCompare(b.name))
      // The summary sums only counted scores; a tribe nobody has scored for yet has no score, not 0.
      const total = score(s.tribeScores?.[t.id]) ?? (members.some((m) => m.score != null) ? members.reduce((n, m) => n + (m.score ?? 0), 0) : null)
      return { id: t.id, name: t.name, score: total, rank: 0, mine: t.id === s.myTribeId || members.some((m) => m.mine), attending: openCouncil?.attendingTribeId === t.id, members }
    })
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.name.localeCompare(b.name))
  tribes.forEach((t, i) => { t.rank = i + 1 })

  const me = tribes.flatMap((t) => t.members).find((m) => m.mine) ?? null
  const myScore = me?.score ?? null
  const myImmune = Boolean(me?.immune)
  const anyScore = tribes.some((t) => t.score != null)

  let myRank: SurvivorMatchupView['myRank'] = null
  let status: string
  if (!me) {
    status = 'You are not a castaway in this league. The tribe race is below.'
  } else if (s.merged) {
    const everyone = tribes.flatMap((t) => t.members).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    const at = everyone.findIndex((m) => m.mine)
    myRank = anyScore && at >= 0 ? { rank: at + 1, of: everyone.length } : null
    status = myImmune
      ? 'You hold individual immunity this week. You cannot be voted out.'
      : !anyScore
        ? 'Scores start once games are played. The top score wins individual immunity.'
        : myRank && myRank.rank === 1
          ? `You lead the island${final ? '' : ' so far'}: on track for individual immunity.`
          : `You are ${ordinal(myRank?.rank ?? everyone.length)} of ${everyone.length}${final ? '' : ' so far'}. Everyone without immunity can be voted out.`
  } else {
    const mine = tribes.find((t) => t.mine) ?? null
    myRank = mine && anyScore ? { rank: mine.rank, of: tribes.length } : null
    if (openCouncil && mine?.attending) status = `${mine.name} is going to Elimination Council. Vote before the deadline.`
    else if (openCouncil && mine) status = `${mine.name} is safe this week. Another tribe goes to Elimination Council.`
    else if (!anyScore || !mine) status = 'Scores start once games are played. The lowest-scoring tribe goes to Elimination Council.'
    else if (mine.rank === tribes.length && tribes.length > 1) status = `${mine.name} is last${final ? '' : ' so far'}: headed to Elimination Council unless it climbs.`
    else if (mine.rank === 1) status = `${mine.name} leads the tribe race${final ? '' : ' so far'}: on track for immunity.`
    else status = `${mine.name} is ${ordinal(mine.rank)} of ${tribes.length}${final ? '' : ' so far'}: safe if it holds above last.`
  }

  return { week: s.currentWeek, merged: s.merged, final, myScore, myImmune, tribes, myRank, status }
}

function ordinal(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`
}
