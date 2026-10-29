import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  SURVIVOR_CAST_SIZE_OPTIONS,
  SURVIVOR_CREATE_CAST_SIZES,
  clampSurvivorCastSize,
} from '@/lib/league-creation-wizard/sport-team-limits'
import {
  getAllowedSportsForType,
  getDraftTypeOptions,
  getSurvivorTribeOptions,
  getTeamCountOptions,
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
    expect(m.fallback).toBe(SPORT_MEDIA.NFL.video)
    expect(m.fallback).toMatch(/\.mp4$/)
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

describe('Survivor NBA creation pilot and underlying sport catalog', () => {
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

  it('offers new NFL Survivor creation alongside NBA, with its draft and cast rules', () => {
    expect(isSportAllowedForType('NFL', 'survivor')).toBe(true)
    expect(isSportAllowedForType('NBA', 'survivor')).toBe(true)
    const opts = getDraftTypeOptions('survivor', 'NFL').map((o) => o.id)
    expect(opts).toContain('snake')
    // 29566580a (feat(survivor): add phase 1 foundation) deliberately widened the cast from
    // [16, 20, 24] to a contiguous 16-20 and did not update this assertion, leaving the file
    // red on main. The catalog is the authoritative side.
    // 2026-10-20: new leagues are offered 12–24 in the eight sizes that split into 2, 3 or 4
    // equal tribes; every offered size still survives the server clamp below.
    const survivorTeams = LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport.survivor?.NFL
    expect(survivorTeams).toEqual([12, 15, 16, 18, 20, 21, 22, 24])
    for (const size of survivorTeams ?? []) expect(SURVIVOR_CAST_SIZE_OPTIONS).toContain(size)
  })

  it('the pre-fetch fallback offers the same sizes as the catalog', () => {
    // getTeamCountOptions reads the catalog when it has loaded and a hardcoded list otherwise.
    // Those two disagreed, so Survivor offered different sizes depending on whether
    // /api/leagues/create-options had resolved.
    // Preseason, so every size still fits the NFL schedule (later in the season both paths drop
    // the sizes that no longer fit, identically).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-01T12:00:00Z') })
    try {
      const fromCatalog = getTeamCountOptions('NFL', 'survivor')
      setClientLeagueCreateOptionsCatalog(null)
      const fromFallback = getTeamCountOptions('NFL', 'survivor')
      expect(fromFallback).toEqual(fromCatalog)
      expect(fromFallback).toEqual([...SURVIVOR_CREATE_CAST_SIZES])
      vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
      const lateFallback = getTeamCountOptions('NFL', 'survivor')
      setClientLeagueCreateOptionsCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1)
      expect(getTeamCountOptions('NFL', 'survivor')).toEqual(lateFallback)
      expect(lateFallback).not.toContain(24)
    } finally { vi.useRealTimers() }
  })

  it('every offered cast size survives the server clamp unchanged, on BOTH resolution paths', () => {
    // POST /api/league/create runs clampSurvivorCastSize on submit. Offering a size the clamp
    // rewrites means the league is silently created at a different size than was picked —
    // which is exactly what the stale [16, 20, 24] fallback did with 24 (clamped to 20).
    //
    // Both paths have to be checked: asserting only the catalog path leaves the pre-fetch
    // fallback — the half that was actually wrong — completely uncovered.
    const paths = {
      catalog: () => setClientLeagueCreateOptionsCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1),
      'pre-fetch fallback': () => setClientLeagueCreateOptionsCatalog(null),
    }

    for (const [label, select] of Object.entries(paths)) {
      select()
      const offered = getTeamCountOptions('NFL', 'survivor')
      expect(offered.length, label).toBeGreaterThan(0)
      for (const size of offered) {
        expect(clampSurvivorCastSize(size), `${label}: cast size ${size}`).toBe(size)
      }
    }

    // Control: the clamp is doing something, so the loops above are not vacuous. 24 is a real
    // cast now, so the out-of-range probes sit beyond both ends of the list.
    expect(clampSurvivorCastSize(10)).toBe(12)
    expect(clampSurvivorCastSize(30)).toBe(24)
  })

  it('every offered Survivor cast size can pick a tribe count', () => {
    setClientLeagueCreateOptionsCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1)
    for (const teamCount of getTeamCountOptions('NFL', 'survivor')) {
      expect(getSurvivorTribeOptions(teamCount).length).toBeGreaterThan(0)
    }
  })

  it('the tribe fallback is additive — evenly divisible sizes are untouched', () => {
    const evenOnly = (n: number) => [2, 3, 4].filter((t) => n % t === 0)
    for (let n = 4; n <= 40; n += 1) {
      const old = evenOnly(n)
      if (old.length === 0) continue
      expect(getSurvivorTribeOptions(n)).toEqual(old)
    }
    // Only the previously-empty (prime) sizes gain options.
    expect(evenOnly(17)).toEqual([])
    expect(evenOnly(19)).toEqual([])
    expect(getSurvivorTribeOptions(17)).toEqual([2, 3, 4])
    expect(getSurvivorTribeOptions(19)).toEqual([2, 3, 4])
  })
})
