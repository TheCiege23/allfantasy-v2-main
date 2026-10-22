import 'server-only'

import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import { DEFAULT_END_WEEK_BY_SPORT, getGuillotineConfig, upsertGuillotineConfig } from './GuillotineLeagueConfig'
import { resolveGuillotineEndgame } from './endgameRules'
import { hasFirstChopHappened } from './guillotineFirstChopWeek'
import {
  normalizeGuillotineRulesPatch,
  paidFieldsChanged,
  RULE_DEFAULTS,
  type GuillotineRuleField,
  type GuillotineRules,
  type RulesPatchError,
} from './guillotineRules'

/**
 * Read and save the "League rules" page (rules and tiers in ./guillotineRules.ts).
 *
 * Where each value lives, and why it is written there:
 *  - GuillotineLeagueConfig row: teams per chop, last chop week, tiebreakers, stat-correction wait,
 *    danger margin, release timing. When no row exists yet, `getGuillotineConfig` DERIVES one from
 *    League.settings, so the first save writes the whole derived config (as the first-chop editor
 *    does) — a bare upsert would create the row with schema defaults for everything else.
 *  - Endgame: `resolveGuillotineEndgame` reads `settings.guillotineEndgame` FIRST, ahead of the
 *    creation-time copies and the column, so that is the key written; the column and threshold are
 *    kept in step for the readers that use them (guillotineChopAudit reads the threshold).
 */

const ENDGAME_THRESHOLD = { last_team_standing: 1, final_two: 2, final_three: 3, final_four: 4 } as const

export type GuillotineRulesView = {
  rules: GuillotineRules
  startWeek: number
  seasonWeeks: number
  /** The first chop has happened: the endgame is fixed for the season. */
  endgameLocked: boolean
  /** The viewer can change the AF Commissioner fields — the same check the save enforces. */
  canEditPaid: boolean
}

export async function viewerCanEditPaidGuillotineRules(userId: string): Promise<boolean> {
  const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
  return Boolean(access?.allowed)
}

export async function readGuillotineRules(leagueId: string, userId: string): Promise<GuillotineRulesView | null> {
  const [config, league] = await Promise.all([
    getGuillotineConfig(leagueId),
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true, guillotineEndgame: true } }),
  ])
  if (!config || !league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport
  const seasonWeeks = DEFAULT_END_WEEK_BY_SPORT[sport] ?? 18
  const [endgameLocked, canEditPaid] = await Promise.all([
    hasFirstChopHappened(leagueId).catch(() => false),
    viewerCanEditPaidGuillotineRules(userId),
  ])
  return {
    rules: {
      teamsPerChop: config.teamsPerChop,
      eliminationEndWeek: config.eliminationEndWeek ?? seasonWeeks,
      endgame: resolveGuillotineEndgame(league).format,
      tiebreakerOrder: config.tiebreakerOrder,
      statCorrectionHours: config.statCorrectionHours ?? RULE_DEFAULTS.statCorrectionHours,
      dangerMarginPoints: config.dangerMarginPoints ?? RULE_DEFAULTS.dangerMarginPoints,
      // `custom_time` has no editor yet; show it as the default rather than an option nobody can pick.
      rosterReleaseTiming: config.rosterReleaseTiming === 'immediate' ? 'immediate' : 'next_waiver_run',
    },
    startWeek: config.eliminationStartWeek,
    seasonWeeks,
    endgameLocked,
    canEditPaid,
  }
}

export type SaveRulesResult =
  | { ok: true; view: GuillotineRulesView }
  | { ok: false; status: 400 | 402 | 404 | 409; error: string; field?: GuillotineRuleField | null; fields?: GuillotineRuleField[] }

export async function saveGuillotineRules(leagueId: string, userId: string, raw: unknown): Promise<SaveRulesResult> {
  const current = await readGuillotineRules(leagueId, userId)
  if (!current) return { ok: false, status: 404, error: 'Not a guillotine league' }

  const n = normalizeGuillotineRulesPatch(raw, { startWeek: current.startWeek, seasonWeeks: current.seasonWeeks })
  if (!n.ok) return { ok: false, status: 400, error: n.error.message, field: n.error.field }
  const patch = n.value

  const paid = paidFieldsChanged(patch, current.rules)
  if (paid.length > 0 && !current.canEditPaid) {
    return { ok: false, status: 402, error: 'These rules are part of AF Commissioner.', fields: paid }
  }
  if (patch.endgame !== undefined && patch.endgame !== current.rules.endgame && current.endgameLocked) {
    return {
      ok: false,
      status: 409,
      error: 'The first chop has happened, so how the season ends is fixed for this season.',
      field: 'endgame',
    }
  }

  const { endgame, ...configPatch } = patch
  if (Object.keys(configPatch).length > 0) {
    const row = await prisma.guillotineLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
    if (row) {
      await upsertGuillotineConfig(leagueId, configPatch)
    } else {
      const derived = await getGuillotineConfig(leagueId)
      if (!derived) return { ok: false, status: 404, error: 'Not a guillotine league' }
      await upsertGuillotineConfig(leagueId, {
        eliminationStartWeek: derived.eliminationStartWeek,
        eliminationEndWeek: derived.eliminationEndWeek,
        teamsPerChop: derived.teamsPerChop,
        correctionWindow: derived.correctionWindow,
        customCutoffDayOfWeek: derived.customCutoffDayOfWeek,
        customCutoffTimeUtc: derived.customCutoffTimeUtc,
        statCorrectionHours: derived.statCorrectionHours,
        tiebreakerOrder: derived.tiebreakerOrder,
        dangerMarginPoints: derived.dangerMarginPoints,
        rosterReleaseTiming: derived.rosterReleaseTiming,
        commissionerOverride: derived.commissionerOverride,
        ...configPatch,
      })
    }
  }

  if (endgame !== undefined && endgame !== current.rules.endgame) {
    // League.settings is shared by every settings writer: take the row lock (as chop rules do).
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
      const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      const settings = { ...((row?.settings as Record<string, unknown> | null) ?? {}), guillotineEndgame: endgame }
      await tx.league.update({
        where: { id: leagueId },
        data: { settings: settings as object, guillotineEndgame: endgame, guillotineEndgameThreshold: ENDGAME_THRESHOLD[endgame] },
      })
    })
  }

  const view = await readGuillotineRules(leagueId, userId)
  return view ? { ok: true, view } : { ok: false, status: 404, error: 'Not a guillotine league' }
}
