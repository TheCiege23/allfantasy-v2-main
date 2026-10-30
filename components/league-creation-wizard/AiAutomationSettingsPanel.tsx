'use client'

import { useRouter } from 'next/navigation'
import { useEntitlement } from '@/hooks/useEntitlement'
import type {
  LeagueTypeId,
  WizardAISettings,
  WizardAutomationSettings,
  WizardCommissionerPreferences,
} from '@/lib/league-creation-wizard/types'
import { getUpgradeUrlWithHighlightForFeature } from '@/lib/subscription/featureGating'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StepHeader } from './StepHelp'
import { DEFAULT_SELF_RUNNING_PRESET, offersSelfRunningPreset, SELF_RUNNING_OPTIONS } from '@/lib/league-creation-wizard/selfRunningPreset'

export type AutomationDraftPreset = 'alerts_only' | 'standard' | 'full'

const AUTOMATION_PRESET_LABEL: Record<AutomationDraftPreset, string> = {
  alerts_only: 'Draft alerts only',
  standard: 'Standard (alerts, queue autopick)',
  full: 'Full draft assistance (all alerts and reminders on)',
}

const AUTOMATION_PRESET_DETAIL: Record<AutomationDraftPreset, string> = {
  alerts_only:
    'Notify managers when they are on the clock or when picks complete — no autopick from queue and no slow-draft nudges.',
  standard:
    'Alerts plus autopick from your saved queue when time expires (common redraft default). Slow-draft reminder emails stay off unless you enable full.',
  full:
    'Everything in Standard, plus slow-draft reminders so long drafts do not stall overnight.',
}

const CHECKBOX_CLASS = 'mt-0.5 shrink-0 size-5 rounded border border-white/30 bg-[#020817] accent-cyan-400 disabled:opacity-50'

function presetToSettings(preset: AutomationDraftPreset): Partial<WizardAutomationSettings> {
  switch (preset) {
    case 'alerts_only':
      return {
        draftNotificationsEnabled: true,
        autopickFromQueueEnabled: false,
        slowDraftRemindersEnabled: false,
      }
    case 'standard':
      return {
        draftNotificationsEnabled: true,
        autopickFromQueueEnabled: true,
        slowDraftRemindersEnabled: false,
      }
    case 'full':
    default:
      return {
        draftNotificationsEnabled: true,
        autopickFromQueueEnabled: true,
        slowDraftRemindersEnabled: true,
      }
  }
}

function detectPreset(a: WizardAutomationSettings): AutomationDraftPreset {
  if (a.draftNotificationsEnabled && !a.autopickFromQueueEnabled && !a.slowDraftRemindersEnabled) {
    return 'alerts_only'
  }
  if (a.draftNotificationsEnabled && a.autopickFromQueueEnabled && a.slowDraftRemindersEnabled) {
    return 'full'
  }
  return 'standard'
}

export type AiAutomationSettingsPanelProps = {
  /** Devy / C2C: show format-specific commissioner AI callouts. */
  leagueType?: LeagueTypeId
  sport: string
  aiSettings: WizardAISettings
  automationSettings: WizardAutomationSettings
  commissionerPreferences: WizardCommissionerPreferences
  onAiChange: (patch: Partial<WizardAISettings>) => void
  onAutomationChange: (patch: Partial<WizardAutomationSettings>) => void
  onCommissionerChange: (patch: Partial<WizardCommissionerPreferences>) => void
}

/**
 * Draft AI + free draft automation presets + AF Commissioner AI tools (subscription-gated).
 */
export function AiAutomationSettingsPanel({
  leagueType,
  sport,
  aiSettings,
  automationSettings,
  commissionerPreferences,
  onAiChange,
  onAutomationChange,
  onCommissionerChange,
}: AiAutomationSettingsPanelProps) {
  const isDevy = leagueType === 'devy'
  const isC2c = leagueType === 'c2c'
  const router = useRouter()
  const { loading, featureAccess, upgradePath } = useEntitlement('commissioner_automation')
  /** While loading, do not treat as locked so the section does not flash grey before entitlement resolves. */
  const locked = !loading && featureAccess !== true
  const upgradeUrl = getUpgradeUrlWithHighlightForFeature('commissioner_automation')

  const goSubscribe = () => {
    router.push(upgradeUrl || upgradePath || '/commissioner-upgrade')
  }

  const preset = detectPreset(automationSettings)

  const commissionerRows: {
    key: keyof WizardCommissionerPreferences
    label: string
    description: string
  }[] = [
    {
      key: 'leagueAutomation',
      label: 'League automation',
      description: 'AI-assisted league cycles and commissioner workflows.',
    },
    {
      key: 'integrityMonitoring',
      label: 'Integrity monitoring',
      description: 'Flags unusual patterns for commissioner review.',
    },
    {
      key: 'weeklyRecaps',
      label: 'Weekly recaps',
      description: 'Narrated summaries for your league channel.',
    },
    {
      key: 'draftCopilot',
      label: 'Draft copilot',
      description: 'Deeper draft-room guidance for commissioners.',
    },
    {
      key: 'matchupNarration',
      label: 'Matchup narration',
      description: 'Story-style matchup previews and results.',
    },
    {
      key: 'fairnessAudit',
      label: 'Fairness audit',
      description: 'Trade and roster fairness highlights.',
    },
    {
      key: 'powerRankingsAi',
      label: 'AI power rankings',
      description: 'League power ranks with explanations.',
    },
    {
      key: 'constitutionAssistant',
      label: 'Rules assistant',
      description: 'Help drafting and clarifying league rules.',
    },
  ]

  const aiRows: {
    key: keyof WizardAISettings
    label: string
    description: string
  }[] = [
    {
      key: 'aiAdpEnabled',
      label: 'AI rankings in draft room',
      description: `Use AI-assisted player lists during the draft (${sport}).`,
    },
    {
      key: 'draftHelperEnabled',
      label: 'Draft suggestions',
      description: 'Pick suggestions and queue hints while drafting.',
    },
    {
      key: 'orphanTeamAiManagerEnabled',
      label: 'Auto-pick for open teams',
      description: 'When a team has no manager, use smart picks on the clock.',
    },
  ]

  return (
    <div className="space-y-8">
      <StepHeader
        title="Draft help & automation"
        description="Free draft alerts and queue behavior. Advanced commissioner AI is optional and can be managed later in league settings."
        help={
          <>
            <strong>Free</strong> — draft notifications, autopick from queue, and slow-draft reminders (Sleeper-style draft
            hygiene). <strong>AF Commissioner</strong> — optional AI tools for running the league; requires an active
            subscription.
          </>
        }
        helpTitle="How this step works"
      />

      {offersSelfRunningPreset(leagueType) ? (
        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4" data-testid="self-running-preset">
          <h4 className="text-sm font-semibold text-cyan-200/90">How much should AllFantasy run?</h4>
          <p className="text-xs text-white/60">You can change any of this later on the Commissioner Hub, one switch at a time.</p>
          <div className="space-y-2" role="radiogroup" aria-label="How much should AllFantasy run?">
            {SELF_RUNNING_OPTIONS.map((o) => (
              <label key={o.id} className="flex items-start gap-3 text-sm text-white/85">
                <input
                  type="radio"
                  name="self-running-preset"
                  className={CHECKBOX_CLASS}
                  checked={(automationSettings.selfRunningPreset ?? DEFAULT_SELF_RUNNING_PRESET) === o.id}
                  onChange={() => onAutomationChange({ selfRunningPreset: o.id })}
                  data-testid={`self-running-${o.id}`}
                />
                <span>
                  <strong>{o.label}</strong>
                  <span className="block text-xs text-white/60">{o.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-cyan-200/90">Draft assistance (free)</h4>
        <div className="space-y-3">
          <Label className="text-white/80">Draft automation</Label>
          <Select
            value={preset}
            onValueChange={(v) => onAutomationChange(presetToSettings(v as AutomationDraftPreset))}
          >
            <SelectTrigger className="min-h-[44px] border-white/20 bg-[#030a20] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AUTOMATION_PRESET_LABEL) as AutomationDraftPreset[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {AUTOMATION_PRESET_LABEL[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-white/55 leading-relaxed">{AUTOMATION_PRESET_DETAIL[preset]}</p>
          <p className="text-xs text-white/50">
            These options only affect draft notifications and autopick — no subscription required.
          </p>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          {aiRows.map((row) => {
            const checked = aiSettings[row.key]
            return (
              <label
                key={row.key}
                className={`flex items-start gap-3 cursor-pointer rounded-2xl border px-3 py-3 transition ${
                  checked
                    ? 'border-cyan-400/35 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]'
                    : 'border-white/12 bg-black/25 hover:bg-black/35'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onAiChange({ [row.key]: e.target.checked })}
                  className={CHECKBOX_CLASS}
                />
                <div>
                  <span className="text-sm font-medium text-white/90">{row.label}</span>
                  <p className="text-xs text-white/50 mt-0.5">{row.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      </section>

      <section
        className={`space-y-4 rounded-2xl border p-4 ${
          locked ? 'border-white/10 bg-white/[0.02]' : 'border-cyan-400/20 bg-cyan-400/[0.04]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-white">AF Commissioner AI</h4>
          {loading ? (
            <span className="text-xs text-white/45">Checking subscription…</span>
          ) : locked ? (
            <span className="text-xs text-amber-200/80">Subscription required</span>
          ) : (
            <span className="text-xs text-emerald-200/80">Included with AF Commissioner</span>
          )}
        </div>
        <p className="text-xs text-white/55">
          Turn on the tools you want available for this league. Full commissioner controls stay under League → Settings
          after creation.
        </p>
        {isDevy ? (
          <p className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.06] px-3 py-2 text-xs text-cyan-100/85">
            <span className="font-semibold text-white/90">Devy dynasty:</span> these tools apply to your pro roster and
            college devy pool (e.g. draft copilot across startup/devy rounds, fairness on devy pick trades, recaps that
            mention promotions). Fine-grained devy rules stay under{' '}
            <span className="text-white/80">League → Devy settings</span> after creation.
          </p>
        ) : null}
        {isC2c ? (
          <p className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.06] px-3 py-2 text-xs text-cyan-100/85">
            <span className="font-semibold text-white/90">Campus to Canton:</span> commissioner AI can highlight pro and
            college storylines, draft help across merged rounds, and fairness on cross-pool trades. Full C2C rules and
            pool sizes are tuned under <span className="text-white/80">League → Settings</span> after creation.
          </p>
        ) : null}
        <div className="space-y-3">
          {commissionerRows.map((row) => {
            const checked = commissionerPreferences[row.key]
            return (
              <label
                key={row.key}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                  locked
                    ? 'cursor-pointer border-white/10 bg-black/30 opacity-70'
                    : checked
                      ? 'cursor-pointer border-cyan-400/35 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]'
                      : 'cursor-pointer border-white/15 bg-black/25 hover:bg-black/35'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={loading}
                  checked={locked ? false : checked}
                  onChange={(e) => {
                    if (locked) {
                      goSubscribe()
                      return
                    }
                    onCommissionerChange({ [row.key]: e.target.checked })
                  }}
                  className={CHECKBOX_CLASS}
                />
                <span>
                  <span className="block text-sm font-medium text-white/90">{row.label}</span>
                  <span className="mt-0.5 block text-xs text-white/50">{row.description}</span>
                  {locked ? (
                    <span className="mt-1 block text-xs text-amber-200/90">Requires AF Commissioner — click to subscribe</span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
      </section>
    </div>
  )
}
