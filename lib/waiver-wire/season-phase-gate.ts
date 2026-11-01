/**
 * Loads the inputs of the season-phase waiver policy (lib/waiver-wire/season-phase-policy.ts) and
 * answers it for one team or for a whole waiver run. Used by the add/drop route, `createClaim`, the
 * processor and the settings GET.
 *
 * If the phase or draft cannot be read, roster moves stay locked until the policy is available.
 */
import { prisma } from '@/lib/prisma'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { parseWaiverEngineConfig } from './waiver-engine-config'
import {
  readOffseasonWaiverRule,
  readPlayoffWaiverRule,
  type OffseasonWaiverRule,
  type PlayoffWaiverRule,
} from './hub-waiver-options'
import {
  resolveWaiverPhasePolicy,
  resolveWaiverSeasonPhase,
  type WaiverPhasePolicy,
  type WaiverSeasonPhase,
} from './season-phase-policy'

export type WaiverPhaseContext = {
  phase: WaiverSeasonPhase
  offseasonRule: OffseasonWaiverRule
  playoffRule: PlayoffWaiverRule
  dynastyFamily: boolean
  /** The latest native season, for the title-bracket read. */
  seasonId: string | null
}

const REGULAR: WaiverPhaseContext = {
  phase: 'regular',
  offseasonRule: 'closed',
  playoffRule: 'all_teams',
  dynastyFamily: false,
  seasonId: null,
}

export async function loadWaiverPhaseContext(leagueId: string): Promise<WaiverPhaseContext> {
  try {
    const [league, row, latest, completed] = await Promise.all([
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { lifecycleState: true, status: true, leagueType: true, isDynasty: true },
      }),
      prisma.leagueWaiverSettings.findUnique({ where: { leagueId }, select: { waiverEngineConfig: true } }),
      prisma.redraftSeason.findFirst({
        where: { leagueId },
        orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, status: true },
      }),
      prisma.redraftSeason.count({ where: { leagueId, status: 'complete' } }),
    ])
    if (!league) return REGULAR
    const beforeDraft = ['setup', 'pre_draft', 'draft', 'drafting', 'in_progress'].includes(String(league.lifecycleState || league.status || 'setup').toLowerCase())
    const draft = beforeDraft ? await prisma.draftSession.findFirst({ where: { leagueId, sessionKind: 'live' }, orderBy: { createdAt: 'desc' }, select: { status: true } }) : null
    const config = parseWaiverEngineConfig(row?.waiverEngineConfig ?? null)
    return {
      phase: beforeDraft && draft?.status !== 'completed' ? 'pre_draft' : resolveWaiverSeasonPhase({
        lifecycleState: league.lifecycleState,
        latestSeasonStatus: latest?.status ?? null,
        hasCompletedSeason: Number(completed) > 0,
      }),
      offseasonRule: readOffseasonWaiverRule(config.offseason_waiver_rules),
      playoffRule: readPlayoffWaiverRule(config.playoff_waiver_rules),
      dynastyFamily: isDynastyFamilyLeague(league),
      seasonId: latest?.id ?? null,
    }
  } catch {
    return { ...REGULAR, phase: 'pre_draft' }
  }
}

/**
 * Generic `Roster.id`s whose team is out of the title bracket this season. `RedraftRoster.isEliminated`
 * is the bracket's own record: bracket generation sets it for every team that missed the playoffs and
 * each round's advance for its losers (resolveNflRedraftPlayoffRuntime.ts). A roster is matched by
 * `redraftRosterId`, else `platformUserId === ownerId`, the pairing the weekly reset uses.
 */
export async function loadTitleBracketEliminatedRosterIds(leagueId: string, seasonId: string): Promise<Set<string>> {
  const [redraft, rosters] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { seasonId, leagueId }, select: { id: true, ownerId: true, isEliminated: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
  ])
  const byId = new Map(redraft.map((r) => [r.id, r]))
  const byOwner = new Map(redraft.map((r) => [r.ownerId, r]))
  const out = new Set<string>()
  for (const r of rosters) {
    const match = (r.redraftRosterId ? byId.get(r.redraftRosterId) : undefined) ?? byOwner.get(r.platformUserId)
    if (match?.isEliminated) out.add(r.id)
  }
  return out
}

/** The policy for one team (`rosterId`), or the league-wide one when there is no team (null). */
export async function loadWaiverPhasePolicy(leagueId: string, rosterId: string | null): Promise<WaiverPhasePolicy> {
  const ctx = await loadWaiverPhaseContext(leagueId)
  let eliminated: boolean | null = null
  if (rosterId && ctx.phase === 'playoffs' && ctx.playoffRule === 'alive_only' && ctx.seasonId) {
    eliminated = await loadTitleBracketEliminatedRosterIds(leagueId, ctx.seasonId)
      .then((ids) => ids.has(rosterId))
      .catch(() => null)
  }
  return resolveWaiverPhasePolicy({ ...ctx, eliminated })
}

/**
 * For a waiver run: the phase refusal for each claiming team, or null when its claim may run.
 * The eliminated set is read once per run, only when the alive-only rule is in force.
 */
export async function loadWaiverRunPhaseGate(leagueId: string): Promise<(rosterId: string) => string | null> {
  const ctx = await loadWaiverPhaseContext(leagueId)
  let eliminated: Set<string> | null = null
  if (ctx.phase === 'playoffs' && ctx.playoffRule === 'alive_only' && ctx.seasonId) {
    eliminated = await loadTitleBracketEliminatedRosterIds(leagueId, ctx.seasonId).catch(() => null)
  }
  return (rosterId: string) => {
    const policy = resolveWaiverPhasePolicy({ ...ctx, eliminated: eliminated ? eliminated.has(rosterId) : null })
    return policy.claimsAllowed ? null : policy.reason
  }
}
