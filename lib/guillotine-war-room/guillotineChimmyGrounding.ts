/**
 * GUILLOTINE WAR ROOM → CHIMMY grounding adapter.
 *
 * Mirrors the other War Room adapters: returns a deterministic, grounded guillotine WAR ROOM
 * context block (survival risk, standings, roster risk, FAAB, weekly plan) — or null when the
 * league is not a guillotine league. Reuses the Guillotine War Room context builder +
 * deterministic engines + grounded prompt; NO engine logic is duplicated.
 *
 * This is SEPARATE from the existing lightweight `buildGuillotineContextForChimmy`
 * (settings/survival summary). Both can fire for a guillotine league — this one adds the
 * deeper War Room intelligence (the dynasty pattern of two coexisting adapters).
 *
 * Safety: only fires for guillotine leagues (the context builder returns non-ok otherwise);
 * returns null otherwise so other formats are unaffected. Survival-first rules carried.
 */
import { buildGuillotineWarRoomContext } from './guillotineWarRoomContext'
import { evaluateUserSurvivalRisk } from './guillotineSurvivalRiskEngine'
import { evaluateRosterRisk } from './guillotineRosterRiskEngine'
import { buildFaabPlan } from './guillotineFaabEngine'
import { buildWeeklyPlan } from './guillotineWeeklyPlanEngine'
import { GUILLOTINE_WAR_ROOM_SYSTEM_RULES, buildGuillotineWarRoomPrompt } from './guillotineWarRoomPrompt'

export async function buildGuillotineWarRoomContextForChimmy(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null

  const result = await buildGuillotineWarRoomContext({ leagueId, userId })
  if (!result.ok) return null
  const context = result.context

  const rosterId = context.userRosterId
  const survival = rosterId ? evaluateUserSurvivalRisk(context) : null
  const rosterRisk = rosterId ? evaluateRosterRisk(context, rosterId) : null
  const faab = rosterId ? buildFaabPlan(context, rosterId) : null
  const weeklyPlan = rosterId ? buildWeeklyPlan(context, rosterId) : null

  const grounded = buildGuillotineWarRoomPrompt({ context, survival, rosterRisk, faab, weeklyPlan })

  return [
    '## GUILLY AF WAR ROOM CONTEXT (deterministic, league-specific)',
    'When answering for THIS league, follow these rules and cite the facts below:',
    GUILLOTINE_WAR_ROOM_SYSTEM_RULES,
    '',
    grounded,
  ].join('\n')
}
