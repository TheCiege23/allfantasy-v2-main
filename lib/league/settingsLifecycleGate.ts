/**
 * When a commissioner may change scoring or roster rules, for every editor that writes them:
 * the per-sport `*-scoring` PUTs, the generic `PUT .../scoring`, `roster-settings` (PUT,
 * reset-default, import apply) and the scoring/roster keys of the settings PATCH.
 *
 * 🛑 OWNER'S DECISION 2026-10-19: A MID-SEASON CHANGE IS ALLOWED WITH A WARNING, NOT BLOCKED.
 * The lifecycle matrix (`ACTIONS` in server/services/leagueLifecycleService.ts) refuses
 * `settings_edit_scoring` from the draft onward and `settings_edit_roster` in post_draft and
 * between seasons. For these editors that is superseded by `SETTINGS_EDIT_POLICY` below. The matrix
 * itself is unchanged, so the sectioned `PATCH /api/leagues/[id]/settings` with `section: 'scoring'`
 * or `'roster'` still follows it — that door is not covered here.
 *
 * Everything else the shared gate checks still applies, through `assertLeagueActionGate`:
 * signed in, a member, an elevated commissioner, not emergency-paused / locked (elevated roles pass
 * both, as before), and the season-tournament setup lock.
 */

import type { LeagueLifecycleState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { getLeagueLifecycleState, type LeagueLifecycleAction } from '@/server/services/leagueLifecycleService'
import { logAction } from '@/server/services/auditService'
import {
  MID_SEASON_CONFIRMATION_CODE,
  MID_SEASON_CONFIRMATION_MESSAGE,
  hasMidSeasonConfirmation,
} from '@/lib/league/midSeasonConfirmation'

export type LifecycleGatedSection = 'scoring' | 'roster'

/** `allowed`: no question asked. `confirm`: only with the explicit flag. `refused`: never. */
export type SettingsEditPolicy = 'allowed' | 'confirm' | 'refused'

export const SETTINGS_EDIT_POLICY: Record<LeagueLifecycleState, SettingsEditPolicy> = {
  setup: 'allowed',
  pre_draft: 'allowed',
  drafting: 'refused',
  post_draft: 'confirm',
  in_season: 'confirm',
  playoffs: 'confirm',
  completed: 'allowed',
  offseason: 'allowed',
  renewal_pending: 'allowed',
  archived: 'refused',
}

export type SettingsEditRefusalBody = { error: string; code: string; message?: string }

export type SettingsEditDecision =
  | { ok: true; state: LeagueLifecycleState; midSeason: boolean }
  | { ok: false; status: number; body: SettingsEditRefusalBody }

const ACTION: Record<LifecycleGatedSection, LeagueLifecycleAction> = {
  scoring: 'settings_edit_scoring',
  roster: 'settings_edit_roster',
}

export function lifecycleRefusalMessage(section: LifecycleGatedSection, state: LeagueLifecycleState): string {
  const what = section === 'scoring' ? 'Scoring' : 'Roster slots'
  if (state === 'drafting') return `${what} can't be changed while the draft is in progress. Try again once it finishes.`
  if (state === 'archived') return `${what} can't be changed on an archived league.`
  return `${what} can't be changed in the league's current phase. Contact support if a rule is wrong.`
}

/**
 * Decide one scoring or roster edit. `requestBody` is the parsed JSON body the confirmation flag
 * (`confirmMidSeasonChange: true`) is read from. A missing/defaulted `lifecycleState` reads as
 * `in_season` (getLeagueLifecycleState), so such a league needs the confirmation — by decision.
 */
export async function decideSettingsEdit(
  leagueId: string,
  userId: string,
  section: LifecycleGatedSection,
  requestBody: unknown,
): Promise<SettingsEditDecision> {
  // commissionerOverride: the phase rule is SETTINGS_EDIT_POLICY's, not the matrix's. It only takes
  // effect for an elevated commissioner, and the gate refuses anyone else before it gets there.
  const gate = await assertLeagueActionGate(leagueId, userId, ACTION[section], {
    lifecycle: { commissionerOverride: true },
  })
  if (!gate.ok) return { ok: false, status: gate.err.status, body: { error: gate.err.error, code: gate.err.code } }

  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { lifecycleState: true } })
  if (!row) return { ok: false, status: 404, body: { error: 'League not found', code: 'NOT_FOUND' } }
  const state = getLeagueLifecycleState(row)
  const policy = SETTINGS_EDIT_POLICY[state] ?? 'refused'

  if (policy === 'refused') {
    return { ok: false, status: 409, body: { error: lifecycleRefusalMessage(section, state), code: 'LIFECYCLE_BLOCKED' } }
  }
  if (policy === 'confirm' && !hasMidSeasonConfirmation(requestBody)) {
    return {
      ok: false,
      status: 409,
      body: {
        code: MID_SEASON_CONFIRMATION_CODE,
        message: MID_SEASON_CONFIRMATION_MESSAGE,
        error: MID_SEASON_CONFIRMATION_MESSAGE,
      },
    }
  }
  return { ok: true, state, midSeason: policy === 'confirm' }
}

/**
 * After a CONFIRMED mid-season change has been written: an audit row and a league announcement
 * through the same `settings_changed` fanout the settings PATCH already publishes. A no-op for any
 * other decision, so a route can call it unconditionally. Never throws — the change is already saved.
 */
export async function recordMidSeasonSettingsChange(
  decision: SettingsEditDecision,
  args: { leagueId: string; userId: string; section: LifecycleGatedSection; source: string; detail?: Record<string, unknown> },
): Promise<void> {
  if (!decision.ok || !decision.midSeason) return
  const { leagueId, userId, section, source, detail } = args
  const metadata = { section, lifecycleState: decision.state, source, confirmed: true, ...(detail ?? {}) }
  await logAction({
    leagueId,
    userId,
    actionType: 'settings_mid_season_change',
    entityType: 'league',
    entityId: leagueId,
    metadata,
  }).catch(() => {})

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId,
        eventType: 'settings_changed',
        title: section === 'scoring' ? 'Scoring rules changed mid-season' : 'Roster settings changed mid-season',
        message:
          section === 'scoring'
            ? 'The commissioner changed the scoring rules after the season started. Scores will be recalculated.'
            : 'The commissioner changed the roster settings after the season started. Check that your lineup is still valid.',
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: userId,
        meta: metadata,
      }),
    )
    .catch(() => {})
}

/**
 * Body keys of a settings PATCH that write scoring or roster rules. Deliberately the unambiguous
 * columns only: `sportConfig` and `settingsMerge` carry roster AND unrelated fields in one blob, so
 * gating them by key would interrupt a timezone change in week 5 — they are not covered here.
 */
const PATCH_KEYS_BY_SECTION: Record<LifecycleGatedSection, readonly string[]> = {
  scoring: ['scoring'],
  roster: ['rosterSize', 'irSlots', 'taxiSlots'],
}

export function lifecycleSectionsTouchedByPatch(body: Record<string, unknown>): LifecycleGatedSection[] {
  return (Object.keys(PATCH_KEYS_BY_SECTION) as LifecycleGatedSection[]).filter((section) =>
    PATCH_KEYS_BY_SECTION[section].some((key) => body[key] !== undefined),
  )
}
