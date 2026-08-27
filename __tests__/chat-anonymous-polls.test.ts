import { describe, expect, it } from 'vitest'
import { readViewerPoll, redactAnonymousPollVotes } from '@/lib/chat-core/messagePolls'

const ME = 'user-me'

function meta(anonymous: boolean) {
  return {
    gif: { url: 'g' },
    poll: {
      question: 'Who wins?',
      anonymous,
      options: [
        { id: 'a', text: 'Chiefs', votes: [ME, 'u2', 'u3'] },
        { id: 'b', text: 'Bills', votes: ['u4'] },
      ],
    },
  }
}

function votesOf(out: unknown, i: number): string[] {
  const poll = (out as { poll: { options: Array<{ votes: string[] }> } }).poll
  return poll.options[i].votes
}

describe('redactAnonymousPollVotes', () => {
  /*
   * Marking a poll anonymous and simply not drawing the names would still ship
   * every voter's id to every member's browser — the appearance of anonymity.
   */
  it('removes other voters\u2019 ids from an anonymous poll', () => {
    const out = redactAnonymousPollVotes(meta(true), ME)

    expect(JSON.stringify(out)).not.toContain('u2')
    expect(JSON.stringify(out)).not.toContain('u3')
    expect(JSON.stringify(out)).not.toContain('u4')
  })

  /* They already know how they voted, and it is what lets them change it. */
  it('keeps the viewer\u2019s own id so their choice still shows', () => {
    expect(votesOf(redactAnonymousPollVotes(meta(true), ME), 0)).toContain(ME)
  })

  it('preserves the count exactly', () => {
    const out = redactAnonymousPollVotes(meta(true), ME)

    expect(votesOf(out, 0)).toHaveLength(3)
    expect(votesOf(out, 1)).toHaveLength(1)
  })

  /* Identical placeholders could be collapsed downstream and undercount. */
  it('gives every hidden voter a distinct placeholder', () => {
    const votes = votesOf(redactAnonymousPollVotes(meta(true), ME), 0)
    expect(new Set(votes).size).toBe(votes.length)
  })

  it('leaves a normal poll untouched', () => {
    const original = meta(false)
    expect(redactAnonymousPollVotes(original, ME)).toBe(original)
  })

  it('leaves the rest of the metadata alone', () => {
    const out = redactAnonymousPollVotes(meta(true), ME) as { gif: unknown }
    expect(out.gif).toEqual({ url: 'g' })
  })

  it('redacts everybody when there is no viewer', () => {
    const votes = votesOf(redactAnonymousPollVotes(meta(true), null), 0)
    expect(votes.every((v) => v.startsWith('anon:'))).toBe(true)
  })

  it('passes through anything that is not a poll', () => {
    expect(redactAnonymousPollVotes(null, ME)).toBeNull()
    expect(redactAnonymousPollVotes({ gif: { url: 'g' } }, ME)).toEqual({ gif: { url: 'g' } })
  })
})

describe('reading a redacted poll', () => {
  /* The redaction has to survive the reader that renders it. */
  it('still counts and still knows the viewer voted', () => {
    const redacted = redactAnonymousPollVotes(meta(true), ME)
    const poll = readViewerPoll(redacted, ME)!

    expect(poll.anonymous).toBe(true)
    expect(poll.totalVotes).toBe(4)
    expect(poll.options[0]).toMatchObject({ count: 3, mine: true })
    expect(poll.options[1]).toMatchObject({ count: 1, mine: false })
  })

  it('reports a normal poll as not anonymous', () => {
    expect(readViewerPoll(meta(false), ME)?.anonymous).toBe(false)
  })

  it('shows another viewer that they have not voted', () => {
    const redacted = redactAnonymousPollVotes(meta(true), 'someone-else')
    const poll = readViewerPoll(redacted, 'someone-else')!

    expect(poll.options.every((o) => !o.mine)).toBe(true)
    expect(poll.totalVotes).toBe(4)
  })
})
