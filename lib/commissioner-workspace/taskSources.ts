import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'
import { readActivityWindow, readManagerActivity } from '@/lib/league-history/leagueWarehouseReads'
import { readOrphanTeamCounts } from './rosterReads'

/**
 * What Commissioner Workspace's tasks are DERIVED from.
 *
 * ── WHY THESE AND NOT "EVERYTHING WE COULD DETECT" ───────────────────────────────────────────
 *
 * A task list is a promise that the things on it are worth a commissioner's attention. The
 * cheapest way to make one worthless is to fill it with conditions nobody can act on, so the bar
 * for a detector here is deliberately high and stated once:
 *
 *   1. The condition is MEASURED from rows we hold, never inferred from their absence.
 *   2. A commissioner can actually do something about it.
 *   3. It CLEARS on its own when the situation resolves, so the store can close the task and the
 *      list shrinks without anybody tidying it.
 *
 * Four detectors clear that bar today. Adding a fifth is a deliberate edit here, not a config flag.
 *
 * 🛑 THESE ARE PURE FUNCTIONS OF READS. They decide nothing about persistence — `taskStore.ts`
 * owns that — which is what lets the whole detection layer be tested without a database.
 */

/** A detected condition, before it is reconciled against whatever is already stored. */
export interface WorkspaceTaskCandidate {
  /**
   * Stable identity for the CONDITION, not for this observation of it. Re-detecting the same
   * condition must find the same key, or the store adds a second copy every run.
   *
   * Versioned (`:v1`) so that redefining what a detector means opens a NEW task rather than
   * silently rewriting an existing one's history — a commissioner who resolved "your data is 20
   * days old" should not have that row quietly become a different claim.
   */
  sourceKey: string
  title: string
  description: string
  priority: 'critical' | 'elevated' | 'standard' | 'advisory'
  /** True only where a scheduled job could genuinely do the work — never for judgement calls. */
  automationCandidate: boolean
  /**
   * `moduleId` is a `CommissionerModuleId`, but this file cannot import that type: it lives under
   * `lib/commissioner-ui/`, and depending on a UI module from the detection layer would invert the
   * dependency the ESLint boundary exists to keep one-way. The narrow union below is the same set
   * spelled locally, and `live.ts` validates every id against the real one on the way out — so a
   * drift here surfaces as a dropped link rather than as a dead route.
   */
  relatedLinks: { label: string; moduleId: 'analytics' | 'managers' | 'settings'; href: string }[]
}

function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`
}

function wholeDaysSince(at: Date, now: Date): number {
  return Math.floor((now.getTime() - at.getTime()) / 86_400_000)
}

/**
 * The league's imported feed has stopped arriving.
 *
 * 🛑 THIS IS THE CONDITION THAT MAKES EVERY OTHER COMMISSIONER OS PANEL LIE, which is why it is
 * the first detector rather than a nicety. Measured on a real 12-team Sleeper league on
 * 2026-09-07: the analytics page read "Active Managers 0 of 7" and "Trade Activity: None" over a
 * league with twelve rostered teams and a six-season history. Both numbers were arithmetically
 * correct. What they meant was that the newest imported event was 18 days old — past
 * MANAGER_INACTIVE_AFTER_DAYS, so every manager flipped inactive — and the commissioner had no
 * way to tell "your league is dead" from "we stopped receiving your data".
 *
 * Measured platform-wide on 2026-09-08: 44 of the 119 leagues with imported activity are past
 * this threshold. So this is not a hypothetical queue.
 */
export function detectStaleImport(
  lastActivityAt: Date | null,
  eventCount: number,
  now: Date,
): WorkspaceTaskCandidate | null {
  // Never imported at all is a different situation with a different fix (connect the league), and
  // reporting it as "your feed stopped" would be a claim about a feed that never started.
  if (!lastActivityAt || eventCount === 0) return null

  const age = wholeDaysSince(lastActivityAt, now)
  if (age <= MANAGER_INACTIVE_AFTER_DAYS) return null

  /*
   * Severity tracks consequence, not just age. Past the inactivity threshold the manager-activity
   * numbers are already wrong; past 30 days the season-scoped panels are describing a league that
   * has moved on without us.
   */
  const priority = age > 30 ? 'critical' : 'elevated'

  return {
    sourceKey: 'data-stale:v1',
    title: 'League data has stopped arriving',
    description:
      `The newest imported event for this league is ${days(age)} old. Every rolling-window figure ` +
      `on League Analytics — active managers, trade activity, transactions per week — is computed ` +
      `over a ${MANAGER_INACTIVE_AFTER_DAYS}-day and 90-day window, so they now read as though the ` +
      `league went quiet. Re-run the import to bring the feed current; the figures correct ` +
      `themselves once it does.`,
    priority,
    // A re-sync is repetitive and low-stakes — exactly what the Automation Center canon permits.
    automationCandidate: true,
    relatedLinks: [
      { label: 'League Analytics', moduleId: 'analytics', href: '/commissioner-os/analytics' },
      { label: 'League settings', moduleId: 'settings', href: '/commissioner-os/settings' },
    ],
  }
}

/**
 * Managers who have done nothing in the inactivity window, in a league whose data IS current.
 *
 * ⚠ THE FRESHNESS GATE IS THE WHOLE CORRECTNESS OF THIS DETECTOR, not a guard clause. On a stale
 * league every manager reads inactive, so without the gate this fires on every league the first
 * detector already covers, and every one of those tasks is the stale-import task wearing a
 * disguise. That is precisely the confusion the analytics data-window work exists to prevent, and
 * re-introducing it here — one layer down, as a task list — would undo it.
 *
 * One task for the group rather than one per manager: the commissioner's action is a single round
 * of outreach, and twelve rows for one decision is a queue nobody reads.
 */
export function detectInactiveManagers(
  managers: { managerName: string; currentCount: number }[],
  lastActivityAt: Date | null,
  now: Date,
): WorkspaceTaskCandidate | null {
  if (!lastActivityAt) return null
  if (wholeDaysSince(lastActivityAt, now) > MANAGER_INACTIVE_AFTER_DAYS) return null
  if (managers.length === 0) return null

  const idle = managers.filter((m) => m.currentCount === 0).map((m) => m.managerName)
  if (idle.length === 0) return null

  /*
   * Everybody idle in a league whose feed is current is a statement about the league, not about
   * its managers — an offseason, or a league that has wound down. Naming every manager as the
   * problem would be the wrong claim, so it is reported as the league-level fact it is.
   */
  const allIdle = idle.length === managers.length

  const named =
    idle.length === 1
      ? idle[0]
      : idle.length === 2
        ? `${idle[0]} and ${idle[1]}`
        : `${idle.slice(0, -1).join(', ')} and ${idle[idle.length - 1]}`

  return {
    sourceKey: 'inactive-managers:v1',
    title: allIdle
      ? 'No manager has acted in the last two weeks'
      : `${idle.length} manager${idle.length === 1 ? '' : 's'} inactive for ${days(MANAGER_INACTIVE_AFTER_DAYS)}`,
    description: allIdle
      ? `None of the ${managers.length} managers has made a roster move, waiver claim or trade in ` +
        `the last ${days(MANAGER_INACTIVE_AFTER_DAYS)}, and the league's data is current — so this ` +
        `is the league itself being quiet rather than a gap in what we receive.`
      : `${named} ${idle.length === 1 ? 'has' : 'have'} made no roster move, waiver claim or trade ` +
        `in the last ${days(MANAGER_INACTIVE_AFTER_DAYS)}. The league's data is current, so this is ` +
        `real inactivity rather than a stale feed.`,
    priority: allIdle ? 'advisory' : 'standard',
    // Outreach about whether someone is still playing is a judgement call about a person.
    automationCandidate: false,
    relatedLinks: [
      { label: 'Manager Intelligence', moduleId: 'managers', href: '/commissioner-os/managers' },
    ],
  }
}


/**
 * A league that was connected to a provider and has never produced a single event.
 *
 * 🛑 141 OF THE 288 COMMISSIONED LEAGUES ON PRODUCTION ARE IN THIS STATE, AND NOT ONE OF THEM GOT A
 * TASK. `detectStaleImport` declines them on purpose — "never imported at all is a different
 * situation with a different fix, and reporting it as 'your feed stopped' would be a claim about a
 * feed that never started" — and `detectInactiveManagers` declines them too, because it needs a
 * `lastActivityAt` to gate on. Both refusals are right, and the gap between them was the single
 * largest reason Workspace looked empty: nearly half the platform's leagues fell into it.
 *
 * ⚠ THIS IS MEASURED, NOT INFERRED FROM ABSENCE, AND THE DISTINCTION IS THE WHOLE DETECTOR. What is
 * measured is the CONNECTION: every one of those 141 leagues carries a `platform` and a
 * `platformLeagueId`, so somebody deliberately connected it. A connected league holding zero events
 * is an inconsistency between two things we hold, which is a fact. "This league has no data" on its
 * own would not be.
 *
 * 🛑 AND `eventCount` MUST COME FROM `readActivityWindow`, WHICH IS PROVIDER-SCOPED. One Sleeper
 * league produces one AF `leagues` row PER IMPORTING USER, and only one of them ever holds the
 * activity — so counting by `afLeagueId` alone reports every sibling row as empty. Measured
 * 2026-09-09: 169 leagues look empty that way against 141 that genuinely are. Those 28 false
 * positives are leagues whose real history is sitting under a sibling row. `readActivityWindow`
 * already unions on `provider` + `providerLeagueId`, which is why this detector takes its count from
 * there rather than running a query of its own.
 */
export function detectNeverImported(
  lastActivityAt: Date | null,
  eventCount: number,
): WorkspaceTaskCandidate | null {
  // Any event at all means the connection works, and a different detector owns whatever is wrong.
  if (eventCount > 0 || lastActivityAt) return null

  return {
    sourceKey: 'never-imported:v1',
    title: 'This league is connected but has never sent any data',
    description:
      'The league is linked to its platform, but no trade, waiver claim, roster move or draft pick ' +
      'has ever arrived for it. Until some does, every intelligence surface here has nothing to ' +
      'read — League Health, Manager Intelligence and the analytics panels stay empty no matter how ' +
      'active the league actually is. Re-running the import is the fix, and it is the whole fix.',
    /*
     * `elevated`, not `critical`. Nothing is broken or at risk — the product simply cannot say
     * anything about this league yet. Critical is reserved for a condition with a consequence, and
     * spending it here would flatten the distinction on the leagues that have one.
     */
    priority: 'elevated',
    // A re-import is repetitive and low-stakes, the same reasoning `detectStaleImport` applies.
    automationCandidate: true,
    relatedLinks: [{ label: 'League settings', moduleId: 'settings', href: '/commissioner-os/settings' }],
  }
}

/**
 * Seats nobody is sitting in.
 *
 * Measured from `league_teams.isOrphan` — rows we hold, flagged by the import itself — so it needs
 * no inference. 25 commissioned leagues carry 147 orphan rows between them on production.
 *
 * ⚠ ONE TASK FOR THE LEAGUE, NOT ONE PER SEAT, for the same reason `detectInactiveManagers` groups
 * its managers: filling vacancies is a single recruiting decision a commissioner makes once, and a
 * league with eleven orphans would otherwise bury every other task in the queue.
 */
export function detectOrphanTeams(orphanCount: number, totalTeams: number): WorkspaceTaskCandidate | null {
  if (orphanCount <= 0) return null

  /*
   * A league that is MOSTLY unclaimed is a different situation from one with a seat to fill — it has
   * probably not finished being set up, or has wound down. Severity says which without claiming to
   * know which it is.
   */
  const majority = totalTeams > 0 && orphanCount * 2 >= totalTeams

  return {
    sourceKey: 'orphan-teams:v1',
    title: orphanCount === 1 ? 'One team has no manager' : `${orphanCount} teams have no manager`,
    description: majority
      ? `${orphanCount} of the ${totalTeams} teams in this league are unclaimed. Standings, scoring ` +
        'and every per-manager reading here describe only the seats that are filled, so treat them ' +
        'as partial until the roster is settled.'
      : `${orphanCount} team${orphanCount === 1 ? '' : 's'} in this league ` +
        `${orphanCount === 1 ? 'has' : 'have'} no manager attached. An unclaimed team does not set a ` +
        'lineup or make a move, so it drags every league-wide participation figure down without ' +
        'anybody having gone quiet.',
    priority: majority ? 'elevated' : 'standard',
    // Deciding who fills a seat is a judgement call about people, never automated.
    automationCandidate: false,
    relatedLinks: [{ label: 'Manager Intelligence', moduleId: 'managers', href: '/commissioner-os/managers' }],
  }
}

/**
 * Every candidate for one league. The reads are the same ones League Analytics already runs, so a
 * task can never disagree with the panel a commissioner would check to verify it.
 */
export async function detectLeagueTasks(leagueId: string, now = new Date()): Promise<WorkspaceTaskCandidate[]> {
  const window = await readActivityWindow(leagueId)

  /*
   * Three states of the feed, mutually exclusive by construction: never sent anything, sent
   * something and stopped, or current. Only one of the first two can fire, which is what keeps the
   * queue from reporting one problem twice under two names.
   */
  const neverImported = detectNeverImported(window.lastActivityAt, window.eventCount)
  const stale = neverImported ? null : detectStaleImport(window.lastActivityAt, window.eventCount, now)

  /*
   * The manager read is skipped entirely when the feed is stale or absent — not merely filtered
   * afterwards. It is the most expensive read here, and in both those states its answer is known in
   * advance and useless, so running it would spend the query to throw the result away.
   */
  const managers = stale || neverImported ? [] : await readManagerActivity(leagueId, MANAGER_INACTIVE_AFTER_DAYS)
  const inactive = detectInactiveManagers(managers, window.lastActivityAt, now)

  /*
   * Orphan seats are independent of the feed: a league can have current data and an empty seat, or
   * no data and an empty seat, and the vacancy is equally real either way. So this one is
   * deliberately not gated on the feed state above.
   */
  const roster = await readOrphanTeamCounts(leagueId)
  const orphans = detectOrphanTeams(roster.orphanCount, roster.totalTeams)

  return [neverImported, stale, inactive, orphans].filter((c): c is WorkspaceTaskCandidate => c !== null)
}
