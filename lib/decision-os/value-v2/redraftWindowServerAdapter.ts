import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { deriveAvailabilityCategory } from '@/lib/decision-os/world/injuryEnrichedWorld'
import { resolveWindowDecision, unresolvableWindowDecision, type WindowDecision } from './windowDecision'
import { createWindowFactsPrismaPort } from './windowFactsPrismaPort'

/**
 * Resolve the REQUESTING team's competitive window for a redraft trade preview.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────────────────────────
 * `resolveWindowDecision` is pure and takes a scope; `windowFactsPrismaPort` is the database
 * seam. Neither knows how a redraft request identifies a team, and neither should. This adapter
 * is the one place that answers that question, for one endpoint, and it is READ-ONLY: it writes
 * nothing and calls no provider.
 *
 * ── 🛑 THE IDENTITY PROBLEM, WHICH IS THE WHOLE JOB ───────────────────────────────────────────
 * The caller arrives holding a `RedraftRoster.id`. The port wants `LeagueTeam.externalId`. Those
 * are DIFFERENT ID SPACES and this repo has already been burned by treating them as one, so the
 * mapping is made explicitly here or it is refused. Measured facts that constrain it:
 *
 *   `Roster.redraftRosterId`                              2,721 of 3,222 (84.5%)   partial
 *   `LeagueTeam.legacyRosterId`                           0 of 174 populated       UNUSABLE
 *   `LeagueTeam.claimedByUserId -> platformUserId -> Roster`  0 of 13              UNUSABLE
 *   `LeagueTeam.claimedByUserId === <AF user id>`         the gate `lib/league-access.ts` uses
 *
 * (the first three are recorded in `prisma/schema.prisma` and `lib/league/resolveUserRoster.ts`,
 * each measured against production before being written down.)
 *
 * So the only route with a measured basis is the LAST one, and it is the one used: the team is
 * whichever `LeagueTeam` in THIS league the authenticated caller has claimed. That is sound here
 * only because the route has ALREADY proved `proposer.ownerId === session.user.id` — the claim
 * and the proposer roster are then two independent statements about the same authenticated
 * person, and requiring both is stricter than either.
 *
 * ⚠ EXACTLY ONE, OR REFUSE. Zero claimed teams is `window_team_not_claimed`; more than one is
 * `window_team_ambiguous` and is NOT resolved by taking the first. Picking a row from a
 * multi-row result is how a window gets attributed to a team the caller does not own, and the
 * output of that is a trade recommendation weighted for somebody else's roster.
 *
 * ⚠ NEVER INFER THE TEAM FROM ASSET ORDER. The assets arrive from the client and say which
 * roster each side is moving from; none of that is authenticated. The proposer roster is, and it
 * is the only input this adapter will accept as identity.
 *
 * ── THE OTHER NAMESPACE TRAP ──────────────────────────────────────────────────────────────────
 * ⚠ `WeeklyMatchup.leagueId` HOLDS THE PLATFORM LEAGUE ID, NOT `League.id`. The port takes it as
 * a separate required dep for exactly that reason, and passing the AllFantasy uuid there returns
 * zero rows — a team that looks like it has never played, rather than an error. `scope.leagueId`
 * stays the AllFantasy uuid (it keys `LeagueTeam`, `SeasonForecastSnapshot` and
 * `DynastyProjectionSnapshot`); `platformLeagueId` is read from `League` and passed separately.
 * A league with no platform id resolves to null and the all-play read refuses on its own.
 *
 * ── WHAT A FAILURE LOOKS LIKE ─────────────────────────────────────────────────────────────────
 * Every identity failure returns a REFUSED `WindowDecision` naming the step that failed, not
 * `null` and never a fabricated window. `teamFitFor(null)` is neutral, so a refusal cannot move
 * a single price or grade — it only records why there is no window.
 */

export const WINDOW_GAP_LEAGUE_MISSING = 'window_league_not_found'
export const WINDOW_GAP_TEAM_NOT_CLAIMED = 'window_team_not_claimed'
export const WINDOW_GAP_TEAM_AMBIGUOUS = 'window_team_ambiguous'
export const WINDOW_GAP_TEAM_ARCHIVED = 'window_team_archived'
export const WINDOW_GAP_TEAM_ID_MISSING = 'window_team_external_id_missing'
export const WINDOW_GAP_PERIOD_UNRESOLVED = 'window_scheduled_period_unresolved'
export const WINDOW_GAP_ADAPTER_FAILED = 'window_adapter_read_failed'

export interface RedraftWindowRequest {
  prisma: PrismaClient
  /** AllFantasy `League.id`, already proved to contain the caller by the route's membership gate. */
  leagueId: string
  /** The authenticated caller. The route has already proved they own `proposerRosterId`. */
  userId: string
  /** `RedraftRoster.id`, already proved to belong to this league and season AND to this caller. */
  proposerRosterId: string
  sport: string
  season: number
  /** The league's current scoring period. */
  week: number
  /** Ascending scheduled periods for this season, so the lookback walks real predecessors. */
  scheduledPeriods?: readonly number[]
  now?: Date
}

/**
 * Availability for the F2.3 injury read.
 *
 * ⚠ FILTERED BY SPORT, BECAUSE `SportsPlayer.externalId` IS NOT GLOBALLY UNIQUE — the model's own
 * key is `@@unique([sport, externalId, source])`. An unfiltered `externalId` lookup can pull a
 * different sport's player and report them injured.
 *
 * ⚠ AND `source` MEANS ONE PLAYER CAN HAVE SEVERAL ROWS THAT DISAGREE. Where they do, this
 * returns 'unknown' rather than picking a winner: the port counts 'unknown' as unresolved and
 * refuses below 50% coverage, which is the correct outcome for evidence that contradicts itself.
 * Choosing the worst status would quietly bias every league toward 'rebuilding'.
 */
function availabilityLoader(prisma: PrismaClient) {
  return async (sport: string, ids: string[]): Promise<Map<string, string>> => {
    const out = new Map<string, string>()
    if (ids.length === 0) return out
    const rows = await prisma.sportsPlayer
      .findMany({ where: { sport, externalId: { in: ids } }, select: { externalId: true, status: true } })
      .catch(() => [] as Array<{ externalId: string; status: string | null }>)

    const seen = new Map<string, string>()
    for (const row of rows) {
      const category = deriveAvailabilityCategory(row.status)
      const prior = seen.get(row.externalId)
      if (prior === undefined) seen.set(row.externalId, category)
      else if (prior !== category) seen.set(row.externalId, 'unknown')
    }
    for (const [id, category] of seen) out.set(id, category)
    return out
  }
}

/**
 * The canonical team for this request, or a named reason there is not one.
 *
 * Split out so the identity decision is testable on its own, without a window, a schedule or an
 * injury feed — the identity rules are the part that must not drift.
 */
export async function resolveRequestingTeam(
  prisma: PrismaClient,
  leagueId: string,
  userId: string,
): Promise<{ ok: true; externalId: string } | { ok: false; gap: string }> {
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId, claimedByUserId: userId },
      select: { externalId: true, isOrphan: true },
      // Two is enough to prove ambiguity; there is no reason to read a whole league.
      take: 2,
    })
    .catch(() => null)

  if (teams === null) return { ok: false, gap: WINDOW_GAP_ADAPTER_FAILED }
  if (teams.length === 0) return { ok: false, gap: WINDOW_GAP_TEAM_NOT_CLAIMED }
  if (teams.length > 1) return { ok: false, gap: WINDOW_GAP_TEAM_AMBIGUOUS }

  const team = teams[0]
  /*
   * An orphaned team is a row whose manager is gone. Its matchups still exist, so a window WOULD
   * resolve — and it would describe a team nobody is managing. Refusing is the honest answer.
   */
  if (team.isOrphan) return { ok: false, gap: WINDOW_GAP_TEAM_ARCHIVED }
  const externalId = typeof team.externalId === 'string' ? team.externalId.trim() : ''
  if (!externalId) return { ok: false, gap: WINDOW_GAP_TEAM_ID_MISSING }
  return { ok: true, externalId }
}

export async function resolveRedraftTeamWindow(req: RedraftWindowRequest): Promise<WindowDecision> {
  const { prisma, leagueId, userId, sport, season, week } = req
  const now = req.now ?? new Date()
  /*
   * The scope echoed on a refusal. `teamId` is deliberately ABSENT until identity resolves, so it
   * echoes back as null: the proposer roster id belongs to a DIFFERENT namespace, and putting it
   * here would be the exact conflation this adapter exists to prevent. An operator reading
   * `teamId: null` beside `window_team_ambiguous` learns the truth — no canonical team was
   * established — where a roster id would have implied one was.
   */
  const partialScope = { leagueId, season, week }
  const refuse = (gap: string) => unresolvableWindowDecision(partialScope, [gap], { now })

  try {
    if (!Number.isSafeInteger(week) || week < 1) return refuse(WINDOW_GAP_PERIOD_UNRESOLVED)

    const league = await prisma.league
      .findUnique({ where: { id: leagueId }, select: { platformLeagueId: true } })
      .catch(() => null)
    if (!league) return refuse(WINDOW_GAP_LEAGUE_MISSING)

    const team = await resolveRequestingTeam(prisma, leagueId, userId)
    if (!team.ok) return refuse(team.gap)

    /*
     * The proposer's own players, for the injury read. Read through the redraft roster the route
     * already validated, so the roster whose availability is measured is the roster the caller
     * proved they own.
     */
    const rosterPlayerIds = await loadRosterPlayerIds(prisma, req.proposerRosterId)

    const port = createWindowFactsPrismaPort({
      prisma,
      platformLeagueId: league.platformLeagueId ?? null,
      sport,
      rosterPlayerIds,
      loadAvailability: availabilityLoader(prisma),
    })

    return await resolveWindowDecision(
      { leagueId, teamId: team.externalId, season, week },
      port,
      { now, ...(req.scheduledPeriods?.length ? { scheduledPeriods: req.scheduledPeriods } : {}) },
    )
  } catch {
    /*
     * ⚠ A FAILED WINDOW READ MUST NOT BECOME A NEUTRAL WINDOW SILENTLY. Refusing names the
     * failure in the shadow's gaps; swallowing it would report "no window" for a database error
     * and look identical to a league that genuinely has no evidence.
     */
    return refuse(WINDOW_GAP_ADAPTER_FAILED)
  }
}

/** Canonical player ids on the proposer's redraft roster. Empty is valid — the port refuses on coverage. */
async function loadRosterPlayerIds(prisma: PrismaClient, redraftRosterId: string): Promise<string[]> {
  const rows = await prisma.redraftRosterPlayer
    .findMany({ where: { rosterId: redraftRosterId }, select: { playerId: true } })
    .catch(() => [] as Array<{ playerId: string | null }>)
  const ids = new Set<string>()
  for (const row of rows) {
    const id = typeof row.playerId === 'string' ? row.playerId.trim() : ''
    if (id) ids.add(id)
  }
  return [...ids]
}
