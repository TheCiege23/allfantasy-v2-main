import 'server-only'

/**
 * The taxi move rules (./taxiMoveRules.ts) against the league's rows: the settings panel's read and
 * save, the check both lineup saves run, and the promotion log "once promoted cannot return" reads.
 *
 * WHERE IT APPLIES: native dynasty-family leagues whose commissioner switched enforcement on while
 * the league owner holds AF Commissioner (`ownerHasAfCommissionerPlan`). A lapsed plan stops the
 * enforcement; the rules stay stored. A commissioner override is never refused.
 *
 * THE PROMOTION LOG is a `RedraftRosterMoveHistory` row per save that promoted anyone, with
 * `moveSummary = 'taxi_promotion'` and the player ids in `metadata.playerIds`: an existing table, so
 * no migration. It is read by the team's owner across seasons, because a dynasty team is a new
 * `RedraftRoster` row each season and "cannot return" outlives the season it happened in.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getEffectiveTaxiSettings } from './TaxiSettingsService'
import { upsertDynastyConfig } from '@/lib/dynasty-core/DynastySettingsService'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import {
  diffTaxiSquad,
  normalizeTaxiLockBehavior,
  readTaxiRulesEnforced,
  taxiMoveIssues,
  taxiSeasonPhase,
  TAXI_RULES_ENFORCED_KEY,
  type TaxiMoveIssue,
  type TaxiMoveRules,
  type TaxiSeasonPhase,
} from './taxiMoveRules'

export const TAXI_PROMOTION_MOVE_SUMMARY = 'taxi_promotion'
const MAX_WEEK = 30

type LeagueRow = { userId: string; platform: string | null; leagueType: string | null; isDynasty: boolean; settings: unknown }

async function loadLeague(leagueId: string): Promise<LeagueRow | null> {
  return prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, platform: true, leagueType: true, isDynasty: true, settings: true },
  })
}

const applies = (league: LeagueRow) => resolveWriteAuthority(league.platform) === 'NATIVE' && isDynastyFamilyLeague(league)

async function loadRules(leagueId: string): Promise<TaxiMoveRules | null> {
  const taxi = await getEffectiveTaxiSettings(leagueId)
  if (!taxi) return null
  return {
    lockAfterWeek: taxi.taxiDeadlineWeek ?? null,
    promotionDeadlineWeek: taxi.taxiPromotionDeadlineWeek ?? null,
    lockBehavior: normalizeTaxiLockBehavior(taxi.taxiLockBehavior),
    inSeasonMoves: taxi.taxiInSeasonMoves,
    postseasonMoves: taxi.taxiPostseasonMoves,
  }
}

async function currentSeason(leagueId: string) {
  return prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true, status: true, currentWeek: true, playoffStartWeek: true },
  })
}

export type TaxiRulesView = {
  applies: true
  rules: TaxiMoveRules
  enforced: boolean
  /** The owner holds AF Commissioner, so a switched-on rule is actually enforced. */
  ownerEntitled: boolean
  /** The viewer may change the rules (a commissioner with AF Commissioner). */
  canEdit: boolean
  isCommissioner: boolean
  phase: TaxiSeasonPhase
  week: number
}

export async function readTaxiRulesView(
  leagueId: string,
  viewer: { userId: string; isCommissioner: boolean },
): Promise<TaxiRulesView | { applies: false } | null> {
  const league = await loadLeague(leagueId)
  if (!league) return null
  if (!applies(league)) return { applies: false }
  const [rules, season, ownerEntitled, viewerEntitled] = await Promise.all([
    loadRules(leagueId),
    currentSeason(leagueId),
    ownerHasAfCommissionerPlan(league.userId),
    viewer.isCommissioner
      ? prisma.appUser.findUnique({ where: { id: viewer.userId }, select: { id: true, email: true, username: true } }).then(hasAfCommissionerPlan)
      : Promise.resolve(false),
  ])
  if (!rules) return { applies: false }
  const week = Math.max(1, season?.currentWeek ?? 1)
  return {
    applies: true,
    rules,
    enforced: readTaxiRulesEnforced(league.settings),
    ownerEntitled,
    canEdit: viewer.isCommissioner && viewerEntitled,
    isCommissioner: viewer.isCommissioner,
    phase: taxiSeasonPhase(season, week),
    week,
  }
}

/** The rules a save in this league is held to, or null when nothing is enforced. */
export async function loadTaxiEnforcement(leagueId: string): Promise<{ rules: TaxiMoveRules; season: NonNullable<Awaited<ReturnType<typeof currentSeason>>> | null } | null> {
  const league = await loadLeague(leagueId)
  if (!league || !applies(league) || !readTaxiRulesEnforced(league.settings)) return null
  if (!(await ownerHasAfCommissionerPlan(league.userId))) return null
  const [rules, season] = await Promise.all([loadRules(leagueId), currentSeason(leagueId)])
  return rules ? { rules, season } : null
}

/** Players this owner has promoted off a taxi squad in this league, in any season. */
export async function readPromotedPlayers(leagueId: string, ownerId: string): Promise<Set<string>> {
  const rows = await prisma.redraftRosterMoveHistory.findMany({
    where: { leagueId, moveSummary: TAXI_PROMOTION_MOVE_SUMMARY, roster: { ownerId } },
    select: { metadata: true },
  })
  const ids = new Set<string>()
  for (const r of rows) {
    const list = (r.metadata as { playerIds?: unknown } | null)?.playerIds
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') ids.add(id)
  }
  return ids
}

export type TaxiSaveCheck = {
  issues: TaxiMoveIssue[]
  /** Promotions to log once the save lands; empty when nothing is enforced. */
  promotions: string[]
  seasonId: string | null
  season: number | null
}

const NONE: TaxiSaveCheck = { issues: [], promotions: [], seasonId: null, season: null }

/**
 * The check both lineup saves run (lib/roster-lineup-engine/lineupService.ts and PATCH
 * /api/redraft/roster). `week` is the week the save is for.
 */
export async function checkTaxiSave(input: {
  leagueId: string
  redraftRosterId: string
  week: number
  beforeTaxi: readonly string[]
  afterTaxi: readonly string[]
  afterRoster: readonly string[]
  nameOf: (playerId: string) => string
}): Promise<TaxiSaveCheck> {
  const { arrivals, promotions } = diffTaxiSquad(input)
  if (arrivals.length === 0 && promotions.length === 0) return NONE
  const enforcement = await loadTaxiEnforcement(input.leagueId)
  if (!enforcement) return NONE
  const owner = await prisma.redraftRoster.findUnique({ where: { id: input.redraftRosterId }, select: { ownerId: true } })
  const promotedBefore =
    arrivals.length && enforcement.rules.lockBehavior === 'once_promoted_no_return' && owner
      ? await readPromotedPlayers(input.leagueId, owner.ownerId)
      : new Set<string>()
  const issues = taxiMoveIssues({
    rules: enforcement.rules,
    phase: taxiSeasonPhase(enforcement.season, input.week),
    week: input.week,
    arrivals,
    promotions,
    promotedBefore,
    nameOf: input.nameOf,
  })
  return { issues, promotions, seasonId: enforcement.season?.id ?? null, season: enforcement.season?.season ?? null }
}

/** Inside the save's transaction, after it lands. */
export async function logTaxiPromotions(
  tx: Prisma.TransactionClient,
  input: { leagueId: string; redraftRosterId: string; week: number; actorUserId: string | null; check: TaxiSaveCheck },
): Promise<void> {
  if (!input.check.promotions.length || !input.check.seasonId || input.check.season == null) return
  await tx.redraftRosterMoveHistory.create({
    data: {
      leagueId: input.leagueId,
      rosterId: input.redraftRosterId,
      seasonId: input.check.seasonId,
      season: input.check.season,
      week: input.week,
      actorUserId: input.actorUserId,
      source: 'user',
      moveSummary: TAXI_PROMOTION_MOVE_SUMMARY,
      metadata: { playerIds: input.check.promotions } as Prisma.InputJsonValue,
    },
  })
}

export type TaxiRulesSaveBody = {
  enforced?: unknown
  lockAfterWeek?: unknown
  promotionDeadlineWeek?: unknown
  lockBehavior?: unknown
  inSeasonMoves?: unknown
  postseasonMoves?: unknown
}

const weekOrNull = (v: unknown): number | null | undefined | 'bad' => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= MAX_WEEK ? n : 'bad'
}

/** AF Commissioner, commissioner only (the caller checks the role). */
export async function saveTaxiRules(
  leagueId: string,
  userId: string,
  body: TaxiRulesSaveBody,
): Promise<{ ok: true } | { ok: false; status: 400 | 402 | 404; error: string }> {
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (!applies(league)) return { ok: false, status: 400, error: 'Taxi rules apply to dynasty leagues that play on AllFantasy.' }
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } })
  if (!hasAfCommissionerPlan(user)) return { ok: false, status: 402, error: 'Taxi rules are part of AF Commissioner.' }

  const lockAfterWeek = weekOrNull(body.lockAfterWeek)
  const promotionDeadlineWeek = weekOrNull(body.promotionDeadlineWeek)
  if (lockAfterWeek === 'bad' || promotionDeadlineWeek === 'bad') {
    return { ok: false, status: 400, error: `A week is a whole number from 1 to ${MAX_WEEK}, or blank for none.` }
  }
  if (body.lockBehavior !== undefined && !['once_promoted_no_return', 'free_move'].includes(String(body.lockBehavior))) {
    return { ok: false, status: 400, error: 'Unknown promotion rule.' }
  }
  for (const k of ['enforced', 'inSeasonMoves', 'postseasonMoves'] as const) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') return { ok: false, status: 400, error: `${k} must be true or false.` }
  }

  const payload: Parameters<typeof upsertDynastyConfig>[1] = {}
  if (lockAfterWeek !== undefined) payload.taxiDeadlineWeek = lockAfterWeek
  if (promotionDeadlineWeek !== undefined) payload.taxiPromotionDeadlineWeek = promotionDeadlineWeek
  if (body.lockBehavior !== undefined) payload.taxiLockBehavior = String(body.lockBehavior)
  if (typeof body.inSeasonMoves === 'boolean') payload.taxiInSeasonMoves = body.inSeasonMoves
  if (typeof body.postseasonMoves === 'boolean') payload.taxiPostseasonMoves = body.postseasonMoves
  if (Object.keys(payload).length) await upsertDynastyConfig(leagueId, payload)

  if (typeof body.enforced === 'boolean' && body.enforced !== readTaxiRulesEnforced(league.settings)) {
    // Through the settings patch, so the settings lock and audit apply.
    const res = await executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [TAXI_RULES_ENFORCED_KEY]: body.enforced } })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, status: 400, error: data.error || 'The switch could not be saved.' }
    }
  }
  return { ok: true }
}
