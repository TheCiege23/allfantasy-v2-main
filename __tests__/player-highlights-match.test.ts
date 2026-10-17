import { describe, expect, it } from 'vitest'
import { selectPlayerHighlights } from '@/lib/highlights/match'

const video = (title: string) => ({
  videoId: 'abcdefghijk', title, channelTitle: 'NFL', channelId: 'official',
  publishedAt: '2026-10-11T12:00:00Z', thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg',
})

describe('highlight matching', () => {
  it('matches full names with punctuation and suffixes without matching partial names', () => {
    expect(selectPlayerHighlights([video('DJ Moore highlights')], 'D.J. Moore', 'CHI')[0]?.kind).toBe('player')
    expect(selectPlayerHighlights([video('Josh Allen’s best plays')], 'Josh Allen', 'BUF')[0]?.kind).toBe('player')
    expect(selectPlayerHighlights([video('Marvin Harrison highlights')], 'Marvin Harrison Jr.', 'ARI')).toHaveLength(1)
    expect(selectPlayerHighlights([video('Josh Allenby highlights'), video('Kyle Allen highlights')], 'Josh Allen', 'BUF')).toEqual([])
  })
  it('labels team game recaps separately and excludes other teams and interviews', () => {
    const found = selectPlayerHighlights([
      video('Jahmyr Gibbs highlights'), video('Jahmyr Gibbs postgame interview'),
      video('Lions vs. Bears | Week 6 Game Highlights'), video('Bills vs. Jets Game Highlights'),
    ], 'Jahmyr Gibbs', 'DET')
    expect(found.map((item) => item.kind)).toEqual(['player', 'game'])
  })
  it('does not infer player matches from a single name and caps the list', () => {
    expect(selectPlayerHighlights([video('Allen highlights')], 'Allen', null)).toEqual([])
    expect(selectPlayerHighlights(Array.from({ length: 9 }, () => video('Josh Allen highlights')), 'Josh Allen', null)).toHaveLength(3)
  })
})
