/**
 * Resolves hero / background video for Create League v2.
 * Order depends on `focus`: concept vs sport vs draft selection drives which clip is tried first.
 * If the focused tier has no video, falls through: concept → sport → draft (each skipped when empty).
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA, type MediaAsset } from '@/lib/create-league-v2/theme'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'
import type { WizardDraftType } from '@/lib/create-league-v2/state'
import { resolveEffectiveDraftType } from '@/lib/create-league-v2/rules-engine'

export type HeroMediaFocus = 'concept' | 'draft' | 'sport'

export type ResolvedCreateLeagueMedia = MediaAsset & {
  /** Stable key for React video remount / crossfade */
  mediaKey: string
  badge?: string
}

function asMediaFromDraft(base: string, fallback: string): MediaAsset {
  return { video: base, fallback }
}

function hasPlayableVideo(asset: MediaAsset | undefined): boolean {
  return Boolean(asset?.video?.trim())
}

const FALLBACK_MEDIA: ResolvedCreateLeagueMedia = {
  video: SPORT_MEDIA.NFL.video,
  poster: SPORT_MEDIA.NFL.poster,
  fallback: SPORT_MEDIA.NFL.fallback,
  mediaKey: 'fallback:sport',
}

const ORDER_BY_FOCUS: Record<HeroMediaFocus, Array<'concept' | 'sport' | 'draft'>> = {
  concept: ['concept', 'sport', 'draft'],
  sport: ['sport', 'concept', 'draft'],
  draft: ['draft', 'concept', 'sport'],
}

/**
 * Hero media resolution with explicit UI focus.
 * `draftEmphasis` is kept for analytics / future use; it does not override priority order.
 */
export function resolveCreateLeagueHeroMedia(args: {
  leagueType: LeagueTypeId
  sport: SupportedSport
  draftType: WizardDraftType
  idpSelected: boolean
  /** Kept for callers (scroll/draft section visibility); does not change priority order. */
  draftEmphasis: boolean
  focus: HeroMediaFocus
}): ResolvedCreateLeagueMedia {
  void args.draftEmphasis

  const conceptKey = args.idpSelected ? 'idp' : args.leagueType
  const conceptBase = LEAGUE_TYPE_MEDIA[conceptKey] ?? LEAGUE_TYPE_MEDIA.redraft

  const effective = resolveEffectiveDraftType(args.leagueType, args.draftType)
  const draftRow = getDraftTypeMedia(effective as import('@/lib/league-creation-wizard/types').DraftTypeId)
  const sportBase = SPORT_MEDIA[args.sport] ?? SPORT_MEDIA.NFL
  const draftClip = asMediaFromDraft(draftRow.selectionVideo, sportBase.video)

  const conceptResolved: ResolvedCreateLeagueMedia | null = hasPlayableVideo(conceptBase)
    ? {
        ...conceptBase,
        mediaKey: `concept:${conceptKey}`,
        badge: undefined,
      }
    : null

  const sportResolved: ResolvedCreateLeagueMedia | null = hasPlayableVideo(sportBase)
    ? {
        ...sportBase,
        mediaKey: `sport:${args.sport}`,
        badge: undefined,
      }
    : null

  const draftResolved: ResolvedCreateLeagueMedia | null = hasPlayableVideo(draftClip)
    ? {
        ...draftClip,
        mediaKey: `draft:${effective}`,
        poster: draftRow.thumbnail,
        badge: 'Draft format',
      }
    : null

  const buckets = {
    concept: conceptResolved,
    sport: sportResolved,
    draft: draftResolved,
  }

  const order = ORDER_BY_FOCUS[args.focus] ?? ORDER_BY_FOCUS.concept

  for (const tier of order) {
    const pick = buckets[tier]
    if (pick) return pick
  }

  return FALLBACK_MEDIA
}
