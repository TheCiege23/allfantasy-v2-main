/**
 * Backfills League rows so pre-draft validation matches persisted roster/scoring used elsewhere.
 * Does not bypass checks — writes canonical defaults when configuration is missing.
 */
import type { LeagueSport } from '@prisma/client'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import { buildScoringFromPresetId, getDefaultScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import {
  clearEffectiveLeagueRosterTemplateCache,
  getEffectiveLeagueRosterTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { prisma } from '@/lib/prisma'
import { resolveLeagueRosterConfig } from '@/lib/multi-sport/MultiSportRosterService'

export type EnsureLeagueDraftSetupDefaultsResult = {
  rosterConfigCreated: boolean
  scoringSettingsCreated: boolean
  alreadyHadRosterConfig: boolean
  alreadyHadScoringSettings: boolean
}

function presetCtxFromLeague(league: {
  sport: LeagueSport
  leagueVariant: string | null
  leagueType: string | null
  settings: unknown
}) {
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const ltRaw =
    (settings.league_type as string) ?? (settings.leagueType as string) ?? league.leagueType ?? 'redraft'
  const leagueType = String(ltRaw)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_') as LeagueTypeId
  const idpSelected =
    league.leagueVariant === 'idp' || String(league.leagueVariant ?? '').toLowerCase().includes('idp')
  return {
    leagueType,
    sport: league.sport as SupportedSport,
    idpSelected,
  }
}

function slotCountsFromTemplate(template: {
  slots: Array<{
    slotName?: string | null
    starterCount?: number | null
    benchCount?: number | null
    reserveCount?: number | null
    taxiCount?: number | null
    devyCount?: number | null
  }>
}): { starters: Record<string, number>; rosterSize: number } {
  const starters: Record<string, number> = {}
  let total = 0
  for (const slot of template.slots) {
    const key = String(slot.slotName ?? 'SLOT').trim() || 'SLOT'
    const n =
      (Number(slot.starterCount) || 0) +
      (Number(slot.benchCount) || 0) +
      (Number(slot.reserveCount) || 0) +
      (Number(slot.taxiCount) || 0) +
      (Number(slot.devyCount) || 0)
    if (n <= 0) continue
    starters[key] = (starters[key] ?? 0) + n
    total += n
  }
  return { starters, rosterSize: total }
}

/**
 * Ensures roster + scoring columns used by {@link DraftValidationOrchestrator} exist.
 * Safe to call when data lives only in settings JSON — copies derived defaults onto League.
 */
export async function ensureLeagueDraftSetupDefaults(
  leagueId: string,
  options?: { scope?: 'roster' | 'scoring' | 'both' },
): Promise<EnsureLeagueDraftSetupDefaultsResult> {
  const scope = options?.scope ?? 'both'

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      settings: true,
      scoring: true,
      scoringPresetId: true,
      leagueVariant: true,
      leagueType: true,
    },
  })
  if (!league) {
    throw new Error('League not found')
  }

  const settings = (league.settings as Record<string, unknown>) ?? {}

  const eff = await getEffectiveLeagueRosterTemplate(leagueId)
  const alreadyHadRosterConfig = eff.hasPersistedRosterSchema

  let rosterConfigCreated = false
  let scoringSettingsCreated = false

  if ((scope === 'roster' || scope === 'both') && !alreadyHadRosterConfig) {
    const { starters, rosterSize } = slotCountsFromTemplate(eff.template)
    if (rosterSize > 0 && Object.keys(starters).length > 0) {
      await prisma.league.update({
        where: { id: leagueId },
        data: {
          starters,
          rosterSize,
        },
      })
      rosterConfigCreated = true
    }
    clearEffectiveLeagueRosterTemplateCache(leagueId)

    const rosterFormat =
      (settings.roster_format_type as string) ?? (settings.roster_format as string) ?? 'standard'
    try {
      await resolveLeagueRosterConfig(leagueId, league.sport, rosterFormat)
    } catch {
      /* non-fatal — FK may skip default templates */
    }
    clearEffectiveLeagueRosterTemplateCache(leagueId)
  }

  const scoringFromColumn = league.scoring?.trim() ?? ''
  const scoringFromPreset = league.scoringPresetId?.trim() ?? ''
  const scoringFromSettings =
    (typeof settings.scoring_format === 'string' && settings.scoring_format.trim()) ||
    (typeof settings.scoring_format_type === 'string' && settings.scoring_format_type.trim()) ||
    ''
  const alreadyHadScoringSettings = Boolean(scoringFromColumn || scoringFromPreset || scoringFromSettings)

  if ((scope === 'scoring' || scope === 'both') && !alreadyHadScoringSettings) {
    const ctx = presetCtxFromLeague(league)
    const presetId = league.scoringPresetId?.trim() || getDefaultScoringPresetId(ctx)
    const built = buildScoringFromPresetId(presetId, ctx)
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        scoring: built.scoring,
        scoringPresetId: presetId,
      },
    })
    scoringSettingsCreated = true
  }

  return {
    rosterConfigCreated,
    scoringSettingsCreated,
    alreadyHadRosterConfig,
    alreadyHadScoringSettings,
  }
}
