/**
 * A Zombie week's matchups as the Bashing card draws them: who, what's at stake, how the margin sits
 * against the sport's bash/maul lines, and — once the week is final — exactly what changed hands.
 *
 * The transfer is the winnings engine's own (`computeWeeklyWinnings`), never re-derived, so the card
 * cannot show a number the settlement did not pay. Pure apart from that import.
 */
import { computeWeeklyWinnings, type InfectionPair } from '@/lib/zombie/weeklyWinningsEngine'
import type { NativeWeekResult } from '@/lib/zombie/ZombieInfectionEngine'

export type ZombieOutcomeKind = 'infection' | 'mauling' | 'bashing'

export type ZombieMatchupSide = { rosterId: string; name: string; status: string; score: number }

export type ZombieMatchupView = {
  id: string
  home: ZombieMatchupSide
  away: ZombieMatchupSide
  final: boolean
  /** Absolute points between the two sides. */
  margin: number
  leader: 'home' | 'away' | null
  /**
   * The Survivor side that turns if it loses — from the statuses the viewer may see, so a hidden
   * Whisperer reads as a Survivor here like everywhere else. Null once the week is final.
   */
  atRisk: 'home' | 'away' | null
  /** Final: what happened. Not final: what the current margin is on pace for (never an infection). */
  outcome: { kind: ZombieOutcomeKind; final: boolean } | null
  /** Final only: the points the engine moved. */
  transfer: { fromRosterId: string; toRosterId: string; amount: number } | null
  mySide: 'home' | 'away' | null
}

const human = (status: string) => !/zombie|whisperer/i.test(status)
const infects = (status: string, lossToZombieInfects: boolean) =>
  /whisperer/i.test(status) || (lossToZombieInfects && /zombie/i.test(status))

export function buildZombieMatchups(input: {
  results: readonly NativeWeekResult[] | null
  /** Redacted, current statuses. */
  statusOf: (rosterId: string) => string
  nameOf: (rosterId: string) => string
  /** The week's infections (victim → infector), from the teams' own records. */
  infected: readonly InfectionPair[]
  rules: { bashingThreshold: number; maulingThreshold: number }
  lossToZombieInfects: boolean
  myRosterId?: string | null
}): ZombieMatchupView[] {
  const results = (input.results ?? []).filter((r) => r.homeRosterId && r.awayRosterId)
  const { transfers } = computeWeeklyWinnings([...results], [...input.infected], input.rules)
  const transferOf = new Map(transfers.map((t) => [t.matchupId, t]))

  return results.map((r) => {
    const homeId = r.homeRosterId!
    const awayId = r.awayRosterId!
    const home: ZombieMatchupSide = { rosterId: homeId, name: input.nameOf(homeId), status: input.statusOf(homeId), score: r.homeScore }
    const away: ZombieMatchupSide = { rosterId: awayId, name: input.nameOf(awayId), status: input.statusOf(awayId), score: r.awayScore }
    const margin = Math.round(Math.abs(r.homeScore - r.awayScore) * 10) / 10
    const leader = r.homeScore === r.awayScore ? null : r.homeScore > r.awayScore ? 'home' : 'away'

    let atRisk: ZombieMatchupView['atRisk'] = null
    if (!r.final) {
      if (human(home.status) && infects(away.status, input.lossToZombieInfects)) atRisk = 'home'
      else if (human(away.status) && infects(home.status, input.lossToZombieInfects)) atRisk = 'away'
    }

    const t = r.final ? transferOf.get(r.matchupId) : undefined
    let outcome: ZombieMatchupView['outcome'] = null
    if (t) outcome = { kind: t.kind, final: true }
    else if (!r.final && leader) {
      if (margin >= input.rules.maulingThreshold) outcome = { kind: 'mauling', final: false }
      else if (margin >= input.rules.bashingThreshold) outcome = { kind: 'bashing', final: false }
    }

    return {
      id: r.matchupId,
      home,
      away,
      final: r.final,
      margin,
      leader,
      atRisk,
      outcome,
      transfer: t ? { fromRosterId: t.fromRosterId, toRosterId: t.toRosterId, amount: t.amount } : null,
      mySide: input.myRosterId === homeId ? 'home' : input.myRosterId === awayId ? 'away' : null,
    }
  })
}

/** The week's infections from the teams' records — the same pairs settlement used. */
export function infectionPairsForWeek(
  teams: ReadonlyArray<{ rosterId: string; weekBecameZombie: number | null; killedByRosterId: string | null }>,
  week: number,
): InfectionPair[] {
  return teams
    .filter((t) => t.weekBecameZombie === week && t.killedByRosterId)
    .map((t) => ({ victimRosterId: t.rosterId, infectorRosterId: t.killedByRosterId! }))
}
