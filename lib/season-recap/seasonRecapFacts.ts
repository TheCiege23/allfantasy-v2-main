/**
 * The season recap as a flat list of facts — the ONLY material the written recap may use. PURE.
 *
 * Chimmy's written recap (./seasonRecapAiService.ts) is handed exactly this list and nothing else, and
 * the fact guard (`validateSeasonRecapText` in lib/league-story-creator/StoryFactGuard.ts) checks the
 * text against the same list: a number that is not one of these values, or a name the recap is about
 * that went missing, and the text is refused. So a fact that is not here cannot be in the output.
 *
 * The values are the ones the recap page shows (points to one decimal, trade value to a whole number,
 * win rates as whole percentages), so the written recap and the page beside it agree.
 *
 * `computedAt` is deliberately NOT a fact: a recap computed on the spot for an unpublished season gets a
 * fresh `computedAt` on every read, and the facts hash below keys the stored text. Only what the season
 * says goes in, so the hash changes when — and only when — the season's facts do.
 */
import { createHash } from 'node:crypto'
import type { SeasonRecap } from './computeSeasonRecap'

export type RecapFact = { key: string; value: string | number }

const r1 = (n: number) => Math.round(n * 10) / 10

export function buildSeasonRecapFacts(recap: SeasonRecap, leagueName?: string | null): RecapFact[] {
  const facts: RecapFact[] = []
  const add = (key: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return
    if (typeof value === 'string' && !value.trim()) return
    if (typeof value === 'number' && !Number.isFinite(value)) return
    facts.push({ key, value })
  }

  add('leagueName', leagueName?.trim() || null)
  add('season', recap.season)
  add('sport', recap.sport)
  add('teamCount', recap.teamLines.length)
  add('championTeam', recap.champion?.name)
  add('runnerUpTeam', recap.runnerUp?.name)

  if (recap.topSeed) {
    add('topSeedTeam', recap.topSeed.name)
    add('topSeedWins', recap.topSeed.wins)
    add('topSeedLosses', recap.topSeed.losses)
    if (recap.topSeed.ties) add('topSeedTies', recap.topSeed.ties)
  }
  if (recap.mostPointsFor) {
    add('mostPointsForTeam', recap.mostPointsFor.name)
    add('mostPointsFor', r1(recap.mostPointsFor.points))
  }
  if (recap.highestWeek) {
    add('highestWeekTeam', recap.highestWeek.name)
    add('highestWeekPoints', r1(recap.highestWeek.points))
    add('highestWeekNumber', recap.highestWeek.week)
  }
  for (const [prefix, g] of [['blowout', recap.biggestBlowout], ['closestGame', recap.closestGame]] as const) {
    if (!g) continue
    add(`${prefix}WinnerTeam`, g.winner.name)
    add(`${prefix}LoserTeam`, g.loser.name)
    add(`${prefix}WinnerScore`, r1(g.winnerScore))
    add(`${prefix}LoserScore`, r1(g.loserScore))
    add(`${prefix}Margin`, r1(g.margin))
    add(`${prefix}Week`, g.week)
  }
  for (const [prefix, tr] of [['bestTrade', recap.bestTrade], ['worstTrade', recap.worstTrade]] as const) {
    if (!tr) continue
    add(`${prefix}Team`, tr.name)
    add(`${prefix}PartnerTeam`, tr.partner?.name)
    add(`${prefix}NetValue`, Math.round(tr.net))
  }
  if (recap.bestPickup) {
    add('bestPickupTeam', recap.bestPickup.name)
    add('bestPickupPlayer', recap.bestPickup.playerName)
    add('bestPickupPosition', recap.bestPickup.position)
    add('bestPickupWeek', recap.bestPickup.pickupWeek)
    add('bestPickupPointsAfter', r1(recap.bestPickup.pointsAfter))
    add('bestPickupWeeksCounted', recap.bestPickup.weeksCounted)
  }
  if (recap.mostImproved) {
    const m = recap.mostImproved
    add('mostImprovedTeam', m.name)
    add('mostImprovedBasis', m.basis === 'prior_season' ? 'win rate, last season vs this season' : 'points per week, first half vs second half')
    if (m.basis === 'prior_season') {
      add('mostImprovedWinPctBefore', Math.round(m.before * 100))
      add('mostImprovedWinPctAfter', Math.round(m.after * 100))
    } else {
      add('mostImprovedPointsPerWeekBefore', r1(m.before))
      add('mostImprovedPointsPerWeekAfter', r1(m.after))
    }
  }
  if (recap.lowerBracket) {
    add('lowerBracketType', recap.lowerBracket.mode === 'toilet_bowl' ? 'toilet bowl' : 'consolation bracket')
    add('lowerBracketWinnerTeam', recap.lowerBracket.winner.name)
    add('lowerBracketLoserTeam', recap.lowerBracket.loser.name)
  }
  add('tradeCount', recap.tradeCount)

  for (const line of recap.teamLines) {
    const p = `standing${line.rank}`
    add(`${p}Rank`, line.rank)
    add(`${p}Team`, line.team.name)
    add(`${p}Wins`, line.wins)
    add(`${p}Losses`, line.losses)
    if (line.ties) add(`${p}Ties`, line.ties)
    add(`${p}PointsFor`, r1(line.pointsFor))
    add(`${p}Finish`, line.finish.replace('_', ' '))
    if (line.longestWinStreak > 0) add(`${p}LongestWinStreak`, line.longestWinStreak)
  }
  return facts
}

/** The names the written recap is ABOUT, and so must keep: dropping the champion is a different story. */
export function requiredRecapNames(recap: SeasonRecap): string[] {
  return recap.champion ? [recap.champion.name] : []
}

/** Keys the stored text: same facts, same hash; any change to the season's facts, a new one. */
export function seasonRecapFactsHash(facts: readonly RecapFact[]): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 24)
}
