/**
 * Commissioner Workspace tasks for the native commissioner tools: a stat correction nobody has
 * applied, a trade in commissioner review, teams that look inactive with nobody setting their
 * lineup, weekly prizes that promise more than the payout pot holds, and a finished season nobody has
 * renewed. Each meets the bar in ./taskSources.ts:
 *
 *   measured     read from rows we hold — the stored correction review, the pending proposals, the
 *                manager-health read the Commissioner Hub already shows
 *   actionable   each links to the one screen where the commissioner acts on it
 *   self-clearing applying the correction, settling the trade, or handing the team to AllFantasy
 *                (or the manager coming back) removes the condition, so the store closes the task
 *
 * Native leagues only: every one of these tools exists only where AllFantasy runs the league.
 *
 * The detectors are pure; `readCommissionerFeatureTasks` does the reads. A failed read THROWS, as
 * `readOperationalTasks` does, so reconciliation never closes an open task on a snapshot it could
 * not take.
 */
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import { joinTeamNames, tradeParticipantRosterIds } from '@/lib/redraft/tradeParticipants'
import type { WorkspaceTaskCandidate } from './taskSources'

const HOUR_MS = 60 * 60 * 1000

export type StatCorrectionTaskInput = {
  season: number
  week: number
  /** Matchups the review lists that are not yet fully applied. */
  unapplied: number
  /** Of those, how many would change the result. */
  flipsResult: number
  /** AllFantasy applies corrections itself (Extended scoring corrections on). */
  autoApplied: boolean
  /** An elimination format, or playoff seeds set: corrections are shown, never applied. */
  refused: boolean
}

/** A correction the league office posted after the week sealed, waiting on the commissioner. */
export function detectUnappliedStatCorrection(leagueId: string, input: StatCorrectionTaskInput | null): WorkspaceTaskCandidate | null {
  // Nothing to apply, nothing the commissioner can apply, or AllFantasy is applying it within the hour.
  if (!input || input.unapplied === 0 || input.refused || input.autoApplied) return null
  const flips = input.flipsResult > 0
  return {
    sourceKey: `stat-correction:${input.season}:${input.week}:v1`,
    title: flips ? `A stat correction changes a week ${input.week} result` : `Week ${input.week} has a stat correction to apply`,
    description:
      `The league office corrected stats after week ${input.week} was final, changing ` +
      `${input.unapplied} matchup${input.unapplied === 1 ? '' : 's'}` +
      (flips ? `, and ${input.flipsResult === 1 ? 'one result flips' : `${input.flipsResult} results flip`}` : '') +
      '. Results and standings stay as sealed until you apply it; applying adds each team’s ' +
      'correction as a score adjustment, so the result, the standings and the league log move together.',
    priority: flips ? 'elevated' : 'standard',
    // Whether to rewrite a sealed result is the commissioner's call (or AF Commissioner's automatic
    // corrections, which this task already steps aside for).
    automationCandidate: false,
    relatedLinks: [{ label: 'Score adjustments', moduleId: 'settings', href: leagueSettingsHomeHref(leagueId, 'score-adjustments') }],
  }
}

export type TradeInReview = { id: string; endsAt: Date; teams: string }

/**
 * An accepted trade in COMMISSIONER review. It goes through by itself when the window ends
 * (lib/redraft/tradeReviewWindow.ts), so the task is the commissioner's last chance to veto — and
 * is due when the window ends. League-vote trades are the league's decision, not a commissioner task.
 */
export function detectTradesInReview(leagueId: string, trades: readonly TradeInReview[], now: Date): WorkspaceTaskCandidate[] {
  const id = encodeURIComponent(leagueId)
  return trades
    .filter((t) => t.endsAt.getTime() > now.getTime())
    .map((t) => {
      const hours = Math.max(1, Math.ceil((t.endsAt.getTime() - now.getTime()) / HOUR_MS))
      const soon = hours <= 24
      return {
        sourceKey: `redraft-trade-review:${t.id}:v1`,
        title: soon ? 'A trade goes through within a day unless you veto it' : 'A trade is waiting on your review',
        description:
          `${t.teams}: both managers accepted, and the trade goes through when its review window ends ` +
          `in ${hours === 1 ? 'under an hour' : `${hours} hours`} unless you veto it. You can also approve it now.`,
        dueAt: t.endsAt,
        priority: soon ? ('elevated' as const) : ('standard' as const),
        // Approving or vetoing a trade is a judgement call; doing nothing is already the default.
        automationCandidate: false,
        relatedLinks: [{ label: 'Trades', moduleId: 'settings' as const, href: `/core/trades?league=${id}` }],
      }
    })
}

/** "A, B, C and 13 more": a task names a few teams, never a paragraph of sixteen. */
export function shortTeamList(names: readonly string[], show = 3): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length <= show) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, show).join(', ')} and ${names.length - show} more`
}

/**
 * Teams manager health calls inactive that nobody has handed to AllFantasy (lib/inactive-manager).
 * One task for the group, as `detectInactiveManagers` does: the commissioner's action is one visit.
 *
 * 🛑 AN OPEN SEAT IS NOT AN INACTIVE MANAGER (owner report, 2026-11-28). A 16-team league with three
 * managers read "16 inactive teams have nobody setting their lineups", followed by every team's name in
 * one paragraph: thirteen "Open Team N" seats nobody has joined, plus the commissioner's own team. The
 * seats are now counted as teams with no manager, the caller leaves out the league owner's own team,
 * and the list stops at three names.
 */
export function detectInactiveTeamsToManage(
  leagueId: string,
  suggested: readonly string[],
  openSeats: readonly string[] = [],
): WorkspaceTaskCandidate | null {
  if (suggested.length === 0 && openSeats.length === 0) return null
  const n = suggested.length
  const o = openSeats.length
  const title =
    n && o
      ? `${n === 1 ? '1 inactive team' : `${n} inactive teams`} and ${o === 1 ? '1 open seat' : `${o} open seats`} need lineups`
      : n
        ? n === 1 ? 'An inactive team has nobody setting its lineup' : `${n} inactive teams have nobody setting their lineups`
        : o === 1 ? 'A team has no manager' : `${o} teams have no manager`
  const parts: string[] = []
  if (n) parts.push(`${shortTeamList(suggested)} ${n === 1 ? 'looks' : 'look'} inactive.`)
  if (o) parts.push(n ? `${o === 1 ? 'One team has' : `${o} teams have`} no manager yet.` : `${shortTeamList(openSeats)} ${o === 1 ? 'has' : 'have'} no manager yet. Invite someone, or`)
  const them = n + o === 1 ? 'its' : 'their'
  const offer = `let AllFantasy set ${them} projected-best lineup every week; it stops the moment a manager saves a lineup.`
  const description = n || !o ? `${parts.join(' ')} You can ${offer}` : `${parts.join(' ')} ${offer}`
  return {
    sourceKey: 'inactive-manager-mode-suggestion:v1',
    title,
    description,
    priority: 'standard',
    // AllFantasy suggests; only the commissioner turns it on. Never automated.
    automationCandidate: false,
    relatedLinks: [{ label: 'Commissioner Hub', moduleId: 'managers', href: `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-inactive-managers` }],
  }
}

/**
 * The weekly side-contest prizes, over the regular season, add up to more than the buy-ins bring in
 * (lib/payouts). Self-clearing: lowering a prize or raising the buy-in removes it.
 */
export function detectPayoutOvercommitment(
  leagueId: string,
  input: { potCents: number; overCommittedCents: number; season: number } | null,
): WorkspaceTaskCandidate | null {
  if (!input || input.overCommittedCents <= 0) return null
  const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`
  return {
    sourceKey: `payout-overcommitted:${input.season}:v1`,
    title: 'Weekly prizes promise more than the pot holds',
    description:
      `Over the regular season the weekly prizes come to ${dollars(input.overCommittedCents)} more than the ` +
      `${dollars(input.potCents)} pot, so nothing is left for the place payouts. Lower a weekly prize or raise the buy-in.`,
    priority: 'standard',
    // How much money is at stake is the commissioner's call.
    automationCandidate: false,
    relatedLinks: [{ label: 'Standings · Payouts', moduleId: 'settings', href: `/core/standings?league=${encodeURIComponent(leagueId)}` }],
  }
}

/**
 * The season is over and the league has not been renewed (lib/season-rollover). Self-clearing:
 * renewing moves the league into next season, which removes the condition.
 */
export function detectRolloverDue(
  leagueId: string,
  input: { season: number; kind?: 'redraft' | 'dynasty' } | null,
): WorkspaceTaskCandidate | null {
  if (!input) return null
  return {
    sourceKey: `season-rollover:${input.season}:v1`,
    title: `Set up the ${input.season + 1} season`,
    description:
      input.kind === 'dynasty'
        ? `The ${input.season} season is over. The rollover wizard walks you through the rookie draft order, ` +
          `taxi squads, contracts, next season’s dues and the schedule, then starts the season. Rosters carry over.`
        : `The ${input.season} season is over. The rollover wizard walks you through payouts, returning managers, ` +
          `next season’s dues and the draft order, then renews the league in one step.`,
    priority: 'standard',
    // Renewing resets every roster, and a dynasty start moves taxi players; only the commissioner decides when.
    automationCandidate: false,
    relatedLinks: [{ label: 'Next season', moduleId: 'settings', href: `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-rollover` }],
  }
}

export async function readCommissionerFeatureTasks(leagueId: string, now: Date): Promise<WorkspaceTaskCandidate[]> {
  const [{ prisma }, { readStatCorrections }, { readInactiveManagerView }, { readPayoutOvercommitment }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/stat-corrections/statCorrectionService'),
    import('@/lib/inactive-manager/inactiveManagerService'),
    import('@/lib/payouts/payoutService'),
  ])
  const { readRolloverDue } = await import('@/lib/season-rollover/rolloverService')
  const [corrections, proposals, inactive, overcommitment, rollover] = await Promise.all([
    readStatCorrections(leagueId),
    prisma.redraftTradeProposal.findMany({
      where: { leagueId, status: 'pending', vetoMode: 'commissioner', acceptedAt: { not: null }, expiresAt: { not: null } },
      select: { id: true, expiresAt: true, proposerRosterId: true, receiverRosterId: true, additionalRosterIds: true },
    }),
    readInactiveManagerView(leagueId),
    readPayoutOvercommitment(leagueId),
    readRolloverDue(leagueId),
  ])

  const latest = corrections.latest
  const unapplied = latest?.matchups.filter((m) => !m.fullyApplied) ?? []
  const statCorrection = detectUnappliedStatCorrection(
    leagueId,
    latest && latest.changes.length > 0
      ? {
          season: latest.season,
          week: latest.week,
          unapplied: unapplied.length,
          flipsResult: unapplied.filter((m) => m.resultFlipped).length,
          autoApplied: Boolean(corrections.extended?.enabled),
          refused: Boolean(corrections.extended?.refusal),
        }
      : null,
  )

  // Every team in the trade (lib/redraft/tradeParticipants.ts): a multi-team trade names all of them.
  const rosterIds = [...new Set(proposals.flatMap((p) => tradeParticipantRosterIds(p)))]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const name = (id: string) => {
    const r = rosters.find((x) => x.id === id)
    return r?.teamName?.trim() || r?.ownerName || 'A team'
  }
  const trades = detectTradesInReview(
    leagueId,
    proposals.map((p) => ({ id: p.id, endsAt: p.expiresAt!, teams: joinTeamNames(tradeParticipantRosterIds(p).map(name)) })),
    now,
  )

  // The league owner's own team is never suggested to them: the commissioner reading this is not absent.
  const candidates = inactive.native ? inactive.teams.filter((t) => t.suggested && !t.leagueOwnerTeam) : []
  const label = (t: (typeof candidates)[number]) => t.teamName || t.managerName || 'A team'
  const inactiveTask = detectInactiveTeamsToManage(
    leagueId,
    candidates.filter((t) => !t.emptySeat).map(label),
    candidates.filter((t) => t.emptySeat).map(label),
  )

  const payoutTask = detectPayoutOvercommitment(leagueId, overcommitment)
  const rolloverTask = detectRolloverDue(leagueId, rollover)

  return [...(statCorrection ? [statCorrection] : []), ...trades, ...(inactiveTask ? [inactiveTask] : []), ...(payoutTask ? [payoutTask] : []), ...(rolloverTask ? [rolloverTask] : [])]
}
