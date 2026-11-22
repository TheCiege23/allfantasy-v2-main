'use client'

import type { LeagueCreationPresetPayload } from '@/hooks/useSportPreset'
import { LEAGUE_TYPE_LABELS, DRAFT_TYPE_LABELS } from '@/lib/league-creation-wizard/league-type-registry'
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_COMMISSIONER_PREFERENCES,
  DEFAULT_PRIVACY_SETTINGS,
  type LeagueCreationWizardState,
  type WizardCommissionerPreferences,
  type WizardStepId,
} from '@/lib/league-creation-wizard/types'
import { DEFAULT_WIZARD_FORMAT_OPTIONS } from '@/lib/league-creation-wizard/wizard-format-options'
import type { SoccerPipeline } from '@/lib/soccer/soccer-pipeline'

const COMMISSIONER_PREF_LABELS: Record<keyof WizardCommissionerPreferences, string> = {
  leagueAutomation: 'League automation',
  integrityMonitoring: 'Integrity monitoring',
  weeklyRecaps: 'Weekly recaps',
  draftCopilot: 'Draft copilot',
  matchupNarration: 'Matchup narration',
  fairnessAudit: 'Fairness audit',
  powerRankingsAi: 'Chimmy power rankings',
  constitutionAssistant: 'Rules assistant',
}

function buildCommissionerPreferencesSummary(prefs: WizardCommissionerPreferences): string {
  const enabled = (Object.entries(prefs) as [keyof WizardCommissionerPreferences, boolean][])
    .filter(([, on]) => on)
    .map(([k]) => COMMISSIONER_PREF_LABELS[k])
  if (enabled.length === 0) {
    return 'None selected — enable anytime with AF Commissioner in league settings'
  }
  return `${enabled.length} on: ${enabled.join(' · ')}`
}

function soccerPipelineLabel(pipeline: SoccerPipeline | null | undefined): string {
  if (pipeline === 'mls') return 'MLS / North America'
  return 'European leagues'
}

function getPlatformStyleLabel(platformStyleMirror: LeagueCreationWizardState['platformStyleMirror']): string {
  if (platformStyleMirror === 'espn') return 'ESPN-style'
  if (platformStyleMirror === 'yahoo') return 'Yahoo-style'
  return 'AllFantasy default'
}

export type LeagueSummaryPanelProps = {
  state: LeagueCreationWizardState
  creationPreset?: LeagueCreationPresetPayload | null
  onEditStep: (step: WizardStepId) => void
}

function SummaryRow({
  label,
  value,
  testId,
}: {
  label: string
  value: React.ReactNode
  testId?: string
}) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/10 py-1.5" data-testid={testId}>
      <div className="text-white/60">{label}</div>
      <div className="max-w-[60%] text-right font-medium text-white/90">{value}</div>
    </div>
  )
}

function SummarySection({
  title,
  stepId,
  onEditStep,
  children,
}: {
  title: string
  stepId: WizardStepId
  onEditStep: (step: WizardStepId) => void
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50">{title}</h3>
        <button
          type="button"
          onClick={() => onEditStep(stepId)}
          className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
        >
          Edit
        </button>
      </div>
      <div className="space-y-0 text-sm">{children}</div>
    </div>
  )
}

/**
 * League Summary Review: displayed before creating the league.
 */
export function LeagueSummaryPanel({ state, creationPreset: _creationPreset, onEditStep }: LeagueSummaryPanelProps) {
  const aiSettings = state.aiSettings ?? DEFAULT_AI_SETTINGS
  const automationSettings = state.automationSettings ?? DEFAULT_AUTOMATION_SETTINGS
  const privacySettings = state.privacySettings ?? DEFAULT_PRIVACY_SETTINGS
  const aiSummary = [
    aiSettings.aiAdpEnabled ? 'Chimmy ADP on' : 'Chimmy ADP off',
    aiSettings.orphanTeamAiManagerEnabled ? 'Orphan Chimmy on' : 'Orphan Chimmy off',
    aiSettings.draftHelperEnabled ? 'Draft helper on' : 'Draft helper off',
  ].join(' · ')
  const automationSummary = [
    automationSettings.draftNotificationsEnabled ? 'Notifications on' : 'Notifications off',
    automationSettings.autopickFromQueueEnabled ? 'Queue autopick on' : 'Queue autopick off',
    automationSettings.slowDraftRemindersEnabled ? 'Slow reminders on' : 'Slow reminders off',
  ].join(' · ')
  const commissionerSummary = buildCommissionerPreferencesSummary(
    state.commissionerPreferences ?? DEFAULT_COMMISSIONER_PREFERENCES,
  )
  const formatOpts = { ...DEFAULT_WIZARD_FORMAT_OPTIONS, ...state.formatOptions }
  const survivorTribes = formatOpts.survivorTribeCountOverride ?? 4
  const survivorCustomNames = formatOpts.survivorCustomTribeNamesLines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-white">Review & create</h2>
        <p className="text-sm text-white/70">
          Confirm your choices. Use <strong className="text-white/90">Edit</strong> to jump back to a step; you&apos;ll
          return here when done.
        </p>
      </div>

      <SummarySection title="Sport & format" stepId="sport" onEditStep={onEditStep}>
        <SummaryRow label="Sport" value={state.sport} testId="league-summary-sport" />
        {state.sport === 'SOCCER' ? (
          <SummaryRow
            label="Soccer data"
            value={soccerPipelineLabel(state.soccerPipeline ?? 'euro')}
            testId="league-summary-soccer-pipeline"
          />
        ) : null}
        <SummaryRow label="League type" value={LEAGUE_TYPE_LABELS[state.leagueType]} testId="league-summary-league-type" />
        <SummaryRow label="Draft type" value={DRAFT_TYPE_LABELS[state.draftType]} testId="league-summary-draft-type" />
      </SummarySection>

      <SummarySection title="League details" stepId="team_setup" onEditStep={onEditStep}>
        <SummaryRow label="League name" value={state.name.trim() || '—'} />
        <SummaryRow
          label={state.leagueType === 'survivor' ? 'Cast size (teams)' : 'Teams'}
          value={state.teamCount}
        />
        {state.leagueType === 'survivor' ? (
          <>
            <SummaryRow
              label="Buy-in"
              value={
                formatOpts.survivorEntryFeeMode === 'paid'
                  ? formatOpts.survivorEntryFeeUsd != null && Number.isFinite(formatOpts.survivorEntryFeeUsd)
                    ? `$${Number(formatOpts.survivorEntryFeeUsd).toFixed(2)} / manager`
                    : 'Paid (amount set at create)'
                  : 'Free'
              }
            />
            <SummaryRow label="Tribes" value={survivorTribes} />
            <SummaryRow
              label="Tribe names"
              value={
                formatOpts.survivorTribeNameMode === 'custom'
                  ? survivorCustomNames.length > 0
                    ? survivorCustomNames.join(' · ')
                    : '—'
                  : 'Auto-generated'
              }
            />
          </>
        ) : null}
        <SummaryRow label="Timezone" value={state.leagueTimezone ?? 'America/New_York'} />
        <SummaryRow label="Trade review" value={state.tradeReviewMode} />
        {state.leagueType === 'devy' ? (
          <>
            <SummaryRow label="Devy rounds / yr" value={state.devyLeagueSetup.devyRoundsPerSeason} />
            <SummaryRow
              label="Devy / taxi slots"
              value={`${state.devyLeagueSetup.rosterSlots.devy} devy · ${state.devyLeagueSetup.rosterSlots.taxi} taxi`}
            />
            <SummaryRow label="Annual draft order" value={state.devyLeagueSetup.annualRookieDevyOrderStyle} />
          </>
        ) : null}
      </SummarySection>

      <SummarySection title="Scoring" stepId="scoring" onEditStep={onEditStep}>
        <SummaryRow label="Platform style" value={getPlatformStyleLabel(state.platformStyleMirror)} />
      </SummarySection>

      <SummarySection title="Chimmy, automation & privacy" stepId="draft_privacy" onEditStep={onEditStep}>
        <SummaryRow label="Chimmy" value={aiSummary} testId="league-summary-ai-settings" />
        <SummaryRow label="Automation" value={automationSummary} testId="league-summary-automation-settings" />
        <SummaryRow label="AF Commissioner Chimmy" value={commissionerSummary} testId="league-summary-commissioner-prefs" />
        <SummaryRow label="Visibility" value={privacySettings.visibility} />
        <SummaryRow label="Invite link" value={privacySettings.allowInviteLink ? 'Allowed' : 'Disabled'} />
      </SummarySection>
    </div>
  )
}
