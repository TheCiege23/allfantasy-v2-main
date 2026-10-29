/**
 * Guilly hub model over the existing guillotine summary
 * (`GET /api/leagues/[leagueId]/guillotine/summary`). Presentation only: the danger tier, the order
 * and every chop come from the engine (GuillotineDangerEngine / GuillotineWeeklySummaryService).
 */

export const GUILLY_ART = '/specialty/guilly'

export type GuillySummaryPayload = {
  weekOrPeriod: number
  choppedThisWeek: { rosterId: string; displayName?: string }[]
  survivalStandings: { rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }[]
  dangerTiers?: { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number }[]
  recentChopEvents: { weekOrPeriod: number; choppedRosterIds: string[] }[]
  myRosterId?: string | null
  config?: { eliminationStartWeek: number; eliminationEndWeek: number | null; teamsPerChop: number; tiebreakerOrder: string[]; rosterReleaseTiming: string } | null
}

export type GuillyHead = 'calm' | 'nervous' | 'ko' | 'crown'
export type GuillyBladeRow = { rosterId: string; name: string; tier: 'chop_zone' | 'danger' | 'safe'; overBlade: number; seasonPoints: number | null; head: GuillyHead; you: boolean }

export function headSrc(head: GuillyHead): string {
  return `${GUILLY_ART}/head-${head}.svg`
}

const STATUS: Record<GuillyBladeRow['tier'], string> = { safe: 'Safe for now', danger: 'Sweating', chop_zone: 'Chopping block' }
export function bladeStatus(tier: GuillyBladeRow['tier']): string {
  return STATUS[tier]
}

export function buildGuillyHub(p: GuillySummaryPayload) {
  const names = new Map<string, string>()
  for (const r of p.survivalStandings) if (r.displayName) names.set(r.rosterId, r.displayName)
  for (const r of p.dangerTiers ?? []) if (r.displayName) names.set(r.rosterId, r.displayName)
  for (const r of p.choppedThisWeek) if (r.displayName) names.set(r.rosterId, r.displayName)
  const season = new Map(p.survivalStandings.map((r) => [r.rosterId, r.seasonPointsCumul]))
  const tiers = (p.dangerTiers ?? []).map((r) => {
    const tier = (r.tier === 'chop_zone' || r.tier === 'danger' ? r.tier : 'safe') as GuillyBladeRow['tier']
    return {
      rosterId: r.rosterId,
      name: names.get(r.rosterId) ?? 'Team',
      tier,
      overBlade: Math.round(r.pointsFromChopZone * 10) / 10,
      seasonPoints: season.get(r.rosterId) ?? null,
      head: (tier === 'chop_zone' ? 'ko' : tier === 'danger' ? 'nervous' : 'calm') as GuillyHead,
      you: Boolean(p.myRosterId) && r.rosterId === p.myRosterId,
    }
  })
  // Best first, so the blade line sits at the bottom like the board.
  const blade: GuillyBladeRow[] = [...tiers].sort((a, b) => b.overBlade - a.overBlade)
  const alive = p.survivalStandings.length
  const me = blade.find((r) => r.you) ?? null
  const chopped = new Set(p.recentChopEvents.flatMap((e) => e.choppedRosterIds))
  const graveyard = [...p.recentChopEvents]
    .sort((a, b) => b.weekOrPeriod - a.weekOrPeriod)
    .flatMap((e) => e.choppedRosterIds.map((id) => ({ rosterId: id, week: e.weekOrPeriod, name: names.get(id) ?? 'A chopped team' })))
  const champion = alive === 1 && p.survivalStandings[0] ? { rosterId: p.survivalStandings[0].rosterId, name: names.get(p.survivalStandings[0].rosterId) ?? 'Champion' } : null
  const iWasChopped = Boolean(p.myRosterId && chopped.has(p.myRosterId))
  return { week: p.weekOrPeriod, blade, alive, me, graveyard, champion, iWasChopped, choppedThisWeek: p.choppedThisWeek.map((c) => names.get(c.rosterId) ?? 'A team') }
}

/** Plain-language tiebreak line from the league's actual configured order. */
export function describeTiebreak(order: string[] | undefined | null): string {
  const label: Record<string, string> = {
    bench_points: 'bench points', season_points: 'season points', previous_period: 'last week',
    draft_slot: 'draft slot', commissioner: 'the commissioner', random: 'a random draw',
  }
  const steps = (order ?? []).map((s) => label[s]).filter(Boolean)
  return steps.length ? `Ties at the blade line go to ${steps.join(', then ')}.` : 'Ties at the blade line follow the league tiebreak.'
}
