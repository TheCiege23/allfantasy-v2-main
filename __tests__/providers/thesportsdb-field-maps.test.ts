import { describe, expect, it } from 'vitest'
import {
  extractTheSportsDbPlayerImages,
  extractTheSportsDbTeamImages,
  hasTheSportsDbExperienceSignal,
} from '@/lib/providers/theSportsDbFieldMaps'

describe('theSportsDbFieldMaps', () => {
  it('prioritizes cutout then render then thumb for player images', () => {
    const onlyThumb = extractTheSportsDbPlayerImages({ strThumb: 'https://example.com/t.png' })
    expect(onlyThumb.primary).toBe('https://example.com/t.png')

    const cutout = extractTheSportsDbPlayerImages({
      strCutout: 'https://example.com/c.png',
      strThumb: 'https://example.com/t.png',
    })
    expect(cutout.primary).toBe('https://example.com/c.png')
  })

  it('reads team badge / logo', () => {
    const t = extractTheSportsDbTeamImages({ strBadge: 'https://b.png', strLogo: 'https://l.png' })
    expect(t.primary).toBe('https://b.png')
  })

  it('returns unknown experience for dateBorn / college only', () => {
    expect(hasTheSportsDbExperienceSignal({ dateBorn: '1999-01-01', strCollege: 'LSU' })).toBe(false)
  })

  it('detects experience when draft year field exists', () => {
    expect(hasTheSportsDbExperienceSignal({ draft_year: 2022 })).toBe(true)
  })
})
