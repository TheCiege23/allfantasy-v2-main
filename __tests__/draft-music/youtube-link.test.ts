import { describe, expect, it } from 'vitest'
import { YOUTUBE_STATIONS, parseYouTubeLink, youTubeEmbedUrl } from '@/lib/draft-music/youtube'

describe('parseYouTubeLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['youtube.com/watch?v=jfKfPfyJRdk&t=30s', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://m.youtube.com/watch?v=jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://youtu.be/jfKfPfyJRdk?si=abc', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://www.youtube.com/shorts/jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://www.youtube.com/live/jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://www.youtube.com/embed/jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    [
      'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
      { kind: 'playlist', listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' },
    ],
    [
      'https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
      { kind: 'playlist', listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' },
    ],
    [
      'https://www.youtube.com/watch?v=jfKfPfyJRdk&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
      { kind: 'playlist', listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', videoId: 'jfKfPfyJRdk' },
    ],
  ])('reads %s', (input, expected) => {
    expect(parseYouTubeLink(input)).toEqual(expected)
  })

  it.each([
    '',
    '   ',
    'not a link',
    'https://vimeo.com/123456789',
    'https://evil.example/watch?v=jfKfPfyJRdk',
    'https://youtube.com.evil.example/watch?v=jfKfPfyJRdk',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow',
  ])('rejects %j', (input) => {
    expect(parseYouTubeLink(input)).toBeNull()
  })
})

describe('youTubeEmbedUrl', () => {
  it('uses the privacy-enhanced host and only autoplays when asked', () => {
    const url = new URL(youTubeEmbedUrl({ kind: 'video', videoId: 'jfKfPfyJRdk' }, { autoplay: false }))
    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.pathname).toBe('/embed/jfKfPfyJRdk')
    expect(url.searchParams.has('autoplay')).toBe(false)

    const clicked = new URL(youTubeEmbedUrl({ kind: 'video', videoId: 'jfKfPfyJRdk' }, { autoplay: true }))
    expect(clicked.searchParams.get('autoplay')).toBe('1')
  })

  it('embeds a bare playlist as a videoseries', () => {
    const url = new URL(youTubeEmbedUrl({ kind: 'playlist', listId: 'PLabcdefghij' }, { autoplay: true }))
    expect(url.pathname).toBe('/embed/videoseries')
    expect(url.searchParams.get('list')).toBe('PLabcdefghij')
  })

  it('starts a playlist at the linked video', () => {
    const url = new URL(
      youTubeEmbedUrl({ kind: 'playlist', listId: 'PLabcdefghij', videoId: 'jfKfPfyJRdk' }, { autoplay: true }),
    )
    expect(url.pathname).toBe('/embed/jfKfPfyJRdk')
    expect(url.searchParams.get('list')).toBe('PLabcdefghij')
  })
})

describe('YOUTUBE_STATIONS', () => {
  it('every preset is a valid embeddable id with a unique key', () => {
    const keys = new Set<string>()
    for (const station of YOUTUBE_STATIONS) {
      expect(keys.has(station.id)).toBe(false)
      keys.add(station.id)
      const id = station.source.kind === 'video' ? station.source.videoId : station.source.listId
      expect(parseYouTubeLink(`https://www.youtube.com/watch?v=${id}`)).not.toBeNull()
    }
  })
})
