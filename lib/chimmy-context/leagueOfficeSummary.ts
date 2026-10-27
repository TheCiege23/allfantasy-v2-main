/**
 * The "league office" facts Chimmy is given, as prompt-ready prose: weekly prizes, trades in review,
 * stat corrections, inactive manager mode, the lineup rule for eliminated teams, a dynasty league's
 * offseason rollover, and the latest league-log entries. What each viewer sees
 * matches what the app shows them — the provider decides that; this only words it.
 *
 * Prose rather than an object because the grounding serializer renders a string slice as-is
 * (lib/decision-os/grounding/serialize.ts), so the model reads exactly these sentences.
 *
 * Pure.
 */
import { CONTEST_KINDS, CONTEST_LABELS, formatPrize, type SideContestsView } from '@/lib/side-contests/sideContests'

export type LeagueOfficeInput = {
  viewerRole: 'commissioner' | 'member'
  prizes: Pick<SideContestsView, 'config' | 'weeks' | 'totals'> | null
  /** Trades the viewer can see in review, each already explained (lib/redraft/tradeReviewWindow.ts). */
  trades: ReadonlyArray<{ teams: string; explainer: string }>
  /** Commissioners only: the latest stat-correction review. */
  correction: { week: number; changed: number; unapplied: number; flips: number; automatic: boolean; refused: boolean } | null
  /** Commissioners: teams AllFantasy sets lineups for, and teams it suggests. Members: null. */
  inactive: { managed: string[]; suggested: string[] } | null
  /** The viewer's own team is being set by AllFantasy. */
  viewerTeamManaged: boolean
  /** The league's lineup rule for eliminated teams (lib/eliminated-lineups), in words; every member. */
  eliminatedLineupRule?: string | null
  /** The live rookie order's round notices (lib/rookie-order/roundNotices.ts), in words; every member. */
  rookieOrderRounds?: string | null
  /** An open orphan auction, already worded (lib/orphan-auction). Never anyone's bids. */
  orphanAuction?: string | null
  /** The latest league-log lines the viewer may read; null when the log is hidden from them. */
  log: ReadonlyArray<{ at: string; title: string; detail: string | null }> | null
  /** The payout calculator (lib/payouts), when the commissioner has set a place split. */
  payouts?: {
    final: boolean
    buyInCents: number
    teamCount: number
    potCents: number
    weeklyReserveCents: number
    places: ReadonlyArray<{ place: number; percent: number; cents: number; team: string | null }>
    /** Commissioners only. */
    collected: { cents: number; paidTeams: number } | null
  } | null
  /** Dynasty leagues between seasons: the rollover, already worded for this viewer (lib/season-rollover). */
  offseason?: readonly string[] | null
}

const LOG_LINES = 8
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
const list = (names: readonly string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

function prizeLines(p: NonNullable<LeagueOfficeInput['prizes']>): string[] {
  const on = CONTEST_KINDS.filter((k) => p.config[k].enabled)
  if (on.length === 0) return []
  const lines = [
    `Weekly prizes: ${on.map((k) => `${CONTEST_LABELS[k].en.toLowerCase()}${p.config[k].prizeCents ? ` (${formatPrize(p.config[k].prizeCents)} a week)` : ''}`).join(' and ')}. Regular-season weeks only; a tie splits the prize.`,
  ]
  const latest = p.weeks[0]
  if (!latest) lines.push('No week has finished yet, so no prize has been won.')
  else {
    const parts = on.flatMap((k) => {
      const w = latest.contests[k]
      if (!w?.length) return []
      const names = list(w.map((x) => x.teamName))
      return k === 'high_score'
        ? [`high score ${names} with ${fmt(w[0].value)} points`]
        : [`closest loss ${names}, by ${fmt(w[0].value)}${w.length === 1 && w[0].opponentName ? ` to ${w[0].opponentName}` : ''}`]
    })
    if (parts.length) lines.push(`Week ${latest.week}: ${parts.join('; ')}.`)
  }
  const money = p.totals.filter((t) => t.prizeCents > 0)
  if (money.length) lines.push(`Season prize money so far: ${money.map((t) => `${t.teamName} ${formatPrize(t.prizeCents)}`).join(', ')}.`)
  return lines
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

function payoutLines(p: NonNullable<LeagueOfficeInput['payouts']>): string[] {
  const lines = [
    `Payouts: ${formatPrize(p.buyInCents)} buy-in × ${p.teamCount} teams = ${formatPrize(p.potCents)} pot` +
      (p.weeklyReserveCents ? `, ${formatPrize(p.weeklyReserveCents)} of it for the weekly prizes` : '') +
      '. AllFantasy tracks the money; it does not collect or pay it.',
    `Place payouts (${p.final ? 'final' : 'if the season ended today'}): ` +
      p.places.map((x) => `${ordinal(x.place)} ${formatPrize(x.cents)} (${x.percent}%${x.team ? `, ${x.team}` : ''})`).join('; ') +
      '.',
  ]
  if (p.collected) lines.push(`Buy-ins collected so far: ${formatPrize(p.collected.cents)}, ${p.collected.paidTeams} of ${p.teamCount} teams paid.`)
  return lines
}

/** Null when there is nothing in the league office worth saying. */
export function buildLeagueOfficeSummary(input: LeagueOfficeInput): string | null {
  const lines: string[] = []
  if (input.prizes) lines.push(...prizeLines(input.prizes))
  if (input.payouts?.places.length) lines.push(...payoutLines(input.payouts))
  if (input.offseason?.length) lines.push(...input.offseason)

  for (const t of input.trades) lines.push(`Trade between ${t.teams}: ${t.explainer}`)

  const c = input.correction
  if (c && c.changed > 0) {
    lines.push(
      `Week ${c.week} stat correction: the league office changed stats after the week was final, moving ${c.changed} matchup${c.changed === 1 ? '' : 's'}` +
        (c.flips ? ` and flipping ${c.flips === 1 ? 'a result' : `${c.flips} results`}` : '') +
        '. ' +
        (c.refused
          ? 'This league never applies corrections (an elimination format, or playoff seeds are set), so results stand.'
          : c.automatic
            ? 'AllFantasy applies it automatically (Extended scoring corrections).'
            : c.unapplied
              ? `${c.unapplied} still to apply: the commissioner applies it in League settings > Score adjustments, which updates results and standings.`
              : 'It has been applied; results and standings include it.'),
    )
  }

  if (input.inactive) {
    if (input.inactive.managed.length) lines.push(`AllFantasy is setting the lineup for ${list(input.inactive.managed)} while the manager is away; it stops when the manager saves a lineup.`)
    if (input.inactive.suggested.length) lines.push(`${list(input.inactive.suggested)} ${input.inactive.suggested.length === 1 ? 'looks' : 'look'} inactive; the commissioner can let AllFantasy set ${input.inactive.suggested.length === 1 ? 'its' : 'their'} lineups from the Commissioner Hub.`)
  }
  if (input.viewerTeamManaged) lines.push('AllFantasy is setting your lineup while you are away; saving a lineup yourself stops it.')
  if (input.eliminatedLineupRule) lines.push(input.eliminatedLineupRule)
  if (input.rookieOrderRounds) lines.push(input.rookieOrderRounds)
  if (input.orphanAuction) lines.push(input.orphanAuction)

  if (input.log?.length) {
    lines.push('Latest league log:')
    for (const e of input.log.slice(0, LOG_LINES)) lines.push(`- ${e.at.slice(0, 10)}: ${e.title}${e.detail ? ` (${e.detail})` : ''}`)
  }

  return lines.length ? lines.join('\n') : null
}
