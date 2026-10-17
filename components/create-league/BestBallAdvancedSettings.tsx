'use client'

import { useEffect } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import {
  buildBestBallSettingsSummary,
  getBestBallSportProfile,
  normalizeBestBallSettings,
} from '@/lib/bestball/rules'
import {
  GlassCard,
  GlassInput,
  GlassSelect,
  InnerPanel,
  SectionHeader,
  Segmented,
  Toggle,
} from '@/components/create-league-v2/primitives'

export function BestBallAdvancedSettings({
  state,
  accent,
  onChange,
}: {
  state: CreateLeagueV2State
  accent: AccentTone
  onChange: (patch: Partial<CreateLeagueV2State>) => void
}) {
  const profile = getBestBallSportProfile(state.sport)
  const settings = normalizeBestBallSettings({
    sport: state.sport,
    conceptSetup: { bestBall: state.bestBall },
    draftType: state.draftType,
    timezone: state.timezone,
    language: state.language,
  })

  useEffect(() => {
    const draftMode =
      state.draftType === 'auction' ||
      state.draftType === 'linear' ||
      state.draftType === 'offline' ||
      state.draftType === 'auto' ||
      state.draftType === 'snake'
        ? state.draftType
        : 'snake'
    if (state.bestBall.draftMode === draftMode && state.bestBall.sport === state.sport) return
    onChange({
      bestBall: normalizeBestBallSettings({
        sport: state.sport,
        draftType: draftMode,
        timezone: state.timezone,
        language: state.language,
        conceptSetup: {
          bestBall: {
            ...state.bestBall,
            sport: state.sport,
            draftMode,
          },
        },
      }),
    })
  }, [onChange, state.bestBall, state.draftType, state.language, state.sport, state.timezone])

  const patchBestBall = (patch: Partial<CreateLeagueV2State['bestBall']>) =>
    onChange({ bestBall: { ...state.bestBall, ...patch } })

  return (
    <GlassCard>
      <SectionHeader
        title="Best Ball Setup"
        hint="Choose your operating model, lineup template, contest structure, and in-season restrictions. These settings flow into league creation, scoring, standings, and the draft room."
      />

      <Segmented
        options={[
          { value: 'standard', label: 'Standard', hint: 'Flexible commissioner controls' },
          { value: 'underdog', label: 'Underdog-style', hint: 'Snake-first, no waivers/trades/subs' },
        ]}
        value={settings.mode}
        onChange={(mode) => patchBestBall(normalizeBestBallSettings({ sport: state.sport, draftType: state.draftType, timezone: state.timezone, language: state.language, conceptSetup: { bestBall: { ...state.bestBall, mode } } }))}
        accent={accent}
        ariaLabel="Best Ball mode"
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <GlassSelect
          label="Contest structure"
          value={settings.contestStructure}
          onChange={(contestStructure) => patchBestBall({ contestStructure })}
          options={[
            { value: 'season_long', label: 'Season-long' },
            { value: 'sit_and_go', label: 'Sit-and-go / pod' },
            { value: 'tournament', label: 'Tournament / advancement' },
          ]}
          accent={accent}
        />
        <GlassSelect
          label="Scoring model"
          value={settings.matchupFormat}
          onChange={(matchupFormat) =>
            patchBestBall({
              matchupFormat,
              cumulativeScoring: matchupFormat === 'cumulative',
              playoffFormat: matchupFormat === 'cumulative' ? 'advancement' : state.bestBall.playoffFormat,
            })
          }
          options={[
            { value: 'cumulative', label: 'Cumulative points' },
            { value: 'h2h', label: 'Head-to-head' },
          ]}
          accent={accent}
        />
        <GlassSelect
          label="Lineup template"
          value={settings.lineupTemplateId}
          onChange={(lineupTemplateId) => patchBestBall({ lineupTemplateId })}
          options={[
            { value: profile.lineupTemplateId, label: `${profile.label} Default` },
            { value: `${profile.lineupTemplateId}_deep`, label: `${profile.label} Deep` },
          ]}
          accent={accent}
        />
        <GlassSelect
          label="Roster template"
          value={settings.rosterTemplateId}
          onChange={(rosterTemplateId) => patchBestBall({ rosterTemplateId })}
          options={[
            { value: profile.rosterTemplateId, label: `Recommended (${profile.recommendedRosterSize} roster spots)` },
            { value: `${profile.rosterTemplateId}-large`, label: `Expanded depth (${profile.recommendedRosterSize + 2})` },
          ]}
          accent={accent}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <GlassInput
          label="Draft Date (UTC)"
          value={settings.draftDateUtc}
          onChange={(draftDateUtc) => patchBestBall({ draftDateUtc })}
          placeholder="2026-08-28T00:00:00.000Z"
          accent={accent}
          hint="Leave blank if the commissioner will schedule later."
        />
        <GlassInput
          label="Timezone"
          value={settings.timezone}
          onChange={(timezone) => {
            patchBestBall({ timezone })
            onChange({ timezone })
          }}
          placeholder="America/New_York"
          accent={accent}
        />
        <GlassSelect
          label="Language"
          value={settings.language === 'es' ? 'es' : 'en'}
          onChange={(language) => {
            patchBestBall({ language })
            onChange({ language })
          }}
          options={[
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Spanish' },
          ]}
          accent={accent}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <GlassInput
          label="Regular Season Length"
          value={String(settings.regularSeasonLength)}
          onChange={(regularSeasonLength) => patchBestBall({ regularSeasonLength: Math.max(1, Number.parseInt(regularSeasonLength || '0', 10) || profile.defaultRegularSeasonLength) })}
          accent={accent}
        />
        <GlassInput
          label="Playoff Teams"
          value={String(settings.playoffTeams)}
          onChange={(playoffTeams) => patchBestBall({ playoffTeams: Math.max(0, Number.parseInt(playoffTeams || '0', 10) || 0) })}
          accent={accent}
        />
        <GlassSelect
          label="Playoff Format"
          value={settings.playoffFormat}
          onChange={(playoffFormat) => patchBestBall({ playoffFormat })}
          options={[
            { value: 'bracket', label: 'Bracket' },
            { value: 'advancement', label: 'Advancement' },
            { value: 'none', label: 'No playoffs' },
          ]}
          accent={accent}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <GlassSelect
          label="Visibility"
          value={settings.visibility}
          onChange={(visibility) => patchBestBall({ visibility })}
          options={[
            { value: 'private', label: 'Private' },
            { value: 'public', label: 'Public' },
          ]}
          accent={accent}
        />
        <GlassSelect
          label="Monetization"
          value={settings.monetization}
          onChange={(monetization) => patchBestBall({ monetization })}
          options={[
            { value: 'free', label: 'Free' },
            { value: 'paid', label: 'Paid' },
          ]}
          accent={accent}
        />
      </div>

      <div className="mt-5 space-y-3">
        <Toggle
          checked={settings.waiversEnabled}
          onChange={(waiversEnabled) => patchBestBall({ waiversEnabled })}
          label="Waivers"
          description="Commissioner-controlled in standard mode. Underdog-style defaults this off."
          accent={accent}
        />
        <Toggle
          checked={settings.tradesEnabled}
          onChange={(tradesEnabled) => patchBestBall({ tradesEnabled })}
          label="Trades"
          description="Best Ball leagues can disable trades completely; underdog-style should keep this off."
          accent={accent}
        />
        <Toggle
          checked={settings.substitutionsEnabled}
          onChange={(substitutionsEnabled) => patchBestBall({ substitutionsEnabled })}
          label="Manual substitutions"
          description="Keep this off for true Best Ball. Turn it on only for intentional hybrid formats."
          accent={accent}
        />
        <Toggle
          checked={settings.contestStructure === 'sit_and_go'}
          onChange={(enabled) => patchBestBall({ contestStructure: enabled ? 'sit_and_go' : 'season_long', sitAndGoEnabled: enabled, podPlayEnabled: enabled })}
          label="Sit-and-go / pod mode"
          description="Small-pod Best Ball with commissioner-controlled pod size."
          accent={accent}
        />
        <Toggle
          checked={settings.contestStructure === 'tournament'}
          onChange={(enabled) => patchBestBall({ contestStructure: enabled ? 'tournament' : 'season_long', tournamentEnabled: enabled })}
          label="Tournament / advancement mode"
          description="Advance the top scoring teams through scheduled rounds to a final."
          accent={accent}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <GlassInput
          label="Pod Size"
          value={String(settings.podSize)}
          onChange={(podSize) => patchBestBall({ podSize: Math.max(2, Number.parseInt(podSize || '0', 10) || 12) })}
          accent={accent}
        />
        <GlassInput
          label="Advancement Rounds"
          value={String(settings.tournamentAdvancementRounds)}
          onChange={(tournamentAdvancementRounds) => patchBestBall({ tournamentAdvancementRounds: Math.max(0, Number.parseInt(tournamentAdvancementRounds || '0', 10) || 0) })}
          accent={accent}
        />
        <GlassInput label="Advancers per pod" value={String(settings.advancersPerPod ?? 1)}
          onChange={(value) => patchBestBall({ advancersPerPod: Math.max(1, Math.min(settings.podSize, Number(value) || 1)) })} accent={accent} />
        <GlassInput label="Round end weeks" value={(settings.roundEndWeeks ?? Array.from({ length: settings.tournamentAdvancementRounds + 1 }, (_, i) => settings.regularSeasonLength + i)).join(', ')}
          onChange={(value) => patchBestBall({ roundEndWeeks: value.split(',').map(part => Number(part.trim())) })} accent={accent}
          hint="One end week per round, in increasing order. The last round is the final." />
        <Toggle checked={settings.resetBetweenRounds ?? false} onChange={(resetBetweenRounds) => patchBestBall({ resetBetweenRounds })}
          label="Reset scores between rounds" description="Each new round ranks teams on that round's scores." accent={accent} />
        <GlassInput
          label="Slow Draft Clock (min)"
          value={settings.slowDraftClockMinutes == null ? '' : String(settings.slowDraftClockMinutes)}
          onChange={(slowDraftClockMinutes) => patchBestBall({ slowDraftClockMinutes: slowDraftClockMinutes.trim() ? Math.max(1, Number.parseInt(slowDraftClockMinutes || '0', 10) || 60) : null })}
          accent={accent}
          hint="Use this when the selected draft mode supports a slow clock."
        />
      </div>

      <InnerPanel className="mt-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">Sport Profile</p>
        <p className="text-sm text-white/85">{buildBestBallSettingsSummary(settings)}</p>
        <p className="text-xs text-white/45">
          {profile.label} Best Ball uses {profile.lineupSlots.reduce((sum, slot) => sum + slot.count, 0)} starter slots, a {profile.scoringPeriod} scoring cadence, and recommends {profile.recommendedRosterSize} total roster spots.
        </p>
        <ul className="space-y-1 text-xs text-white/50">
          {profile.notes.map((note) => (
            <li key={note}>- {note}</li>
          ))}
        </ul>
      </InnerPanel>
    </GlassCard>
  )
}
