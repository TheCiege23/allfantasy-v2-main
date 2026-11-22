/**
 * Rivalry week: pair every team with its biggest rival for one week (2026-11-15).
 *
 * The pairs come from the league's rivalry engine (`RivalryRecord`, scored from head-to-head history, close games,
 * playoff meetings and trades — lib/rivalry-engine), never from a new score. Pairing is greedy on that score: the
 * league's strongest rivalry plays first, then the strongest among the teams left, and so on. Teams with no rivalry
 * left to pair (new teams, or the leftovers of the greedy pass) play each other in their original order, and an odd
 * league's last team gets the bye.
 *
 * Pure (no I/O).
 */
export type RivalryPairScore = { a: string; b: string; score: number }
export type RivalryWeekPairing = { home: string; away: string | null; rivalry: boolean; score: number | null }

export function pairRivalryWeek(teams: readonly string[], rivalries: readonly RivalryPairScore[]): RivalryWeekPairing[] {
  const inLeague = new Set(teams)
  const taken = new Set<string>()
  const out: RivalryWeekPairing[] = []
  const ranked = [...rivalries]
    .filter((r) => r.a !== r.b && inLeague.has(r.a) && inLeague.has(r.b) && Number.isFinite(r.score) && r.score > 0)
    .sort((x, y) => y.score - x.score || `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`))
  for (const r of ranked) {
    if (taken.has(r.a) || taken.has(r.b)) continue
    taken.add(r.a)
    taken.add(r.b)
    out.push({ home: r.a, away: r.b, rivalry: true, score: r.score })
  }
  const rest = teams.filter((t) => !taken.has(t))
  for (let i = 0; i < rest.length; i += 2) {
    out.push({ home: rest[i]!, away: rest[i + 1] ?? null, rivalry: false, score: null })
  }
  return out
}
