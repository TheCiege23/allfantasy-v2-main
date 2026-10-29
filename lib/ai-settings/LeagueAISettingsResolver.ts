/**
 * League-level AI feature toggles (commissioner-controlled).
 * Stored in League.settings. AI is optional; commissioners enable/disable per feature.
 */

import { prisma } from '@/lib/prisma'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { updateDraftUISettings } from '@/lib/draft-defaults/DraftUISettingsResolver'

export interface LeagueAISettings {
  tradeAnalyzerEnabled: boolean
  waiverAiEnabled: boolean
  draftAssistantEnabled: boolean
  playerComparisonEnabled: boolean
  matchupSimulatorEnabled: boolean
  fantasyCoachEnabled: boolean
  aiChatChimmyEnabled: boolean
  aiDraftManagerOrphanEnabled: boolean
}

const SETTINGS_KEYS: Record<keyof LeagueAISettings, string> = {
  tradeAnalyzerEnabled: 'ai_feature_trade_analyzer_enabled',
  waiverAiEnabled: 'ai_feature_waiver_ai_enabled',
  draftAssistantEnabled: 'ai_feature_draft_assistant_enabled',
  playerComparisonEnabled: 'ai_feature_player_comparison_enabled',
  matchupSimulatorEnabled: 'ai_feature_matchup_simulator_enabled',
  fantasyCoachEnabled: 'ai_feature_fantasy_coach_enabled',
  aiChatChimmyEnabled: 'ai_feature_ai_chat_chimmy_enabled',
  aiDraftManagerOrphanEnabled: 'draft_orphan_team_ai_manager_enabled',
}

const DEFAULTS: LeagueAISettings = {
  tradeAnalyzerEnabled: true,
  waiverAiEnabled: true,
  draftAssistantEnabled: true,
  playerComparisonEnabled: true,
  matchupSimulatorEnabled: true,
  fantasyCoachEnabled: true,
  aiChatChimmyEnabled: true,
  aiDraftManagerOrphanEnabled: false,
}

function fromStorage(
  settings: Record<string, unknown>,
  orphanFromDraft: { orphanTeamAiManagerEnabled: boolean; orphanDrafterMode: 'cpu' | 'ai' }
): LeagueAISettings {
  return {
    tradeAnalyzerEnabled: (settings[SETTINGS_KEYS.tradeAnalyzerEnabled] as boolean) ?? DEFAULTS.tradeAnalyzerEnabled,
    waiverAiEnabled: (settings[SETTINGS_KEYS.waiverAiEnabled] as boolean) ?? DEFAULTS.waiverAiEnabled,
    draftAssistantEnabled: (settings[SETTINGS_KEYS.draftAssistantEnabled] as boolean) ?? DEFAULTS.draftAssistantEnabled,
    playerComparisonEnabled: (settings[SETTINGS_KEYS.playerComparisonEnabled] as boolean) ?? DEFAULTS.playerComparisonEnabled,
    matchupSimulatorEnabled: (settings[SETTINGS_KEYS.matchupSimulatorEnabled] as boolean) ?? DEFAULTS.matchupSimulatorEnabled,
    fantasyCoachEnabled: (settings[SETTINGS_KEYS.fantasyCoachEnabled] as boolean) ?? DEFAULTS.fantasyCoachEnabled,
    aiChatChimmyEnabled: (settings[SETTINGS_KEYS.aiChatChimmyEnabled] as boolean) ?? DEFAULTS.aiChatChimmyEnabled,
    aiDraftManagerOrphanEnabled:
      orphanFromDraft.orphanTeamAiManagerEnabled && orphanFromDraft.orphanDrafterMode === 'ai',
  }
}

/**
 * Get AI feature toggles for a league. Orphan draft manager is read from draft UI settings (single source of truth).
 */
export async function getLeagueAISettings(leagueId: string): Promise<LeagueAISettings> {
  const [league, draftUI] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    }),
    getDraftUISettingsForLeague(leagueId),
  ])
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  return fromStorage(settings, {
    orphanTeamAiManagerEnabled: draftUI.orphanTeamAiManagerEnabled,
    orphanDrafterMode: draftUI.orphanDrafterMode,
  })
}

/**
 * Update AI feature toggles (commissioner only). Orphan draft manager is written to draft UI settings.
 */
export async function updateLeagueAISettings(
  leagueId: string,
  patch: Partial<LeagueAISettings>
): Promise<LeagueAISettings> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league) throw new Error('League not found')

  const current = (league.settings as Record<string, unknown>) ?? {}
  const next = { ...current }

  if (patch.tradeAnalyzerEnabled !== undefined)
    next[SETTINGS_KEYS.tradeAnalyzerEnabled] = patch.tradeAnalyzerEnabled
  if (patch.waiverAiEnabled !== undefined)
    next[SETTINGS_KEYS.waiverAiEnabled] = patch.waiverAiEnabled
  if (patch.draftAssistantEnabled !== undefined)
    next[SETTINGS_KEYS.draftAssistantEnabled] = patch.draftAssistantEnabled
  if (patch.playerComparisonEnabled !== undefined)
    next[SETTINGS_KEYS.playerComparisonEnabled] = patch.playerComparisonEnabled
  if (patch.matchupSimulatorEnabled !== undefined)
    next[SETTINGS_KEYS.matchupSimulatorEnabled] = patch.matchupSimulatorEnabled
  if (patch.fantasyCoachEnabled !== undefined)
    next[SETTINGS_KEYS.fantasyCoachEnabled] = patch.fantasyCoachEnabled
  if (patch.aiChatChimmyEnabled !== undefined)
    next[SETTINGS_KEYS.aiChatChimmyEnabled] = patch.aiChatChimmyEnabled

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: next as any, updatedAt: new Date() },
  })

  // AFTER the write above, not before: `next` was built from the settings read at the top, and
  // writing it after this call put the old orphan keys straight back. This call re-reads.
  if (patch.aiDraftManagerOrphanEnabled !== undefined) {
    await updateDraftUISettings(leagueId, {
      orphanTeamAiManagerEnabled: patch.aiDraftManagerOrphanEnabled,
      orphanDrafterMode: patch.aiDraftManagerOrphanEnabled ? 'ai' : 'cpu',
    })
  }

  const draftUI = await getDraftUISettingsForLeague(leagueId)
  return fromStorage(next, {
    orphanTeamAiManagerEnabled: draftUI.orphanTeamAiManagerEnabled,
    orphanDrafterMode: draftUI.orphanDrafterMode,
  })
}

/**
 * Check if a specific AI feature is enabled for the league (for use in routes/tools).
 */
export async function isLeagueAIFeatureEnabled(
  leagueId: string,
  feature: keyof LeagueAISettings
): Promise<boolean> {
  const settings = await getLeagueAISettings(leagueId)
  return !!settings[feature]
}
