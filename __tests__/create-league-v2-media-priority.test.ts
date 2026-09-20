import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCreateLeagueHeroMedia } from '@/lib/create-league-v2/media-priority'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'
import {
  resolveDraftIntroStemFromWizardId,
  resolveDraftIntroVideoUrl,
} from '@/lib/draft/draft-intro-video'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'
import { setClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import {
  SURVIVOR_CAST_SIZE_OPTIONS,
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
  it('returns packaged snake draft clip first', () => {
    expect(resolveDraftIntroVideoUrl('snake')).toBe('/media/create-league/drafts/videos/Snake Draft.mp4')
    expect(resolveDraftIntroVideoUrl('devy_snake')).toBe('/media/create-league/drafts/videos/Snake Draft.mp4')
  })

  it('returns shipped linear + auction clips', () => {
    expect(resolveDraftIntroVideoUrl('linear')).toBe('/media/create-league/drafts/videos/Linear Draft.mp4')
    expect(resolveDraftIntroVideoUrl('auction')).toBe('/media/create-league/drafts/videos/Auction Draft.mp4')
  })

  it('returns null for stems without shipped assets (no crash)', () => {
    expect(resolveDraftIntroVideoUrl('slow_draft')).toBeNull()
    expect(resolveDraftIntroVideoUrl('mock_draft')).toBeNull()
  })

  it('getDraftTypeMedia wires selectionVideo from resolver', () => {
    const linear = getDraftTypeMedia('linear')
    expect(linear.selectionVideo).toBe('/media/create-league/drafts/videos/Linear Draft.mp4')
    const snake = getDraftTypeMedia('snake')
    expect(snake.selectionVideo).toBe('/media/create-league/drafts/videos/Snake Draft.mp4')
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
    // 29566580a (feat(survivor): add phase 1 foundation) deliberately widened the cast from
    // [16, 20, 24] to a contiguous 16-20 and did not update this assertion, leaving the file
    // red on main. The catalog is the authoritative side.
    const survivorTeams = LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport.survivor?.NFL
    expect(survivorTeams).toEqual([16, 17, 18, 19, 20])
  })

  it('the pre-fetch fallback offers the same sizes as the catalog', () => {
    // getTeamCountOptions reads the catalog when it has loaded and a hardcoded list otherwise.
    // Those two disagreed, so Survivor offered different sizes depending on whether
    // /api/leagues/create-options had resolved.
    const fromCatalog = getTeamCountOptions('NFL', 'survivor')
    setClientLeagueCreateOptionsCatalog(null)
    const fromFallback = getTeamCountOptions('NFL', 'survivor')
    expect(fromFallback).toEqual(fromCatalog)
    expect(fromFallback).toEqual([...SURVIVOR_CAST_SIZE_OPTIONS])
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

    // Control: the clamp is doing something, so the loops above are not vacuous.
    expect(clampSurvivorCastSize(24)).toBe(20)
    expect(clampSurvivorCastSize(30)).toBe(20)
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
