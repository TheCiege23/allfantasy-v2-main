/**
 * TAXI DEADLINE NOTICES — the week a taxi deadline closes, every owner is told before it does
 * (phase 8, 2026-10-29).
 *
 * The deadlines themselves need no job: a save after them is refused (./taxiMoveRules.ts) and every
 * player simply stays where he is. What nothing did was say so in time. A manager who meant to promote
 * a player found out the week after, when the save was refused. So, in the deadline week itself:
 *
 *   promotion deadline   each team with players on its taxi squad is told who they are and that this
 *                        is the last week to promote them; after it they stay on the squad
 *   lock week            every team is told this is the last week to put a player onto the squad
 *
 * The commissioner gets one summary. Nothing is sent when a league allows no in-season taxi moves at
 * all (there is no window to warn about), or in the offseason, when the rules do not apply.
 *
 * Pure.
 */
import type { TaxiMoveRules, TaxiSeasonPhase } from './taxiMoveRules'

export type TaxiDeadlineKind = 'promotion_closes' | 'lock_closes'

/** The deadlines that close at the end of `week`, in the order they are announced. */
export function taxiDeadlinesClosingThisWeek(rules: TaxiMoveRules, phase: TaxiSeasonPhase, week: number): TaxiDeadlineKind[] {
  if (phase === 'offseason') return []
  if (phase === 'regular' && !rules.inSeasonMoves) return []
  if (phase === 'playoffs' && !rules.postseasonMoves) return []
  const out: TaxiDeadlineKind[] = []
  if (rules.promotionDeadlineWeek != null && rules.promotionDeadlineWeek === week) out.push('promotion_closes')
  if (rules.lockAfterWeek != null && rules.lockAfterWeek === week) out.push('lock_closes')
  return out
}

export type TaxiTeam = { ownerId: string; teamName: string | null; taxiPlayers: string[] }

export type TaxiDeadlineMessage = { userId: string; audience: 'owner' | 'commissioner'; kind: TaxiDeadlineKind; title: string; body: string }

const list = (names: readonly string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** What each owner, and the commissioner, is told this week. */
export function taxiDeadlineMessages(args: {
  kinds: readonly TaxiDeadlineKind[]
  week: number
  leagueName: string
  teams: readonly TaxiTeam[]
  commissionerId: string
}): TaxiDeadlineMessage[] {
  const { week, leagueName } = args
  const out: TaxiDeadlineMessage[] = []
  const summary: string[] = []
  for (const kind of args.kinds) {
    if (kind === 'promotion_closes') {
      const withTaxi = args.teams.filter((t) => t.taxiPlayers.length > 0)
      for (const t of withTaxi) {
        out.push({
          userId: t.ownerId,
          audience: 'owner',
          kind,
          title: `Last week to promote off your taxi squad · ${leagueName}`,
          body: `Taxi promotions close after week ${week}. ${list(t.taxiPlayers)} ${t.taxiPlayers.length === 1 ? 'is' : 'are'} on your taxi squad; promote anyone you want on your active roster this week, or they stay on the squad for the rest of the season.`,
        })
      }
      const count = withTaxi.reduce((n, t) => n + t.taxiPlayers.length, 0)
      summary.push(`taxi promotions close after week ${week}; ${withTaxi.length} team${withTaxi.length === 1 ? '' : 's'} with ${count} taxi player${count === 1 ? '' : 's'} ${withTaxi.length === 1 ? 'was' : 'were'} told`)
    } else {
      for (const t of args.teams) {
        out.push({
          userId: t.ownerId,
          audience: 'owner',
          kind,
          title: `Last week to add to your taxi squad · ${leagueName}`,
          body: `The taxi squad locks after week ${week}: this is the last week to put a player onto it.`,
        })
      }
      summary.push(`the taxi squad locks after week ${week}; every team was told`)
    }
  }
  if (summary.length > 0) {
    out.push({
      userId: args.commissionerId,
      audience: 'commissioner',
      kind: args.kinds[0]!,
      title: `Taxi deadline this week · ${leagueName}`,
      body: `${summary.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('. ')}. Nothing needs doing: after the deadline, saves that break it are refused and every player stays where he is.`,
    })
  }
  return out
}
