'use client'

import { useMemo } from 'react'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { SUPPORTED_SPORTS, getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import {
  getDefaultTeamCount,
  isIdpAvailableForSport,
  isSportAllowedForType,
  resolveValidDraftTypeForSelection,
  resolveValidScoringPresetIdForSelection,
} from '@/lib/create-league-v2/rules-engine'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import { GlassCard, SelectableCard, SectionHeader } from '@/components/create-league-v2/primitives'
import { LEAGUE_TYPE_MEDIA } from '@/lib/create-league-v2/theme'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { getClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'

export type LeagueConceptCard = {
  id: LeagueTypeId | 'idp'
  title: string
  subtitle: string
  icon: string
}

export const LEAGUE_CONCEPT_CARDS: LeagueConceptCard[] = [
  { id: 'redraft', title: 'Redraft', subtitle: 'Fresh draft every season', icon: '◆' },
  { id: 'dynasty', title: 'Dynasty', subtitle: 'Keep your core forever', icon: '♔' },
  { id: 'keeper', title: 'Keeper', subtitle: 'Hold a few, draft the rest', icon: '⬡' },
  { id: 'best_ball', title: 'Best Ball', subtitle: 'Set and forget', icon: '◉' },
  { id: 'idp', title: 'IDP', subtitle: 'Individual defensive players', icon: '🛡' },
  { id: 'salary_cap', title: 'Salary Cap', subtitle: 'Budget-based rosters', icon: '$' },
  { id: 'devy', title: 'Devy', subtitle: 'Draft college prospects', icon: '✦' },
  { id: 'c2c', title: 'C2C', subtitle: 'College to pros', icon: '⇄' },
  { id: 'guillotine', title: 'Guilly', subtitle: 'Lowest score is eliminated', icon: '✕' },
  { id: 'zombie', title: 'Zombie', subtitle: 'Infection-style survival', icon: '☣' },
  { id: 'survivor', title: 'Survivor', subtitle: 'Vote players off', icon: '⚑' },
  { id: 'tournament', title: 'Tournament', subtitle: 'Multi-league elimination event', icon: '⚔' },
  { id: 'big_brother', title: 'Big Brother', subtitle: 'Weekly nominations', icon: '◎' },
]

const LEAGUE_CONCEPT_ICONS: Record<string, string> = LEAGUE_CONCEPT_CARDS.reduce<Record<string, string>>((acc, card) => {
  acc[card.id] = card.icon
  return acc
}, {})

function localizedConceptCard(
  t: (key: string) => string,
  card: LeagueConceptCard,
): { title: string; subtitle: string } {
  const tk = `createLeague.concept.${card.id}.title`
  const sk = `createLeague.concept.${card.id}.subtitle`
  const tv = t(tk)
  const sv = t(sk)
  return {
    title: tv === tk ? card.title : tv,
    subtitle: sv === sk ? card.subtitle : sv,
  }
}

function isCardSelected(card: LeagueConceptCard, state: CreateLeagueV2State): boolean {
  if (card.id === 'idp') return state.idpSelected
  return state.leagueType === card.id && !state.idpSelected
}

export function ConceptSelector({
  state,
  accent,
  onChange,
  onConceptMediaFocus,
  error,
}: {
  state: CreateLeagueV2State
  accent: AccentTone
  onChange: (patch: Partial<CreateLeagueV2State>) => void
  /** Called when the user selects a league concept (hero should prioritize concept video). */
  onConceptMediaFocus?: () => void
  error?: string
}) {
  const { t } = useLanguage()
  const effectiveType = getEffectiveLeagueType(state)
  const conceptCards = useMemo(() => {
    const catalog = getClientLeagueCreateOptionsCatalog()
    if (!catalog?.concepts?.length) {
      return LEAGUE_CONCEPT_CARDS
    }

    const cards = catalog.concepts
      .filter((concept) => Boolean(LEAGUE_CONCEPT_ICONS[concept.id]))
      .map((concept) => ({
        id: concept.id as LeagueConceptCard['id'],
        title: concept.title,
        subtitle: concept.subtitle,
        icon: LEAGUE_CONCEPT_ICONS[concept.id] ?? '◆',
      }))

    return cards.length > 0 ? cards : LEAGUE_CONCEPT_CARDS
  }, [])

  function handleLeagueTypeSelect(card: LeagueConceptCard) {
    onConceptMediaFocus?.()
    const patch: Partial<CreateLeagueV2State> = {}
    let nextLeagueType: LeagueTypeId = card.id === 'idp' ? 'redraft' : card.id
    let nextIdpSelected = card.id === 'idp'
    let nextSport = state.sport
    let nextSoccerPipeline = state.soccerPipeline

    if (card.id === 'idp') {
      patch.idpSelected = true
      patch.leagueType = 'redraft'
      nextIdpSelected = true
      nextLeagueType = 'redraft'
      if (!isIdpAvailableForSport(state.sport)) {
        patch.sport = 'NFL'
        patch.soccerPipeline = null
        nextSport = 'NFL'
        nextSoccerPipeline = null
      }
    } else {
      const selectedLeagueType: LeagueTypeId = card.id
      patch.idpSelected = false
      patch.leagueType = selectedLeagueType
      nextIdpSelected = false
      nextLeagueType = selectedLeagueType
      if (!isSportAllowedForType(state.sport, selectedLeagueType)) {
        const fallback = SUPPORTED_SPORTS.find((s) => isSportAllowedForType(s, selectedLeagueType))
        if (fallback) {
          patch.sport = fallback
          patch.soccerPipeline = fallback === 'SOCCER' ? 'euro' : null
          nextSport = fallback
          nextSoccerPipeline = fallback === 'SOCCER' ? 'euro' : null
        }
      }
    }

    patch.draftType = resolveValidDraftTypeForSelection({
      leagueType: nextLeagueType,
      sport: nextSport,
      idpSelected: nextIdpSelected,
      currentDraftType: state.draftType,
    })

    const nextTeamCount = getDefaultTeamCount(nextSport as SupportedSport, nextLeagueType, nextSoccerPipeline)
    patch.teamCount = nextTeamCount
    if (nextLeagueType === 'tournament') {
      patch.tournamentPoolSize = nextTeamCount
    }
    patch.scoringPresetId = resolveValidScoringPresetIdForSelection(state.scoringPresetId, {
      leagueType: nextLeagueType,
      sport: nextSport as SupportedSport,
      idpSelected: nextIdpSelected,
    })
    patch.nameTouched = false
    onChange(patch)
  }

  return (
    <GlassCard>
      <SectionHeader
        title={t('createLeague.section.conceptTitle')}
        hint={t('createLeague.section.conceptHint')}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {conceptCards.map((card) => {
          const copy = localizedConceptCard(t, card)
          return (
            <SelectableCard
              key={card.id}
              selected={isCardSelected(card, state)}
              onClick={() => handleLeagueTypeSelect(card)}
              accent={accent}
              title={copy.title}
              subtitle={copy.subtitle}
              icon={card.icon}
              thumbnailSrc={card.id === 'idp' ? LEAGUE_TYPE_MEDIA.idp?.poster : LEAGUE_TYPE_MEDIA[card.id]?.poster}
            />
          )
        })}
      </div>
      {effectiveType ? (
        <p className="mt-4 text-[11px] text-white/35">
          Preview:{' '}
          <span className="text-white/55">
            {(state.idpSelected ? LEAGUE_TYPE_MEDIA.idp : LEAGUE_TYPE_MEDIA[effectiveType])?.video
              ? 'Video loop active for this concept.'
              : 'Gradient fallback.'}
          </span>
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-rose-300/90" role="alert">
          {error}
        </p>
      ) : null}
    </GlassCard>
  )
}
