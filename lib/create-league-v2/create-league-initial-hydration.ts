/**
 * Single-shot client initial state for Create League v2.
 * Merges sessionStorage, URL `mode`, casual-redraft quick seed, and scoring preset resolution
 * so the first paint never shows an empty Quick league type.
 *
 * After merge, `sanitizeReconciledCreateLeagueState` repairs stale sessionStorage payloads
 * (unknown league types, bad sports, invalid team counts, broken draft timestamps).
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { CreateLeagueV2State, SupportedSport } from '@/lib/create-league-v2/state'
import {
  DEFAULT_V2_STATE,
  getDefaultBestBallSetup,
  getDefaultKeeperSetup,
  getEffectiveLeagueType,
  hydrateFootballScoringFields,
  isDynastyConcept,
} from '@/lib/create-league-v2/state'
import { getDefaultTeamCount, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { resolveScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import { buildSuggestedLeagueName } from '@/lib/create-league-v2/suggested-league-name'
import { getQuickTemplatePatch } from '@/lib/create-league-v2/quick-defaults'
import { isLeagueCreationTemplateId } from '@/lib/create-league-v2/templates/catalog'
import { normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'

const VALID_LEAGUE_TYPES = new Set<LeagueTypeId>([
  'redraft',
  'dynasty',
  'keeper',
  'best_ball',
  'guillotine',
  'survivor',
  'tournament',
  'devy',
  'c2c',
  'zombie',
  'salary_cap',
  'big_brother',
])

function isValidIsoOrEmpty(iso: string): boolean {
  if (!iso?.trim()) return true
  const t = Date.parse(iso)
  return !Number.isNaN(t)
}

/**
 * Repairs known-bad shapes from persisted JSON before / after quick seed + scoring finalize.
 * Safe to call on every hydration and on URL `mode` sync (idempotent).
 */
export function sanitizeReconciledCreateLeagueState(s: CreateLeagueV2State): CreateLeagueV2State {
  let out: CreateLeagueV2State = { ...s }

  if (out.creationMode !== 'quick' && out.creationMode !== 'templates' && out.creationMode !== 'advanced') {
    out = { ...out, creationMode: 'quick' }
  }

  if (out.selectedTemplateId != null && !isLeagueCreationTemplateId(String(out.selectedTemplateId))) {
    out = { ...out, selectedTemplateId: null }
  }

  const rawLt = out.leagueType
  if (rawLt != null && !VALID_LEAGUE_TYPES.has(rawLt)) {
    out = { ...out, leagueType: null }
  }

  const sport = normalizeToSupportedSport(out.sport as string) as SupportedSport
  if (sport !== out.sport) {
    out = { ...out, sport }
  }

  if (out.idpSelected && !supportsIdpLeagueSport(out.sport)) {
    out = { ...out, idpSelected: false }
  }

  const lt = getEffectiveLeagueType(out)
  if (lt) {
    const opts = getTeamCountOptions(out.sport, lt, out.soccerPipeline, out.draftType, out.idpSelected)
    if (opts.length > 0 && !opts.includes(out.teamCount)) {
      const nextCount = getDefaultTeamCount(out.sport, lt, out.soccerPipeline, out.draftType, out.idpSelected)
      out = {
        ...out,
        teamCount: nextCount,
        ...(lt === 'tournament' ? { tournamentPoolSize: nextCount } : {}),
      }
    }
  }

  if (lt && isDynastyConcept(lt)) {
    const d = out.dynasty
    if (d.draftMode === 'scheduled' && !isValidIsoOrEmpty(d.draftDateUtc)) {
      out = {
        ...out,
        dynasty: { ...d, draftMode: 'offline', draftDateUtc: '' },
      }
    }
  }

  if (lt === 'best_ball') {
    const bb = out.bestBall
    if (bb.draftDateUtc?.trim() && !isValidIsoOrEmpty(bb.draftDateUtc)) {
      out = { ...out, bestBall: { ...bb, draftDateUtc: '' } }
    }
  }

  if (lt === 'tournament' && out.tournamentPoolSize !== out.teamCount) {
    out = { ...out, tournamentPoolSize: out.teamCount }
  }

  return out
}

/** Casual-redraft quick seed when Quick mode has no format yet (shared with URL mode sync). */
export function seedCasualQuickIfNeeded(s: CreateLeagueV2State): CreateLeagueV2State {
  if (s.creationMode !== 'quick' || getEffectiveLeagueType(s)) return s
  const patch = getQuickTemplatePatch('casual_redraft', s)
  const lt = patch.leagueType ?? null
  const suggestedName =
    lt && !s.nameTouched && !s.name.trim()
      ? buildSuggestedLeagueName({
          leagueType: lt,
          sport: patch.sport ?? s.sport,
          teamCount: patch.teamCount ?? s.teamCount,
          idpSelected: false,
        })
      : undefined
  return { ...s, ...patch, ...(suggestedName ? { name: suggestedName } : {}) }
}

export function finalizeScoringForCurrentType(s: CreateLeagueV2State): CreateLeagueV2State {
  const hydratedType = getEffectiveLeagueType(s)
  if (!hydratedType) return s
  const resolvedPreset = resolveScoringPresetId(s.scoringPresetId, {
    leagueType: hydratedType,
    sport: s.sport,
    idpSelected: s.idpSelected,
  })
  return {
    ...s,
    scoringPresetId: resolvedPreset,
    ...hydrateFootballScoringFields(s.sport, s.idpSelected, resolvedPreset),
  }
}

export function hydrateCreateLeagueInitialState(
  persisted: Partial<CreateLeagueV2State> | null,
  modeFromUrl: 'quick' | 'templates' | 'advanced' | null,
): CreateLeagueV2State {
  const s0 = DEFAULT_V2_STATE

  const merged: CreateLeagueV2State = persisted
    ? {
        ...s0,
        ...persisted,
        leagueType: persisted.leagueType ?? null,
        keeper: { ...getDefaultKeeperSetup(), ...(persisted.keeper ?? {}) },
        bestBall: {
          ...getDefaultBestBallSetup((persisted.sport ?? s0.sport) as SupportedSport),
          ...(persisted.bestBall ?? {}),
        },
      }
    : { ...s0 }

  let s: CreateLeagueV2State = modeFromUrl ? { ...merged, creationMode: modeFromUrl } : merged
  s = sanitizeReconciledCreateLeagueState(s)
  s = seedCasualQuickIfNeeded(s)
  s = finalizeScoringForCurrentType(s)
  return sanitizeReconciledCreateLeagueState(s)
}
