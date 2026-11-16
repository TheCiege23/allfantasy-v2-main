import { describe, expect, it } from 'vitest'
import {
  APP_MUSIC_COPY,
  APPLE_QUICK_SEARCHES,
  STATION_ES,
  appMusicCopy,
  appMusicLang,
  stationText,
} from '@/lib/i18n/app-music-copy'
import { YOUTUBE_STATIONS, describeYouTubeLinkProblem, youTubeLinkProblem } from '@/lib/draft-music/youtube'

describe('app music copy', () => {
  it('reads Spanish for any es-* language and English for everything else', () => {
    expect(appMusicLang('es')).toBe('es')
    expect(appMusicLang('es-MX')).toBe('es')
    expect(appMusicLang('ES')).toBe('es')
    expect(appMusicLang('en')).toBe('en')
    expect(appMusicLang('fr')).toBe('en')
    expect(appMusicLang(null)).toBe('en')
    expect(appMusicLang(undefined)).toBe('en')
  })

  it('has a non-empty Spanish line for every key, different from English where it is a sentence', () => {
    for (const [key, text] of Object.entries(APP_MUSIC_COPY)) {
      expect(text.es.trim(), key).not.toBe('')
      // A long line that is identical in both languages was never translated.
      if (text.en.length > 12) expect(text.es, key).not.toBe(text.en)
    }
  })

  it('keeps every placeholder in both languages', () => {
    for (const [key, text] of Object.entries(APP_MUSIC_COPY)) {
      const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort()
      expect(vars(text.es), key).toEqual(vars(text.en))
    }
  })

  it('fills placeholders', () => {
    expect(appMusicCopy('es', 'nothingFound', { q: 'Bad Bunny' })).toBe('No se encontró nada para “Bad Bunny”.')
    expect(appMusicCopy('en', 'onYouTube', { label: 'Lo-fi beats' })).toBe('Lo-fi beats on YouTube')
  })

  it('names every YouTube station in Spanish, so a new station cannot ship English-only', () => {
    for (const station of YOUTUBE_STATIONS) {
      expect(STATION_ES[station.id]?.label, station.id).toBeTruthy()
    }
    // …and no leftover entry for a station that was removed.
    const ids = new Set(YOUTUBE_STATIONS.map((s) => s.id))
    expect(Object.keys(STATION_ES).filter((id) => !ids.has(id))).toEqual([])
  })

  it('translates a station label but keeps a show name as it is', () => {
    const ff = YOUTUBE_STATIONS.find((s) => s.id === 'ff-podcast')!
    expect(stationText('es', ff)).toEqual({ label: 'Podcast de fútbol americano', channel: 'The Fantasy Footballers' })
    expect(stationText('en', ff)).toEqual({ label: ff.label, channel: ff.channel })
    const gameDay = YOUTUBE_STATIONS.find((s) => s.id === 'game-day')!
    expect(stationText('es', gameDay).channel).toBe('Himnos de estadio')
  })

  it('has the same number of Apple quick searches in both languages', () => {
    expect(APPLE_QUICK_SEARCHES.es).toHaveLength(APPLE_QUICK_SEARCHES.en.length)
  })
})

describe('youTubeLinkProblem', () => {
  it('codes a Mix and a non-YouTube link, and the English wording still follows the code', () => {
    const mix = 'https://www.youtube.com/watch?v=abc&list=RDabc'
    expect(youTubeLinkProblem(mix)).toBe('mix')
    expect(youTubeLinkProblem('https://vimeo.com/1')).toBe('not-youtube')
    expect(describeYouTubeLinkProblem(mix)).toBe(APP_MUSIC_COPY.linkIsMix.en)
    expect(describeYouTubeLinkProblem('https://vimeo.com/1')).toBe(APP_MUSIC_COPY.linkNotYouTube.en)
  })
})
