import { describe, expect, it } from 'vitest'
import { getFormatIntroMetadata } from '@/lib/league/format-engine'
import {
  getLeagueTypeMedia,
  resolveLeagueCardTypeKey,
  resolveLeagueConceptIntroKey,
} from '@/lib/league-media/leagueTypeMedia'
import { resolveLeagueIntroFormatKey } from '@/lib/league/resolveLeagueIntroFormatKey'
import {
  resolveDraftBoardImageUrl,
  resolveDraftIntroPosterUrl,
  resolveDraftIntroVideoUrl,
} from '@/lib/draft/draft-intro-video'

describe('resolveLeagueIntroFormatKey', () => {
  it('prefers Prisma leagueType column over settings', () => {
    expect(
      resolveLeagueIntroFormatKey({
        leagueTypeColumn: 'redraft',
        settings: { league_type: 'guillotine' },
      }),
    ).toBe('redraft')
  })

  it('reads settings.league_type when column is empty', () => {
    expect(
      resolveLeagueIntroFormatKey({
        leagueTypeColumn: null,
        settings: { league_type: 'dynasty' },
      }),
    ).toBe('dynasty')
  })

  it('reads settings.leagueType (camelCase) when column is empty', () => {
    expect(
      resolveLeagueIntroFormatKey({
        leagueTypeColumn: undefined,
        settings: { leagueType: 'keeper' },
      }),
    ).toBe('keeper')
  })

  it('does not treat leagueVariant-like strings in settings as substring matches — exact keys only', () => {
    expect(
      resolveLeagueIntroFormatKey({
        leagueTypeColumn: null,
        settings: { league_type: 'guillotine_redraft' },
      }),
    ).toBe('guillotine_redraft')
  })

  it('returns undefined when no column or settings format key', () => {
    expect(
      resolveLeagueIntroFormatKey({
        leagueTypeColumn: null,
        settings: {},
      }),
    ).toBeUndefined()
  })
})

describe('league type media (poster / video assets)', () => {
  it('redraft uses redraft intro + redraft art, not guillotine or another format’s image', () => {
    const m = getLeagueTypeMedia('redraft')
    expect(m.introVideo).toBe('/media/league-intros/redraft-league-intro.mp4')
    expect(m.thumbnail).toBe('/images/league-types/redraft.png')
    expect(m.defaultLeagueImageUrl).toBe('/images/league-types/redraft.png')
    expect(m.thumbnail).not.toMatch(/guillotine/i)
  })

  it('guillotine uses guillotine poster and intro', () => {
    const m = getLeagueTypeMedia('guillotine')
    expect(m.thumbnail).toBe('/league-type-guillotine.png')
    expect(m.introVideo).toBe('/league-type-guillotine-intro.mp4')
  })

  it('dynasty uses dynasty poster', () => {
    expect(getLeagueTypeMedia('dynasty').thumbnail).toBe('/league-type-dynasty.png')
  })

  it('unknown key falls back to redraft media bundle (neutral poster)', () => {
    const m = getLeagueTypeMedia('definitely_not_a_format')
    expect(m.key).toBe('definitely_not_a_format')
    expect(m.introVideo).toBe('/media/league-intros/redraft-league-intro.mp4')
    expect(m.thumbnail).toBe('/images/league-types/redraft.png')
  })
})

describe('intro video selection via getFormatIntroMetadata', () => {
  it('redraft league uses redraft intro even when leagueVariant is guillotine (modifier misuse)', () => {
    const meta = getFormatIntroMetadata({
      sport: 'NFL',
      leagueType: resolveLeagueIntroFormatKey({
        leagueTypeColumn: 'redraft',
        settings: {},
      }),
      leagueVariant: 'guillotine',
    })
    expect(meta.introVideo).toBe('/media/league-intros/redraft-league-intro.mp4')
    expect(meta.thumbnail).toBe('/images/league-types/redraft.png')
    expect(meta.title).toContain('Redraft')
  })

  it('guillotine league uses guillotine intro', () => {
    const meta = getFormatIntroMetadata({
      sport: 'NFL',
      leagueType: 'guillotine',
      leagueVariant: null,
    })
    expect(meta.introVideo).toBe('/league-type-guillotine-intro.mp4')
    expect(meta.thumbnail).toBe('/league-type-guillotine.png')
  })

  it('dynasty league uses dynasty intro', () => {
    const meta = getFormatIntroMetadata({
      sport: 'NFL',
      leagueType: 'dynasty',
      leagueVariant: null,
    })
    expect(meta.introVideo).toBe('/league-type-dynasty-intro.mp4')
  })

  it('redraft + scoring-like variant does not switch to guillotine intro', () => {
    const meta = getFormatIntroMetadata({
      sport: 'NFL',
      leagueType: resolveLeagueIntroFormatKey({
        leagueTypeColumn: 'redraft',
        settings: { scoring_format: 'ppr' },
      }),
      leagueVariant: 'fb_half_ppr',
    })
    expect(meta.introVideo).toBe('/media/league-intros/redraft-league-intro.mp4')
  })

  it('unknown intro format key falls back to redraft media', () => {
    const meta = getFormatIntroMetadata({
      sport: 'NFL',
      leagueType: resolveLeagueIntroFormatKey({
        leagueTypeColumn: null,
        settings: {},
      }),
    })
    expect(meta.introVideo).toBe('/media/league-intros/redraft-league-intro.mp4')
    expect(meta.thumbnail).toBe('/images/league-types/redraft.png')
  })
})

describe('canonical concept / draft media resolution', () => {
  it('resolveLeagueConceptIntroKey: redraft column beats guillotine variant', () => {
    expect(
      resolveLeagueConceptIntroKey({
        leagueType: 'redraft',
        leagueVariant: 'guillotine',
        settings: {},
        isDynasty: false,
      }),
    ).toBe('redraft')
  })

  it('resolveLeagueCardTypeKey: My Leagues fallback art for redraft is redraft.png path', () => {
    const url = getLeagueTypeMedia(
      resolveLeagueCardTypeKey({
        leagueType: 'redraft',
        leagueVariant: 'guillotine',
        settings: {},
        isDynasty: false,
      }),
    ).defaultLeagueImageUrl
    expect(url).toBe('/images/league-types/redraft.png')
    expect(url).not.toMatch(/guillotine/i)
  })

  it('snake draft intro + board image paths', () => {
    // The draft-START overlay plays the long intro cut, not the short tile loop
    // (`Snake Draft.mp4`), which is what it used to serve.
    expect(resolveDraftIntroVideoUrl('snake')).toBe(
      '/media/create-league/drafts/videos/Snake Draft Intro.mp4',
    )
    expect(resolveDraftIntroPosterUrl('snake')).toBe('/images/draft-types/snake-draft.png')
    expect(resolveDraftBoardImageUrl('snake')).toBe('/images/draft-types/snake-draft.png')
  })

  it('never serves the mislabeled snake-draft-intro.mp4 (it is the redraft league intro)', () => {
    for (const id of ['snake', 'devy_snake', 'c2c_snake', 'third_round_reversal']) {
      expect(resolveDraftIntroVideoUrl(id)).not.toContain('draft-intros/snake-draft-intro')
    }
  })

  it('redraft media paths never contain guillotine segment', () => {
    const m = getLeagueTypeMedia('redraft')
    const s = `${m.introVideo}${m.thumbnail}${m.defaultLeagueImageUrl}`
    expect(s.toLowerCase()).not.toContain('guillotine')
  })
})
