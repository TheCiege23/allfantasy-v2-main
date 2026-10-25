'use client'

import { StepHeader } from './StepHelp'
import type { WizardPlayoffSettings } from '@/lib/league-creation-wizard/types'

const SEEDING_RULES = [
  { value: 'standard_standings', label: 'Standard standings' },
  { value: 'division_winners_first', label: 'Division winners first' },
  { value: 'points_for_then_record', label: 'Points for then record' },
]

const RESEED_BEHAVIORS = [
  { value: 'fixed_bracket', label: 'Fixed bracket' },
  { value: 'reseed_after_round', label: 'Reseed after each round' },
]

const BYE_RULES = [
  { value: '', label: 'No byes' },
  { value: 'top_seed_bye', label: 'Top seed bye' },
  { value: 'top_two_seeds_bye', label: 'Top two seeds bye' },
]

const CONSOLATION_OPTIONS: Array<{ value: WizardPlayoffSettings['consolationPlaysFor']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'pick', label: 'Draft pick' },
  { value: 'cash', label: 'Cash' },
]

const TIEBREAKER_OPTIONS = [
  { value: 'points_for', label: 'Points for' },
  { value: 'head_to_head', label: 'Head-to-head' },
  { value: 'points_against', label: 'Points against' },
  { value: 'division_record', label: 'Division record' },
  { value: 'conference_record', label: 'Conference record' },
  { value: 'total_wins', label: 'Total wins' },
]

export function PlayoffSettingsPanel(props: {
  sport: string
  leagueVariant: string | null
  playoffSettings: WizardPlayoffSettings
  onPlayoffSettingsChange: (patch: Partial<WizardPlayoffSettings>) => void
}) {
  const { sport, leagueVariant, playoffSettings, onPlayoffSettingsChange } = props

  return (
    <div className="space-y-5">
      <StepHeader
        title="Playoff settings"
        description="Set default postseason structure and tiebreakers for this league."
        helpTitle="Playoff defaults explained"
        help={(
          <>
            These defaults initialize bracket setup, seeding behavior, byes, and consolation rules. Commissioners can still
            override them later.
          </>
        )}
      />

      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/70">
        Sport: <span className="text-white/90">{sport}</span>
        {leagueVariant ? (
          <>
            {' '}· Variant: <span className="text-white/90">{leagueVariant}</span>
          </>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Playoff team count</span>
          <input
            aria-label="Playoff team count"
            type="number"
            min={0}
            value={playoffSettings.playoffTeamCount}
            onChange={(e) =>
              onPlayoffSettingsChange({ playoffTeamCount: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Playoff weeks</span>
          <input
            aria-label="Playoff weeks"
            type="number"
            min={0}
            value={playoffSettings.playoffWeeks}
            onChange={(e) =>
              onPlayoffSettingsChange({ playoffWeeks: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Playoff start week</span>
          <input
            aria-label="Playoff start week"
            type="number"
            min={1}
            value={playoffSettings.playoffStartWeek ?? ''}
            onChange={(e) =>
              onPlayoffSettingsChange({
                playoffStartWeek: e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1),
              })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
            placeholder="None"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">First-round byes</span>
          <input
            aria-label="First-round byes"
            type="number"
            min={0}
            value={playoffSettings.firstRoundByes}
            onChange={(e) =>
              onPlayoffSettingsChange({ firstRoundByes: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Seeding rules</span>
          <select
            aria-label="Seeding rules"
            value={playoffSettings.seedingRules}
            onChange={(e) => onPlayoffSettingsChange({ seedingRules: e.target.value })}
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            {SEEDING_RULES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Bye rules</span>
          <select
            aria-label="Bye rules"
            value={playoffSettings.byeRules ?? ''}
            onChange={(e) => onPlayoffSettingsChange({ byeRules: e.target.value || null })}
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            {BYE_RULES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Reseed behavior</span>
          <select
            aria-label="Reseed behavior"
            value={playoffSettings.reseedBehavior}
            onChange={(e) => onPlayoffSettingsChange({ reseedBehavior: e.target.value })}
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            {RESEED_BEHAVIORS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Consolation plays for</span>
          <select
            aria-label="Consolation plays for"
            value={playoffSettings.consolationPlaysFor}
            onChange={(e) =>
              onPlayoffSettingsChange({
                consolationPlaysFor: e.target.value as WizardPlayoffSettings['consolationPlaysFor'],
              })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          >
            {CONSOLATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <span className="block text-xs text-white/50">
            Draft pick: next season, the consolation winner picks first among non-playoff teams; in a toilet bowl, last
            place (the final&apos;s loser) picks first. Everyone else follows in reverse standings.
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Matchup length</span>
          <input
            aria-label="Matchup length"
            type="number"
            min={1}
            value={playoffSettings.matchupLength}
            onChange={(e) =>
              onPlayoffSettingsChange({ matchupLength: Math.max(1, Number(e.target.value) || 1) })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Total rounds</span>
          <input
            aria-label="Total rounds"
            type="number"
            min={0}
            value={playoffSettings.totalRounds ?? ''}
            onChange={(e) =>
              onPlayoffSettingsChange({
                totalRounds: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
              })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
            placeholder="Auto"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-sm text-white/85">Championship length</span>
          <input
            aria-label="Championship length"
            type="number"
            min={0}
            value={playoffSettings.championshipLength}
            onChange={(e) =>
              onPlayoffSettingsChange({ championshipLength: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full rounded-lg border border-white/20 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white/85">
          <input
            type="checkbox"
            checked={playoffSettings.consolationBracketEnabled}
            onChange={(e) => onPlayoffSettingsChange({ consolationBracketEnabled: e.target.checked })}
            className="rounded border-white/30"
          />
          Consolation bracket
        </label>
        <label className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white/85">
          <input
            type="checkbox"
            checked={playoffSettings.thirdPlaceGameEnabled}
            onChange={(e) => onPlayoffSettingsChange({ thirdPlaceGameEnabled: e.target.checked })}
            className="rounded border-white/30"
          />
          Third-place game
        </label>
        <label className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white/85">
          <input
            type="checkbox"
            checked={playoffSettings.toiletBowlEnabled}
            onChange={(e) => onPlayoffSettingsChange({ toiletBowlEnabled: e.target.checked })}
            className="rounded border-white/30"
          />
          Toilet bowl
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm text-white/85">Tiebreakers</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {TIEBREAKER_OPTIONS.map((option) => {
            const checked = playoffSettings.tiebreakerRules.includes(option.value)
            return (
              <label key={option.value} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-2.5 py-1.5 text-xs text-white/85">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? Array.from(new Set([...playoffSettings.tiebreakerRules, option.value]))
                      : playoffSettings.tiebreakerRules.filter((v) => v !== option.value)
                    onPlayoffSettingsChange({ tiebreakerRules: next })
                  }}
                  className="rounded border-white/30"
                />
                {option.label}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
