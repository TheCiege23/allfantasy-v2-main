import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'
import { optimizeLineup } from '@/lib/decision-os/lineup/bestLineup'
import type { LineupOptimization, OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'

/**
 * THE LINEUP ALERTS ANSWER FROM MY TEAM'S BEST LINEUP (2026-11-21 code re-score: "the scheduled lineup check uses a
 * second optimizer").
 *
 * The Sunday lineup check and the slate-lock check priced the roster with the weekly-feed optimizer
 * (`lineupOptimizerGrounding.ts` — `priceLeagueWeek` + the Trade Center's greedy `fillLineup`), while the My Team screen
 * and Chimmy's lineup answer use `optimizeLineup` on AllFantasy's league projection (`decision-os/lineup/bestLineup.ts`).
 * Two engines, two numbers: an alert could say "start X over Y" that My Team, opened from the alert, did not show.
 *
 * This turns My Team's own load into the shape the alerts read (`findLineupIssues`), so the alert, the screen and Chimmy
 * are one answer. PURE: My Team's data and a clock in, an optimization out.
 *
 *   - Swaps: My Team's changes, and only on a `swap` verdict — a `close` call inside projection noise is not pushed.
 *   - A starter My Team cannot price is a starter with no projection; with one, My Team gives no total and no swap.
 *   - Byes and ruled-out players are priced at 0, as My Team prices them, and a ruled-out player carries "Out".
 */

const toPlayer = (p: LineupPlayer): OptimizerPlayer => ({
  playerId: p.sleeperId,
  name: p.name,
  position: p.position,
  team: p.team,
  injury: p.ruledOut ? (p.injuryStatus && /out/i.test(p.injuryStatus) ? p.injuryStatus : 'Out') : p.injuryStatus,
  points: p.onBye || p.ruledOut ? 0 : p.afProjectedPoints,
})

export function lineupOptimizationFromMyTeam(data: MyTeamData, now: Date): LineupOptimization {
  if (data.bestBall || data.league.bestBall) {
    return { status: 'unresolved', reason: 'unknown_slots', detail: 'A best-ball lineup is set automatically each week.' }
  }
  if (!data.starters.available) return { status: 'unresolved', reason: 'no_viewer_roster', detail: data.starters.reason }
  if (!data.projections || !data.projections.available) {
    return { status: 'unresolved', reason: 'no_league_projections', detail: data.projections ? data.projections.reason : 'No projections this week.' }
  }
  const slots: LineupSlot[] = data.starters.data
  const benchPlayers: LineupPlayer[] = data.bench.available ? data.bench.data : []
  // A filled seat My Team could not resolve is an identity gap, not a hole — no honest alert exists (as My Team says).
  if (slots.some((s) => !s.empty && !s.player)) {
    return { status: 'unresolved', reason: 'unknown_slots', detail: 'A starter could not be identified.' }
  }
  const starters = slots.flatMap((s) => (s.player ? [s.player] : []))
  const emptySlots = slots.filter((s) => s.empty).length
  const current = starters.map(toPlayer)
  const unpricedStarters = current.filter((p) => p.points == null)
  const injuredStarters = current.filter((p) => Boolean(p.injury))

  const opt = optimizeLineup({ starters: slots, bench: benchPlayers, sport: data.league.sport ?? null, bestBall: false, now })
  const byName = new Map([...starters, ...benchPlayers].map((p) => [p.name, p]))
  const swaps = opt && opt.state === 'improve' && opt.verdict === 'swap' ? opt.changes : []
  const startInstead = swaps.flatMap((c) => (byName.get(c.inName) ? [toPlayer(byName.get(c.inName)!)] : []))
  const benchInstead = swaps.flatMap((c) => (c.outName && byName.get(c.outName) ? [toPlayer(byName.get(c.outName)!)] : []))
  const currentPoints = opt ? opt.currentTotal : null
  const gain = !opt ? null : opt.state === 'improve' && opt.verdict === 'swap' ? opt.gain : 0
  const bestPoints = opt ? (opt.state === 'improve' ? opt.bestTotal : opt.currentTotal) : 0
  const moved = new Set(benchInstead.map((p) => p.playerId))
  // Kicked off by `now`: `optimizeLineup` holds such a starter in its seat and leaves such a bench player out.
  const lockedPlayers = [...starters, ...benchPlayers]
    .filter((p) => p.kickoff instanceof Date && p.kickoff.getTime() <= now.getTime())
    .map(toPlayer)

  return {
    status: 'ready',
    projectionSource: 'allfantasy',
    week: { season: String(data.projections.data.season), week: data.projections.data.week },
    best: {
      points: bestPoints,
      slots: slots.flatMap((s, i) => {
        const change = swaps.find((c) => c.slotIndex === i)
        const who = change ? byName.get(change.inName) : s.player
        return who ? [{ slot: s.slotLabel, player: toPlayer(who) }] : []
      }),
    },
    current: { starters: current, points: currentPoints, emptySlots, known: true },
    startInstead,
    benchInstead,
    gain,
    unpricedStarters,
    injuredStarters,
    bench: benchPlayers
      .filter((p) => !startInstead.some((s) => s.playerId === p.sleeperId))
      .map(toPlayer)
      .concat(current.filter((p) => moved.has(p.playerId)))
      .sort((a, b) => (b.points ?? -1) - (a.points ?? -1)),
    unpricedActive: benchPlayers.filter((p) => toPlayer(p).points == null).length,
    unfilledSlots: slots.filter((s) => s.empty).map((s) => s.slotLabel),
    ...(lockedPlayers.length ? { lockedPlayers } : {}),
  }
}

/**
 * The alerts' default optimizer: My Team's load for this league and user, read the same way the screen reads it. Also
 * what Chimmy's lineup decision lane (`decisionAnswerService.ts`) and the portfolio report (`portfolio/data.ts`) read
 * (2026-11-23), so neither can name a different lineup from My Team.
 */
export async function myTeamLineupOptimization(leagueId: string, userId: string, now: Date = new Date()): Promise<LineupOptimization> {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(leagueId, userId)
  if (!data) return { status: 'unresolved', reason: 'no_viewer_roster', detail: 'My Team could not load this lineup.' }
  return lineupOptimizationFromMyTeam(data, now)
}
