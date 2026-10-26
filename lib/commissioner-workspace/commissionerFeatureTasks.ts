/**
 * Commissioner Workspace tasks for the native commissioner tools: a stat correction nobody has
 * applied, a trade in commissioner review, and teams that look inactive with nobody setting their
 * lineup. Each meets the bar in ./taskSources.ts:
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

/**
 * Teams manager health calls inactive that nobody has handed to AllFantasy (lib/inactive-manager).
 * One task for the group, as `detectInactiveManagers` does: the commissioner's action is one visit.
 */
export function detectInactiveTeamsToManage(leagueId: string, suggested: readonly string[]): WorkspaceTaskCandidate | null {
  if (suggested.length === 0) return null
  const named =
    suggested.length === 1
      ? suggested[0]
      : suggested.length === 2
        ? `${suggested[0]} and ${suggested[1]}`
        : `${suggested.slice(0, -1).join(', ')} and ${suggested[suggested.length - 1]}`
  return {
    sourceKey: 'inactive-manager-mode-suggestion:v1',
    title: suggested.length === 1 ? 'An inactive team has nobody setting its lineup' : `${suggested.length} inactive teams have nobody setting their lineups`,
    description:
      `${named} ${suggested.length === 1 ? 'looks' : 'look'} inactive. You can let AllFantasy set ` +
      `${suggested.length === 1 ? 'its' : 'their'} projected-best lineup every week until the manager comes back; ` +
      'it stops by itself the moment the manager saves a lineup.',
    priority: 'standard',
    // AllFantasy suggests; only the commissioner turns it on. Never automated.
    automationCandidate: false,
    relatedLinks: [{ label: 'Commissioner Hub', moduleId: 'managers', href: `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-inactive-managers` }],
  }
}

export async function readCommissionerFeatureTasks(leagueId: string, now: Date): Promise<WorkspaceTaskCandidate[]> {
  const [{ prisma }, { readStatCorrections }, { readInactiveManagerView }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/stat-corrections/statCorrectionService'),
    import('@/lib/inactive-manager/inactiveManagerService'),
  ])
  const [corrections, proposals, inactive] = await Promise.all([
    readStatCorrections(leagueId),
    prisma.redraftTradeProposal.findMany({
      where: { leagueId, status: 'pending', vetoMode: 'commissioner', acceptedAt: { not: null }, expiresAt: { not: null } },
      select: { id: true, expiresAt: true, proposerRosterId: true, receiverRosterId: true },
    }),
    readInactiveManagerView(leagueId),
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

  const rosterIds = [...new Set(proposals.flatMap((p) => [p.proposerRosterId, p.receiverRosterId]))]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const name = (id: string) => {
    const r = rosters.find((x) => x.id === id)
    return r?.teamName?.trim() || r?.ownerName || 'A team'
  }
  const trades = detectTradesInReview(
    leagueId,
    proposals.map((p) => ({ id: p.id, endsAt: p.expiresAt!, teams: `${name(p.proposerRosterId)} and ${name(p.receiverRosterId)}` })),
    now,
  )

  const suggested = inactive.native
    ? inactive.teams.filter((t) => t.suggested).map((t) => t.teamName || t.managerName || 'A team')
    : []
  const inactiveTask = detectInactiveTeamsToManage(leagueId, suggested)

  return [...(statCorrection ? [statCorrection] : []), ...trades, ...(inactiveTask ? [inactiveTask] : [])]
}
