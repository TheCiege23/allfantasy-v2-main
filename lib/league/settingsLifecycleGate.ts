/**
 * The league lifecycle matrix, applied to every editor that writes scoring or roster rules.
 *
 * 🛑 THIS INVENTS NO POLICY. Whether `settings_edit_scoring` / `settings_edit_roster` is allowed in a
 * phase is decided by `ACTIONS` in server/services/leagueLifecycleService.ts, through
 * `assertSettingsEditAllowed` — the same check `PATCH /api/leagues/[id]/settings` with a `section`
 * has always run. Before this, the per-sport scoring PUTs, the roster-settings PUT and the
 * section-less `PATCH /api/league/settings` never asked it, so the matrix only bound the one door
 * the settings UI does not use for these edits.
 *
 * What this adds is the RESPONSE: a lifecycle refusal is a 409 (the request is fine; the league's
 * phase conflicts with it) worded for a commissioner, instead of the internal
 * `Action "settings_edit_scoring" is not allowed in lifecycle state "in_season"`. Every other refusal
 * from the gate — 403 not a commissioner, 404, 423 locked/paused, 409 tournament setup — passes
 * through with its own status and message.
 */

import type { LeagueLifecycleState } from '@prisma/client'
import { assertSettingsEditAllowed } from '@/server/services/commissionerService'

export type LifecycleGatedSection = 'scoring' | 'roster'

export type SettingsLifecycleRefusal = { status: number; error: string; code?: string }

const DRAFT_STARTED: ReadonlySet<LeagueLifecycleState> = new Set([
  'drafting',
  'post_draft',
  'in_season',
  'playoffs',
  'completed',
])
const SEASON_OVER: ReadonlySet<LeagueLifecycleState> = new Set(['completed', 'offseason', 'renewal_pending'])

export function lifecycleRefusalMessage(section: LifecycleGatedSection, state: LeagueLifecycleState | undefined): string {
  if (section === 'scoring') {
    if (state === 'offseason' || state === 'renewal_pending') {
      return "Scoring can't be changed in the offseason. It opens again when the league is renewed for next season."
    }
    if (state === 'archived') return "Scoring can't be changed on an archived league."
    if (state && DRAFT_STARTED.has(state)) {
      return "Scoring can't be changed once the draft has started. Contact support if a rule is wrong."
    }
    return "Scoring can't be changed in the league's current phase. Contact support if a rule is wrong."
  }
  if (state === 'drafting') return "Roster slots can't be changed while the draft is in progress."
  if (state === 'post_draft') {
    return "Roster slots can't be changed once the draft has finished. Contact support if a slot is wrong."
  }
  if (state && SEASON_OVER.has(state)) {
    return "Roster slots can't be changed after the season has ended. They open again when the league is renewed for next season."
  }
  if (state === 'archived') return "Roster slots can't be changed on an archived league."
  return "Roster slots can't be changed in the league's current phase. Contact support if a slot is wrong."
}

const LIFECYCLE_CODES = new Set(['LIFECYCLE_BLOCKED', 'SCORING_LOCKED'])

/** `null` when the edit may proceed; otherwise the refusal to return. Unexpected errors rethrow. */
export async function settingsLifecycleRefusal(
  leagueId: string,
  userId: string,
  section: LifecycleGatedSection,
): Promise<SettingsLifecycleRefusal | null> {
  try {
    await assertSettingsEditAllowed(leagueId, userId, section)
    return null
  } catch (e) {
    const err = e as Error & { status?: number; code?: string; lifecycleState?: LeagueLifecycleState }
    if (typeof err.status !== 'number') throw e
    if (err.code && LIFECYCLE_CODES.has(err.code)) {
      return { status: 409, error: lifecycleRefusalMessage(section, err.lifecycleState), code: err.code }
    }
    return { status: err.status, error: err.message, ...(err.code ? { code: err.code } : {}) }
  }
}

/**
 * Body keys of a settings PATCH that write scoring or roster rules. Deliberately the unambiguous
 * columns only: `sportConfig` and `settingsMerge` carry roster AND unrelated fields in one blob, so
 * gating them by key would refuse a timezone change in week 5 — they are not covered here.
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
