/**
 * Survivor Guilly from the create-league wizard.
 *
 * The wizard asks for a sport and a manager count; the season schedule (`buildSGSchedule`) has to
 * finish with exactly three finalists, so the rules are FITTED to the count rather than asked for.
 * The commissioner tunes everything else afterwards on `/survivor-guillotine/setup`, which edits
 * the same saved config.
 *
 * Every chop period removes one team except a Gauntlet period, which removes two, so a season of
 * `active` elimination periods with `gauntlet` of them in the Gauntlet removes `active + gauntlet`
 * teams. A count is fitted by keeping every period live (no `off` weeks) and growing the Gauntlet
 * for a large league; a small league instead starts eliminating later, with its first periods off.
 */

import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { buildSGSchedule, defaultSGConfig } from './config'
import type { SGConfig, SGMode, SGSport } from './types'

/** The concept id the create wizard and `POST /api/leagues` use. */
const SG_CREATE_CONCEPT = 'survivor_guillotine'

export const SG_CREATE_SPORTS: readonly SGSport[] = ['NFL', 'NBA']
const SG_CREATE_MIN_TEAMS = 8
/** New leagues cap at 32 managers; NBA also at its 30 clubs (lib/create-league-v2/rules-engine.ts). */
const SG_CREATE_MAX_TEAMS: Record<SGSport, number> = { NFL: 32, NBA: 30 }
/** `defaultSGConfig` is a 22-team season: 10 tribal chops, a 3-period Gauntlet, 3 merged chops. */
export const SG_CREATE_DEFAULT_TEAMS = 22
export const SG_CREATE_TRIBE_COUNTS = [2, 3, 4] as const
const SG_CREATE_DEFAULT_TRIBES = 2

/** Merge lengths to try, closest to the default three first. */
const MERGE_PREFERENCE = [3, 2, 4, 1, 5, 6] as const

export function isSGCreateSport(sport: unknown): sport is SGSport {
  return sport === 'NFL' || sport === 'NBA'
}

/**
 * The default rules for `sport`, refitted to `teamCount` starting managers. `null` when no schedule
 * reaches three finalists — the caller refuses the count rather than saving a broken season.
 */
export function fitSGConfigForCreate(
  sport: SGSport,
  teamCount: number,
  tribeCount: number = SG_CREATE_DEFAULT_TRIBES,
): SGConfig | null {
  if (!isSGCreateSport(sport) || !Number.isInteger(teamCount) || !Number.isInteger(tribeCount)) return null
  const base = defaultSGConfig(sport)
  const slots = base.championshipPeriod - 1
  const chops = teamCount - 3
  for (let off = 0; off < slots; off++) {
    const active = slots - off
    const gauntletPeriods = chops - active
    if (gauntletPeriods < 0 || gauntletPeriods > 20) continue
    for (const mergedChopPeriods of MERGE_PREFERENCE) {
      if (mergedChopPeriods + gauntletPeriods > active) continue
      const periodOverrides: Record<number, SGMode> = {}
      for (let period = 1; period <= off; period++) periodOverrides[period] = 'off'
      const config: SGConfig = { ...base, teamCount, tribeCount, gauntletPeriods, mergedChopPeriods, periodOverrides }
      if (buildSGSchedule(config).errors.length === 0) return config
    }
  }
  return null
}

/** Starting manager counts the wizard offers and the create API accepts for `sport`. */
export function sgCreateTeamCounts(sport: SGSport): number[] {
  const counts: number[] = []
  for (let n = SG_CREATE_MIN_TEAMS; n <= SG_CREATE_MAX_TEAMS[sport]; n++) {
    if (fitSGConfigForCreate(sport, n)) counts.push(n)
  }
  return counts
}

function readSGCreateTribeCount(conceptSetup: Record<string, unknown> | null | undefined): number | null {
  const raw = conceptSetup?.survivorGuillotineTribeCount
  if (raw == null) return SG_CREATE_DEFAULT_TRIBES
  return (SG_CREATE_TRIBE_COUNTS as readonly unknown[]).includes(raw) ? (raw as number) : null
}

type SGCreateResolution =
  | { kind: 'not_sg' }
  | { kind: 'ok'; config: SGConfig }
  | { kind: 'invalid'; path: string; message: string }

/**
 * Decides, BEFORE any write, whether a create request is a Survivor Guilly league and what rules it
 * will be saved with. An invalid request is refused whole: the league row and its rules commit in
 * one transaction, so there is never a plain redraft league left behind without its rules.
 */
export function resolveSGCreateConfig(body: {
  concept: string
  sport: unknown
  teamCount: number
  conceptSetup?: Record<string, unknown> | null
}): SGCreateResolution {
  if (!normalizeConceptToFormat(body.concept)?.aliasTags.includes(SG_CREATE_CONCEPT)) return { kind: 'not_sg' }
  if (!isSGCreateSport(body.sport)) {
    return { kind: 'invalid', path: 'sport', message: 'Survivor Guilly runs on NFL or NBA.' }
  }
  const tribeCount = readSGCreateTribeCount(body.conceptSetup)
  if (tribeCount == null) {
    return { kind: 'invalid', path: 'conceptSetup.survivorGuillotineTribeCount', message: 'Choose 2, 3 or 4 tribes.' }
  }
  const config = body.teamCount <= SG_CREATE_MAX_TEAMS[body.sport] && body.teamCount >= SG_CREATE_MIN_TEAMS
    ? fitSGConfigForCreate(body.sport, body.teamCount, tribeCount)
    : null
  if (!config) {
    return {
      kind: 'invalid',
      path: 'teamCount',
      message: `Survivor Guilly needs ${SG_CREATE_MIN_TEAMS}–${SG_CREATE_MAX_TEAMS[body.sport]} managers for ${body.sport}.`,
    }
  }
  return { kind: 'ok', config }
}

export function sgSetupHref(leagueId: string): string {
  return `/survivor-guillotine/setup?leagueId=${encodeURIComponent(leagueId)}`
}
