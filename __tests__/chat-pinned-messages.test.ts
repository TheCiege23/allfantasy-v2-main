import { describe, expect, it } from 'vitest'
import { readPinnedRefs } from '@/lib/chat-core/pinnedMessages'

function pin(over: Record<string, unknown> = {}) {
  return {
    id: 'pin-1',
    body: JSON.stringify({ messageId: 'm1', snippet: 'I will take Kelce' }),
    senderName: 'Casey',
    createdAt: '2026-08-25T12:00:00.000Z',
    ...over,
  }
}

describe('readPinnedRefs', () => {
  /* A pin is a chat row whose body is JSON, not a column. */
  it('parses the JSON body a pin is stored as', () => {
    expect(readPinnedRefs([pin()])).toEqual([
      {
        pinId: 'pin-1',
        messageId: 'm1',
        snippet: 'I will take Kelce',
        pinnedBy: 'Casey',
        pinnedAt: '2026-08-25T12:00:00.000Z',
      },
    ])
  })

  it('accepts a body that arrives already parsed', () => {
    const out = readPinnedRefs([pin({ body: { messageId: 'm1', snippet: 'hi' } })])
    expect(out[0].snippet).toBe('hi')
  })

  /*
   * A pin claims something was worth keeping; an empty one makes that claim
   * about nothing.
   */
  it('skips a row whose body will not parse', () => {
    expect(readPinnedRefs([pin({ body: 'not json' })])).toEqual([])
  })

  it('skips a row with no message or no snippet', () => {
    expect(readPinnedRefs([pin({ body: JSON.stringify({ snippet: 'orphan' }) })])).toEqual([])
    expect(readPinnedRefs([pin({ body: JSON.stringify({ messageId: 'm1' }) })])).toEqual([])
    expect(readPinnedRefs([pin({ body: JSON.stringify({ messageId: 'm1', snippet: '  ' }) })])).toEqual([])
  })

  it('skips a row with no id of its own, which unpin would need', () => {
    expect(readPinnedRefs([pin({ id: undefined })])).toEqual([])
  })

  it('names an unknown pinner rather than leaving it blank', () => {
    expect(readPinnedRefs([pin({ senderName: null })])[0].pinnedBy).toBe('Someone')
  })

  it('puts the most recent pin first', () => {
    const out = readPinnedRefs([
      pin({ id: 'old', createdAt: '2026-08-01T00:00:00.000Z' }),
      pin({ id: 'new', createdAt: '2026-08-25T00:00:00.000Z' }),
    ])
    expect(out.map((p) => p.pinId)).toEqual(['new', 'old'])
  })

  it('handles a missing or malformed payload', () => {
    expect(readPinnedRefs(undefined)).toEqual([])
    expect(readPinnedRefs(null)).toEqual([])
    expect(readPinnedRefs('nope')).toEqual([])
    expect(readPinnedRefs([null, 'x', 42])).toEqual([])
  })

  it('costs one pin, not the board, when a row is bad', () => {
    const out = readPinnedRefs([pin({ id: 'bad', body: 'nope' }), pin({ id: 'good' })])
    expect(out.map((p) => p.pinId)).toEqual(['good'])
  })
})
