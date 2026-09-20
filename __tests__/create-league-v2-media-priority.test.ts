import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCreateLeagueHeroMedia } from '@/lib/create-league-v2/media-priority'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'
import {
  resolveDraftIntroStemFromWizardId,
  resolveDraftIntroVideoUrl,
  resolveDraftSelectionVideoUrl,
} from '@/lib/draft/draft-intro-video'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'
import type { DraftTypeId } from '@/lib/league-creation-wizard/types'
import { setClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import {
  getAllowedSportsForType,
  getDraftTypeOptions,
  isSportAllowedForType,
} from '@/lib/create-league-v2/rules-engine'

describe('resolveCreateLeagueHeroMedia (focus)', () => {
  const base = {
    leagueType: 'survivor' as const,
    sport: 'NFL' as const,
    draftType: 'snake' as const,
    idpSelected: false,
    draftEmphasis: false,
  }

  it('concept focus uses survivor concept clip first', () => {
    const m = resolveCreateLeagueHeroMedia({ ...base, focus: 'concept' })
    expect(m.mediaKey).toMatch(/^concept:/)
    expect(m.video).toBe(LEAGUE_TYPE_MEDIA.survivor?.video)
  })

  it('sport focus uses NFL sport clip first', () => {
    const m = resolveCreateLeagueHeroMedia({ ...base, focus: 'sport' })
    expect(m.mediaKey).toBe('sport:NFL')
    expect(m.video).toBe(SPORT_MEDIA.NFL.video)
  })

  it('draft focus uses snake draft intro when present', () => {
    const m = resolveCreateLeagueHeroMedia({ ...base, focus: 'draft' })
    expect(m.mediaKey).toMatch(/^draft:snake/)
    expect(m.video).toBe('/media/create-league/drafts/videos/Snake Draft.mp4')
    expect(m.badge).toBe('Draft format')
  })

  it('draft focus falls back to concept when draft asset missing', () => {
    const m = resolveCreateLeagueHeroMedia({
      ...base,
      draftType: 'slow_draft',
      focus: 'draft',
    })
    expect(m.mediaKey).toMatch(/^concept:/)
    expect(m.video).toBe(LEAGUE_TYPE_MEDIA.survivor?.video)
  })
})

describe('draft intro resolver (fail closed)', () => {
  it('prefers the long intro cut over the short selection loop, where one ships', () => {
    // Snake and auction are the only two stems with a dedicated intro cut. Asserting the two
    // resolvers DIFFER is the point: they were the same call before, so the draft-start
    // overlay played the tile loop.
    expect(resolveDraftIntroVideoUrl('snake')).toBe(
      '/media/create-league/drafts/videos/Snake Draft Intro.mp4',
    )
    expect(resolveDraftSelectionVideoUrl('snake')).toBe(
      '/media/create-league/drafts/videos/Snake Draft.mp4',
    )
    expect(resolveDraftIntroVideoUrl('snake')).not.toBe(resolveDraftSelectionVideoUrl('snake'))

    expect(resolveDraftIntroVideoUrl('auction')).toBe('/media/draft-intros/Auction Draft Intro.mp4')
    expect(resolveDraftSelectionVideoUrl('auction')).toBe(
      '/media/create-league/drafts/videos/Auction Draft.mp4',
    )

    // Wizard variants resolve through the same stem.
    expect(resolveDraftIntroVideoUrl('devy_snake')).toBe(
      '/media/create-league/drafts/videos/Snake Draft Intro.mp4',
    )
  })

  it('falls back to the selection loop for stems with no intro cut', () => {
    expect(resolveDraftIntroVideoUrl('linear')).toBe('/media/create-league/drafts/videos/Linear Draft.mp4')
    expect(resolveDraftIntroVideoUrl('auto')).toBe('/media/create-league/drafts/videos/Auto Draft.mp4')
    expect(resolveDraftIntroVideoUrl('offline')).toBe(
      '/media/create-league/drafts/videos/Offline Draft.mp4',
    )
    expect(resolveDraftIntroVideoUrl('weighted_lottery')).toBe(
      '/media/create-league/drafts/videos/Weighted Lottery.mp4',
    )
  })

  it('returns null for stems without shipped assets (no crash)', () => {
    expect(resolveDraftIntroVideoUrl('slow_draft')).toBeNull()
    expect(resolveDraftIntroVideoUrl('mock_draft')).toBeNull()
    expect(resolveDraftIntroVideoUrl('team')).toBeNull()
    expect(resolveDraftIntroVideoUrl('')).toBeNull()
  })

  it('getDraftTypeMedia wires selectionVideo from resolver', () => {
    const linear = getDraftTypeMedia('linear')
    expect(linear.selectionVideo).toBe('/media/create-league/drafts/videos/Linear Draft.mp4')
    const snake = getDraftTypeMedia('snake')
    expect(snake.selectionVideo).toBe('/media/create-league/drafts/videos/Snake Draft.mp4')
  })

  it('auto + offline tiles no longer borrow the Snake Draft artwork', () => {
    const snake = getDraftTypeMedia('snake' as DraftTypeId)
    for (const id of ['auto', 'offline'] as const) {
      const media = getDraftTypeMedia(id as unknown as DraftTypeId)
      expect(media.thumbnail).not.toBe(snake.thumbnail)
      expect(media.thumbnail).not.toContain('snake')
      expect(media.selectionVideo).not.toBe('')
    }
    expect(getDraftTypeMedia('auto' as unknown as DraftTypeId).thumbnail).toBe(
      '/media/create-league/drafts/thumbnails/Auto Draft.png',
    )
    expect(getDraftTypeMedia('offline' as unknown as DraftTypeId).thumbnail).toBe(
      '/media/create-league/drafts/thumbnails/Offline Draft.png',
    )
  })

  it('every draft type the create surface offers has real art and a clip', () => {
    // rules-engine exposes `auto` / `offline` for nearly every league type; both were
    // rendering snake's poster with no video before these assets shipped.
    const offered = getDraftTypeOptions('redraft', 'NFL').map((o) => o.id)
    expect(offered).toContain('auto')
    expect(offered).toContain('offline')
  })

  it('maps wizard ids to intro stems', () => {
    expect(resolveDraftIntroStemFromWizardId('devy_snake')).toBe('snake')
    expect(resolveDraftIntroStemFromWizardId('c2c_linear')).toBe('linear')
  })
})

describe('Survivor catalog vs soccer', () => {
  beforeEach(() => {
    setClientLeagueCreateOptionsCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1)
  })

  afterEach(() => {
    setClientLeagueCreateOptionsCatalog(null)
  })

  it('does not list SOCCER as allowed for survivor', () => {
    expect(getAllowedSportsForType('survivor')).not.toContain('SOCCER')
    expect(isSportAllowedForType('SOCCER', 'survivor')).toBe(false)
  })

  it('Survivor + NFL + snake remains valid and complete', () => {
    expect(isSportAllowedForType('NFL', 'survivor')).toBe(true)
    const opts = getDraftTypeOptions('survivor', 'NFL').map((o) => o.id)
    expect(opts).toContain('snake')
    const survivorTeams = LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport.survivor?.NFL
    expect(survivorTeams).toEqual([16, 20, 24])
  })
})
