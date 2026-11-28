import type { PairTeam, PairTeamRecord } from './leaguePair'

/**
 * One standings table for a college + pro league: one row per FRANCHISE — a manager's pro team and
 * their college team together — so a paired league reads as one league whatever platforms its halves
 * run on.
 *
 * Pure. The caller supplies both halves' teams with their records and the team map
 * (lib/league/collegePro/leaguePair.ts `loadPairContext`).
 *
 * The franchise record is the two records added together: a win in either half is a win for the
 * franchise. Ranked by franchise wins, then fewer losses, then total points. A pro team with no
 * matched college team still has a row (its college columns empty), and the college teams no pro team
 * is matched to are counted rather than dropped, so the page can say so.
 */

export type FranchiseRecord = { wins: number; losses: number; ties: number; pointsFor: number | null }

export type FranchiseStandingRow = {
  rank: number
  proKey: string
  proName: string
  proRecord: PairTeamRecord | null
  collegeKey: string | null
  collegeName: string | null
  collegeRecord: PairTeamRecord | null
  total: FranchiseRecord
  isMine: boolean
}

export type FranchiseStandings = { rows: FranchiseStandingRow[]; unmatchedCollege: number }

const round2 = (n: number) => Math.round(n * 100) / 100

function addRecords(a: PairTeamRecord | null, b: PairTeamRecord | null): FranchiseRecord {
  const pf = [a?.pointsFor, b?.pointsFor].filter((v): v is number => typeof v === 'number')
  return {
    wins: (a?.wins ?? 0) + (b?.wins ?? 0),
    losses: (a?.losses ?? 0) + (b?.losses ?? 0),
    ties: (a?.ties ?? 0) + (b?.ties ?? 0),
    pointsFor: pf.length ? round2(pf.reduce((s, v) => s + v, 0)) : null,
  }
}

export function buildFranchiseStandings(args: {
  proTeams: readonly PairTeam[]
  collegeTeams: readonly PairTeam[]
  map: Readonly<Record<string, string>>
  proKey: string | null
}): FranchiseStandings {
  const college = new Map(args.collegeTeams.map((t) => [t.key, t]))
  const matched = new Set<string>()
  const rows = args.proTeams.map((p) => {
    const c = args.map[p.key] ? college.get(args.map[p.key]!) ?? null : null
    if (c) matched.add(c.key)
    return {
      rank: 0,
      proKey: p.key,
      proName: p.name || 'Team',
      proRecord: p.record,
      collegeKey: c?.key ?? null,
      collegeName: c?.name ?? null,
      collegeRecord: c?.record ?? null,
      total: addRecords(p.record, c?.record ?? null),
      isMine: p.key === args.proKey,
    }
  })
  rows.sort(
    (a, b) =>
      b.total.wins - a.total.wins ||
      a.total.losses - b.total.losses ||
      (b.total.pointsFor ?? 0) - (a.total.pointsFor ?? 0) ||
      a.proName.localeCompare(b.proName),
  )
  rows.forEach((r, i) => (r.rank = i + 1))
  return { rows, unmatchedCollege: args.collegeTeams.filter((t) => !matched.has(t.key)).length }
}
