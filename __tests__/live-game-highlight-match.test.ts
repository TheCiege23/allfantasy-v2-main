import { describe, expect, it } from 'vitest'
import {
  matchGameHighlights,
  normalizeTeamName,
  youtubeIdFromUrl,
} from '@/lib/live/gameHighlightMatch'

describe('youtubeIdFromUrl', () => {
  it('reads the id from every YouTube link shape the feed could carry', () => {
    // The real shape in contracts/thesportsdb/fixtures/v1.eventspastleague.NFL.json.
    expect(youtubeIdFromUrl('https://www.youtube.com/watch?v=NUvZpCNjH38')).toBe('NUvZpCNjH38')
    expect(youtubeIdFromUrl('https://youtu.be/NUvZpCNjH38')).toBe('NUvZpCNjH38')
    expect(youtubeIdFromUrl('https://m.youtube.com/watch?v=_TtInH48nDY&t=3')).toBe('_TtInH48nDY')
    expect(youtubeIdFromUrl('https://www.youtube.com/embed/_TtInH48nDY')).toBe('_TtInH48nDY')
    expect(youtubeIdFromUrl('https://youtube.com/shorts/_TtInH48nDY')).toBe('_TtInH48nDY')
  })

  it('refuses anything that is not a YouTube video id', () => {
    expect(youtubeIdFromUrl('')).toBeNull()
    expect(youtubeIdFromUrl(null)).toBeNull()
    expect(youtubeIdFromUrl('not a url')).toBeNull()
    expect(youtubeIdFromUrl('https://evil.example/watch?v=NUvZpCNjH38')).toBeNull()
    expect(youtubeIdFromUrl('https://www.youtube.com/playlist?list=PL123')).toBeNull()
    // An id carrying markup never reaches an iframe src.
    expect(youtubeIdFromUrl('https://www.youtube.com/watch?v=abc"><script>')).toBeNull()
  })
})

describe('normalizeTeamName', () => {
  it('meets the two feeds where they actually spell a school differently', () => {
    expect(normalizeTeamName("Hawai'i Rainbow Warriors").startsWith(normalizeTeamName('Hawaii'))).toBe(true)
    expect(normalizeTeamName('Texas A&M Aggies').startsWith(normalizeTeamName('Texas A and M'))).toBe(true)
    expect(normalizeTeamName('Miami (FL)')).toBe('miami')
    expect(normalizeTeamName('Louisiana-Monroe')).toBe('ul monroe')
    // Miami (OH) keeps its qualifier and must never collapse onto Miami (FL).
    expect(normalizeTeamName('Miami (OH)')).toBe('miami oh')
  })
})

const at = (iso: string) => iso

describe('matchGameHighlights', () => {
  it('pairs an NFL game by full team names within the kickoff window', () => {
    const out = matchGameHighlights(
      [{ key: '401', homeName: 'Kansas City Chiefs', awayName: 'Los Angeles Rams', startTime: at('2026-09-20T17:00:00Z') }],
      [
        // TheSportsDB often dates an NFL game with no time.
        { homeTeam: 'Kansas City Chiefs', awayTeam: 'Los Angeles Rams', startTime: at('2026-09-20T00:00:00Z'), videoUrl: 'https://www.youtube.com/watch?v=_TtInH48nDY' },
      ],
    )
    expect(out.get('401')).toBe('_TtInH48nDY')
  })

  it('pairs a college game by school name against ESPN mascot names, either orientation', () => {
    const out = matchGameHighlights(
      [{ key: 'cfb', homeName: 'Temple Owls', awayName: 'Charlotte 49ers', startTime: at('2026-10-17T16:00:00Z') }],
      [{ homeTeam: 'Charlotte', awayTeam: 'Temple', startTime: at('2026-10-17T16:00:00Z'), videoUrl: 'https://youtu.be/4KDE7NMshvI' }],
    )
    expect(out.get('cfb')).toBe('4KDE7NMshvI')
  })

  it('never pairs a game outside the window — last week is a different game', () => {
    const out = matchGameHighlights(
      [{ key: 'now', homeName: 'Kansas City Chiefs', awayName: 'Los Angeles Rams', startTime: at('2026-09-27T17:00:00Z') }],
      [{ homeTeam: 'Kansas City Chiefs', awayTeam: 'Los Angeles Rams', startTime: at('2026-09-20T17:00:00Z'), videoUrl: 'https://youtu.be/_TtInH48nDY' }],
    )
    expect(out.size).toBe(0)
  })

  it('needs BOTH teams — one shared team is not the same game', () => {
    const out = matchGameHighlights(
      [{ key: 'g', homeName: 'Kansas City Chiefs', awayName: 'Denver Broncos', startTime: at('2026-09-20T17:00:00Z') }],
      [{ homeTeam: 'Kansas City Chiefs', awayTeam: 'Los Angeles Rams', startTime: at('2026-09-20T17:00:00Z'), videoUrl: 'https://youtu.be/_TtInH48nDY' }],
    )
    expect(out.size).toBe(0)
  })

  it('gives each game its longest match when prefix-related schools play the same day', () => {
    const games = [
      { key: 'texas', homeName: 'Texas Longhorns', awayName: 'Georgia Bulldogs', startTime: at('2026-09-19T16:00:00Z') },
      { key: 'txst', homeName: 'Texas State Bobcats', awayName: 'Georgia Southern Eagles', startTime: at('2026-09-19T16:00:00Z') },
    ]
    const candidates = [
      { homeTeam: 'Texas', awayTeam: 'Georgia', startTime: at('2026-09-19T16:00:00Z'), videoUrl: 'https://youtu.be/AAAAAAAAAAA' },
      { homeTeam: 'Texas State', awayTeam: 'Georgia Southern', startTime: at('2026-09-19T16:00:00Z'), videoUrl: 'https://youtu.be/BBBBBBBBBBB' },
    ]
    // Order must not decide it — neither the slate's nor the feed's. With Texas
    // State listed first, a first-come pairing hands it the shorter "Texas /
    // Georgia" video and leaves the Longhorns with none.
    for (const slate of [games, [...games].reverse()]) {
      for (const list of [candidates, [...candidates].reverse()]) {
        const out = matchGameHighlights(slate, list)
        expect(out.get('texas')).toBe('AAAAAAAAAAA')
        expect(out.get('txst')).toBe('BBBBBBBBBBB')
      }
    }
  })

  it('skips a candidate whose video is empty rather than pairing nothing', () => {
    const out = matchGameHighlights(
      [{ key: 'g', homeName: 'Temple Owls', awayName: 'Army Black Knights', startTime: at('2026-09-25T20:00:00Z') }],
      [{ homeTeam: 'Temple', awayTeam: 'Army', startTime: at('2026-09-25T20:00:00Z'), videoUrl: '' }],
    )
    expect(out.size).toBe(0)
  })
})
