import { describe, expect, it } from 'vitest'
import { readAttachments, readGif, readPoll } from '@/components/core-app/comms/RichMessage'

describe('readGif', () => {
  /* The composer writes a nested object on one path and flat keys on another. */
  it('reads the nested gif object', () => {
    expect(
      readGif({ gif: { previewUrl: 'p.gif', url: 'u.gif', title: 'Nice' } }),
    ).toEqual({ previewUrl: 'p.gif', url: 'u.gif', title: 'Nice' })
  })

  it('reads the flat gifUrl form', () => {
    expect(readGif({ gifUrl: 'u.gif', gifTitle: 'Flat' })).toMatchObject({
      url: 'u.gif',
      title: 'Flat',
    })
  })

  it('falls back between preview and full url rather than rendering an empty src', () => {
    expect(readGif({ previewUrl: 'p.gif' })?.url).toBe('p.gif')
    expect(readGif({ gifUrl: 'u.gif' })?.previewUrl).toBe('u.gif')
  })

  it('returns null when there is no gif', () => {
    expect(readGif(null)).toBeNull()
    expect(readGif({})).toBeNull()
    expect(readGif({ gif: 'not an object' })).toBeNull()
  })
})

describe('readAttachments', () => {
  it('keeps well-formed attachments', () => {
    expect(
      readAttachments({ attachments: [{ type: 'image', url: 'a.png', mimeType: 'image/png' }] }),
    ).toEqual([{ type: 'image', url: 'a.png', mimeType: 'image/png' }])
  })

  /*
   * metadata is untrusted JSON. One malformed row must not throw inside a
   * message list and blank the whole conversation.
   */
  it('drops malformed entries instead of throwing', () => {
    expect(
      readAttachments({ attachments: [null, 'nope', { type: 'image' }, { url: 'b.png' }] }),
    ).toEqual([])
  })

  it('returns an empty list when there are none', () => {
    expect(readAttachments({})).toEqual([])
    expect(readAttachments({ attachments: 'no' })).toEqual([])
  })
})

describe('readPoll', () => {
  it('reads a poll with its options and vote counts', () => {
    const poll = readPoll({
      poll: {
        question: 'Best pick?',
        options: [
          { id: 'a', text: 'One', votes: ['u1', 'u2'] },
          { id: 'b', text: 'Two', votes: [] },
        ],
      },
    })
    expect(poll?.question).toBe('Best pick?')
    expect(poll?.options[0].votes).toHaveLength(2)
  })

  it('supplies an id when one is missing, so React keys stay stable', () => {
    const poll = readPoll({ poll: { question: 'Q', options: [{ text: 'One' }] } })
    expect(poll?.options[0].id).toBe('opt-0')
  })

  it('returns null for a poll with no usable options', () => {
    expect(readPoll({ poll: { question: 'Q', options: [] } })).toBeNull()
    expect(readPoll({ poll: { question: 'Q', options: [{}] } })).toBeNull()
    expect(readPoll({ poll: { options: [{ text: 'One' }] } })).toBeNull()
  })

  it('returns null when there is no poll', () => {
    expect(readPoll(null)).toBeNull()
    expect(readPoll({ poll: 'nope' })).toBeNull()
  })
})
