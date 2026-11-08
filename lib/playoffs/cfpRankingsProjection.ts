export type CfpProjection = { season: number; rankingDate: string; teams: string[]; groupSix: string }

type Rank = { rank: number; school: string; conference: string }
const power = ["acc", "big ten", "big 12", "sec"]
const groupSix = new Set(["american", "american athletic", "conference usa", "mid-american", "mountain west", "pac-12", "sun belt"])
const dates: Record<number, string> = { 10: "2026-11-03", 11: "2026-11-10", 12: "2026-11-17", 13: "2026-11-24", 14: "2026-12-01" }

/** Project conference qualifiers from the published rankings, never official selections. */
export function projectCfpRankings(payload: unknown): CfpProjection | null {
  if (!Array.isArray(payload)) return null
  const eligible = payload.filter((row) => row?.season === 2026 && row?.seasonType === "regular" && dates[row.week] && Array.isArray(row.polls))
    .sort((a, b) => b.week - a.week)
  for (const row of eligible) {
    const poll = row.polls.find((item: { poll?: string }) => item.poll === "Playoff Committee Rankings")
    if (!Array.isArray(poll?.ranks) || poll.ranks.length !== 25) continue
    const ranks: Rank[] = poll.ranks.map((item: { rank?: unknown; school?: unknown; conference?: unknown }) => ({
      rank: Number(item.rank), school: typeof item.school === "string" ? item.school.trim() : "", conference: typeof item.conference === "string" ? item.conference.trim().toLowerCase() : "",
    })).sort((a: Rank, b: Rank) => a.rank - b.rank)
    if (ranks.some((item, i) => item.rank !== i + 1 || !item.school || !item.conference) || new Set(ranks.map(item => item.school.toLowerCase())).size !== 25) continue
    const champions = power.map(conf => ranks.find(item => item.conference === conf))
    const g6 = ranks.find(item => groupSix.has(item.conference))
    if (champions.some(team => !team) || !g6) continue
    const qualifiers = new Set([...champions.map(team => team!.school), g6.school])
    // CFP guarantees Notre Dame a place if the committee ranks it in the top 12.
    const notreDame = ranks.find(team => team.school.toLowerCase() === "notre dame" && team.rank <= 12)
    if (notreDame) qualifiers.add(notreDame.school)
    for (const team of ranks) { if (qualifiers.size >= 12) break; qualifiers.add(team.school) }
    const teams = ranks.filter(team => qualifiers.has(team.school)).map(team => team.school)
    if (teams.length === 12) return { season: 2026, rankingDate: dates[row.week], teams, groupSix: g6.school }
  }
  return null
}
