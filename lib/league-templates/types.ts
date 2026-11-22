/**
 * League template payload: wizard-compatible state (no step).
 * Used to prefill the creation wizard and to merge into League.settings at create.
 */

import type {
  LeagueTypeId,
  DraftTypeId,
  WizardDraftSettings,
  WizardWaiverSettings,
  WizardPlayoffSettings,
  WizardScheduleSettings,
  WizardAISettings,
  WizardAutomationSettings,
  WizardPrivacySettings,
} from '@/lib/league-creation-wizard/types'

export interface LeagueTemplatePayload {
  sport: string
  leagueType: LeagueTypeId
  draftType: DraftTypeId
  name: string
  teamCount: number
  rosterSize: number | null
  scoringPreset: string | null
  leagueVariant: string | null
  draftSettings: WizardDraftSettings
  waiverSettings: WizardWaiverSettings
  playoffSettings: WizardPlayoffSettings
  scheduleSettings?: WizardScheduleSettings
  aiSettings: WizardAISettings
  automationSettings: WizardAutomationSettings
  privacySettings: WizardPrivacySettings
  /**
   * Optional full league settings snapshot captured from an existing league template source.
   * Applied at create-time before wizard field overrides.
   */
  templateSettingsOverrides?: Record<string, unknown>
}

