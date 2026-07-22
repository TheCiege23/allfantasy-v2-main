'use client'

/**
 * Page 1 — League Setup.
 *
 * Collects: leagueType, sport, teamCount, survivor tribe count (conditional),
 * draftType, 3RR toggle (snake only). Every selection retunes the accent.
 * IDP is a 13th card that sets a modifier flag (not a format ID).
 */

import { useMemo, useRef } from 'react'
import type { LeagueTypeId, DraftTypeId } from '@/lib/league-creation-wizard/types'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State, SupportedSport, SoccerPipeline } from '@/lib/create-league-v2/state'
import { SUPPORTED_SPORTS, TOURNAMENT_POOL_SIZE_OPTIONS } from '@/lib/create-league-v2/state'
import {
  isSportAllowedForType,
  getTeamCountOptions,
  getDefaultTeamCount,
  getDraftTypeOptions,
  getIdpDraftTypeOptions,
  isDraftTypeAllowedForType,
  isIdpDraftTypeAllowed,
  getSurvivorTribeOptions,
  isThirdRoundReversalAvailable,
  isIdpAvailableForSport,
} from '@/lib/create-league-v2/rules-engine'
import {
  GlassCard,
  PillRow,
  SectionHeader,
  SelectableCard,
  Toggle,
  Segmented,
} from './primitives'

// ── League type cards (12 format IDs + IDP pseudo-card) ─────────────

type LeagueTypeCard = {
  id: LeagueTypeId | 'idp'
  title: string
  subtitle: string
  icon: string
}

const LEAGUE_TYPES: LeagueTypeCard[] = [
  { id: 'redraft', title: 'Redraft', subtitle: 'Fresh draft every season', icon: '◆' },
  { id: 'dynasty', title: 'Dynasty', subtitle: 'Keep your core forever', icon: '♔' },
  { id: 'keeper', title: 'Keeper', subtitle: 'Hold a few, draft the rest', icon: '⬡' },
  { id: 'best_ball', title: 'Best Ball', subtitle: 'Set and forget', icon: '◉' },
  { id: 'idp', title: 'IDP', subtitle: 'Individual defensive players', icon: '🛡' },
  { id: 'salary_cap', title: 'Salary Cap', subtitle: 'Budget-based rosters', icon: '$' },
  { id: 'devy', title: 'Devy', subtitle: 'Draft college prospects', icon: '✦' },
  { id: 'c2c', title: 'C2C', subtitle: 'College to pros', icon: '⇄' },
  { id: 'guillotine', title: 'Guillotine', subtitle: 'Lowest score is eliminated', icon: '✕' },
  { id: 'zombie', title: 'Zombie', subtitle: 'Infection-style survival', icon: '☣' },
  { id: 'survivor', title: 'Survivor', subtitle: 'Vote players off', icon: '⚑' },
  { id: 'big_brother', title: 'Big Brother', subtitle: 'Weekly nominations', icon: '◎' },
]

// ── Sport display config ────────────────────────────────────────────

const SPORT_ICONS: Record<SupportedSport, string> = {
  NFL: '🏈',
  NBA: '🏀',
  MLB: '⚾',
  NHL: '🏒',
  NCAAF: '🏟',
  NCAAB: '🎓',
  SOCCER: '⚽',
}

const SPORT_LABELS: Record<SupportedSport, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'NCAAF',
  NCAAB: 'NCAAB',
  SOCCER: 'Soccer',
}

// ── Helpers ─────────────────────────────────────────────────────────

function isCardSelected(card: LeagueTypeCard, state: CreateLeagueV2State): boolean {
  if (card.id === 'idp') return state.idpSelected
  return state.leagueType === card.id && !state.idpSelected
}

function resolveEffectiveLeagueType(state: CreateLeagueV2State): LeagueTypeId {
  if (state.idpSelected) return 'redraft'
  return state.leagueType ?? 'redraft'
}

// ── Video preview components ────────────────────────────────────────

function LeagueTypeHeroVideo({ leagueType, accent }: { leagueType: string; accent: AccentTone }) {
  const media = LEAGUE_TYPE_MEDIA[leagueType] ?? LEAGUE_TYPE_MEDIA.redraft
  const videoRef = useRef<HTMLVideoElement | null>(null)
  return (
    <div
      className="relative mt-5 overflow-hidden rounded-2xl border border-white/[0.08]"
      style={{ boxShadow: `0 0 40px -16px ${accent.hex}` }}
    >
      <video
        ref={videoRef}
        key={media.video}
        className="block h-48 w-full object-cover sm:h-56"
        src={media.video}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        onError={() => {
          const el = videoRef.current
          if (!el) return
          if (media.fallback && el.src !== window.location.origin + media.fallback) {
            el.src = media.fallback
            el.load()
          }
        }}
      />
      {/* accent-tinted bottom fade */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{ background: `linear-gradient(to top, ${accent.hex}55 0%, transparent 100%)` }}
        aria-hidden
      />
    </div>
  )
}

function SportPreviewVideo({ sport, label, accent }: { sport: string; label: string; accent: AccentTone }) {
  const media = SPORT_MEDIA[sport] ?? SPORT_MEDIA.NFL
  const videoRef = useRef<HTMLVideoElement | null>(null)
  return (
    <div
      className="relative mt-5 overflow-hidden rounded-2xl border border-white/[0.08]"
      style={{ boxShadow: `0 0 32px -16px ${accent.hex}` }}
    >
      <video
        ref={videoRef}
        key={media.video}
        className="block h-40 w-full object-cover sm:h-48"
        src={media.video}
        poster={media.poster}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        onError={() => {
          const el = videoRef.current
          if (!el || !media.fallback) return
          el.poster = media.fallback
        }}
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/85 backdrop-blur-md">
        {label}
      </div>
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────────

export interface Page1SetupProps {
  state: CreateLeagueV2State
  accent: AccentTone
  onChange: (patch: Partial<CreateLeagueV2State>) => void
}

export function Page1Setup({ state, accent, onChange }: Page1SetupProps) {
  const effectiveType = resolveEffectiveLeagueType(state)
  const teamCountOptions = useMemo(
    () => getTeamCountOptions(state.sport, effectiveType, state.soccerPipeline),
    [state.sport, effectiveType, state.soccerPipeline]
  )
  const draftOptions = useMemo(
    () => (state.idpSelected ? getIdpDraftTypeOptions() : getDraftTypeOptions(effectiveType, state.sport)),
    [effectiveType, state.sport, state.idpSelected]
  )
  const survivorTribes = useMemo(() => getSurvivorTribeOptions(state.teamCount), [state.teamCount])
  const isSnake =
    state.draftType === 'snake' ||
    state.draftType === 'devy_snake' ||
    state.draftType === 'c2c_snake' ||
    state.draftType === 'slow_draft' ||
    state.draftType === 'mock_draft'
  const isTournament = effectiveType === 'tournament'
  const isSurvivor = effectiveType === 'survivor'
  const isSoccer = state.sport === 'SOCCER'

  function handleLeagueTypeSelect(card: LeagueTypeCard) {
    const patch: Partial<CreateLeagueV2State> = {}

    if (card.id === 'idp') {
      // IDP: set modifier flag, keep leagueType as redraft, snap to first supported IDP sport if needed.
      patch.idpSelected = true
      patch.leagueType = 'redraft'
      if (!isIdpAvailableForSport(state.sport)) {
        patch.sport =
          (SUPPORTED_SPORTS.find((candidate) => isIdpAvailableForSport(candidate)) as SupportedSport | undefined) ??
          'NFL'
        patch.soccerPipeline = null
      }
    } else {
      const selectedLeagueType: LeagueTypeId = card.id
      patch.idpSelected = false
      patch.leagueType = selectedLeagueType
      // Snap sport if not allowed for new type
      if (!isSportAllowedForType(state.sport, selectedLeagueType)) {
        const fallback = SUPPORTED_SPORTS.find((s) => isSportAllowedForType(s, selectedLeagueType))
        if (fallback) {
          patch.sport = fallback
          patch.soccerPipeline = fallback === 'SOCCER' ? 'euro' : null
        }
      }
    }

    // Snap draft type if not allowed
    const nextType = card.id === 'idp' ? 'redraft' : card.id
    const draftAllowed =
      card.id === 'idp' ? isIdpDraftTypeAllowed(state.draftType) : isDraftTypeAllowedForType(state.draftType, nextType)
    if (!draftAllowed) {
      const firstAllowed = card.id === 'idp' ? getIdpDraftTypeOptions() : getDraftTypeOptions(nextType)
      patch.draftType = firstAllowed[0]?.id ?? 'snake'
    }

    // Reset team count to default for new type
    const nextSport = (patch.sport ?? state.sport) as SupportedSport
    const nextPipeline = patch.soccerPipeline ?? state.soccerPipeline
    patch.teamCount = getDefaultTeamCount(nextSport, nextType, nextPipeline)

    onChange(patch)
  }

  function handleSportChange(sport: SupportedSport) {
    const patch: Partial<CreateLeagueV2State> = { sport }
    // Reset soccer pipeline
    patch.soccerPipeline = sport === 'SOCCER' ? 'euro' : null
    // IDP is only available for supported football sports.
    if (state.idpSelected && !isIdpAvailableForSport(sport)) {
      patch.idpSelected = false
    }
    // Reset team count for new sport (respecting the new pipeline)
    patch.teamCount = getDefaultTeamCount(sport, effectiveType, patch.soccerPipeline)
    onChange(patch)
  }

  return (
    <div className="space-y-4">
      {/* League Type */}
      <GlassCard>
        <SectionHeader
          title="League Type"
          hint="Each type tunes the AI host, draft rules, and scoring presets."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {LEAGUE_TYPES.map((card) => {
            const disabled = card.id === 'idp' ? false : undefined
            return (
              <SelectableCard
                key={card.id}
                selected={isCardSelected(card, state)}
                disabled={disabled}
                onClick={() => handleLeagueTypeSelect(card)}
                accent={accent}
                title={card.title}
                subtitle={card.subtitle}
                icon={card.icon}
              />
            )
          })}
        </div>

        {/* League type hero video */}
        <LeagueTypeHeroVideo
          leagueType={state.idpSelected ? 'idp' : state.leagueType ?? 'redraft'}
          accent={accent}
        />
      </GlassCard>

      {/* Sport */}
      <GlassCard>
        <SectionHeader title="Sport" hint="Filters team counts, scoring presets, and roster shape." />
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {SUPPORTED_SPORTS.map((sport) => {
            const disabled = state.idpSelected
              ? !isIdpAvailableForSport(sport)
              : !isSportAllowedForType(sport, effectiveType)
            return (
              <SelectableCard
                key={sport}
                selected={state.sport === sport}
                disabled={disabled}
                onClick={() => handleSportChange(sport)}
                accent={accent}
                title={SPORT_LABELS[sport]}
                icon={<span className="text-lg">{SPORT_ICONS[sport]}</span>}
              />
            )
          })}
        </div>

        {/* Sport ambient loop */}
        <SportPreviewVideo sport={state.sport} label={SPORT_LABELS[state.sport]} accent={accent} />
      </GlassCard>

      {/* Soccer pipeline selector */}
      {isSoccer && (
        <GlassCard>
          <SectionHeader title="Soccer Region" hint="MLS uses North American data; European uses top-5 league data." />
          <Segmented
            options={[
              { value: 'mls' as const, label: 'MLS', hint: 'North America' },
              { value: 'euro' as const, label: 'European', hint: 'Top 5 leagues' },
            ]}
            value={state.soccerPipeline ?? 'euro'}
            onChange={(v) => {
              const nextPipeline = v as SoccerPipeline
              const patch: Partial<CreateLeagueV2State> = { soccerPipeline: nextPipeline }
              // If current team count exceeds the new pipeline's cap, clamp to the new default.
              const max = nextPipeline === 'euro' ? 96 : 30
              if (state.teamCount > max) {
                patch.teamCount = getDefaultTeamCount('SOCCER', effectiveType, nextPipeline)
              }
              onChange(patch)
            }}
            accent={accent}
            ariaLabel="Soccer data region"
          />
        </GlassCard>
      )}

      {/* Team count / Tournament pool size */}
      <GlassCard>
        <SectionHeader
          title={isTournament ? 'Tournament Size' : 'Team Count'}
          hint={
            isTournament
              ? 'Total managers across all feeder leagues (each feeder = 12 teams).'
              : `${SPORT_LABELS[state.sport]} supports ${teamCountOptions[0]}–${teamCountOptions[teamCountOptions.length - 1]} teams.`
          }
        />
        {isTournament ? (
          <>
            <PillRow
              options={[...TOURNAMENT_POOL_SIZE_OPTIONS]}
              value={state.tournamentPoolSize}
              onChange={(tournamentPoolSize) => onChange({ tournamentPoolSize })}
              accent={accent}
              ariaLabel="Tournament size"
            />
            <p className="mt-3 text-[11px] text-white/40">
              {state.tournamentPoolSize} managers = {Math.floor(state.tournamentPoolSize / 12)} feeder leagues of 12 teams each.
            </p>
          </>
        ) : (
          <PillRow
            options={teamCountOptions}
            value={state.teamCount}
            onChange={(teamCount) => onChange({ teamCount })}
            accent={accent}
            ariaLabel="Number of teams"
          />
        )}
      </GlassCard>

      {/* Survivor tribes */}
      {isSurvivor && (
        <GlassCard>
          <SectionHeader
            title="Starting Tribes"
            hint="How many tribes split the cast before the merge."
          />
          <PillRow
            options={survivorTribes}
            value={survivorTribes.includes(state.survivorTribeCount) ? state.survivorTribeCount : survivorTribes[0] ?? 2}
            onChange={(survivorTribeCount) => onChange({ survivorTribeCount })}
            accent={accent}
            ariaLabel="Survivor tribe count"
          />
          <p className="mt-3 text-[11px] text-white/40">
            Tribes shuffle automatically at the merge week (configurable after league creation).
          </p>
        </GlassCard>
      )}

      {/* Draft type + 3RR */}
      <GlassCard>
        <SectionHeader title="Draft Format" hint="Choose how picks are distributed." />
        <Segmented
          options={draftOptions.map((dt) => ({
            value: dt.id,
            label: dt.label,
            hint: dt.hint,
          }))}
          value={
            state.idpSelected
              ? isIdpDraftTypeAllowed(state.draftType)
                ? state.draftType
                : draftOptions[0]?.id ?? 'snake'
              : isDraftTypeAllowedForType(state.draftType, effectiveType)
                ? state.draftType
                : draftOptions[0]?.id ?? 'snake'
          }
          onChange={(draftType) => onChange({ draftType })}
          accent={accent}
          ariaLabel="Draft type"
        />
        {isThirdRoundReversalAvailable(state.draftType) && (
          <div className="mt-4">
            <Toggle
              checked={state.thirdRoundReversal && isSnake}
              onChange={(v) => onChange({ thirdRoundReversal: v })}
              label="Third Round Reversal"
              description="Reverse the snake a second time in round 3 — softens the edge for late 1st-round picks."
              accent={accent}
            />
          </div>
        )}
      </GlassCard>
    </div>
  )
}
