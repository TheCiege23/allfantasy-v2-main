import { describe, expect, it } from 'vitest'
import { pollShare, readViewerPoll, votePollLocally } from '@/lib/chat-core/messagePolls'

const ME = 'user-me'

function meta(options: Array<{ id?: string; text: string; votes?: string[] }>) {
  return { poll: { question: 'Who wins?', options } }
}

describe('readViewerPoll', () => {
  it('reads the league poll shape the composer writes', () => {
    const out = readViewerPoll(meta([{ id: 'a', text: 'Chiefs', votes: [ME, 'u2'] }]), ME)
    expect(out).toEqual({
      question: 'Who wins?',
      options: [{ id: 'a', text: 'Chiefs', count: 2, mine: true }],
      totalVotes: 2,
    })
  })

  it('totals votes across every option', () => {
    const out = readViewerPoll(
      meta([
        { id: 'a', text: 'Chiefs', votes: ['u1'] },
        { id: 'b', text: 'Bills', votes: ['u2', 'u3'] },
      ]),
      ME,
    )
    expect(out?.totalVotes).toBe(3)
  })

  it('marks nothing as the viewer\u2019s when they have not voted', () => {
    const out = readViewerPoll(meta([{ id: 'a', text: 'Chiefs', votes: ['u2'] }]), ME)
    expect(out?.options[0].mine).toBe(false)
  })

  it('falls back to a positional id when an option has none', () => {
    const out = readViewerPoll(meta([{ text: 'Chiefs' }]), ME)
    expect(out?.options[0].id).toBe('opt-0')
  })

  /* One bad row must cost its own poll, not the conversation around it. */
  it('returns null for anything that is not a league poll', () => {
    expect(readViewerPoll(null, ME)).toBeNull()
    expect(readViewerPoll({}, ME)).toBeNull()
    expect(readViewerPoll({ poll: 'nope' }, ME)).toBeNull()
    expect(readViewerPoll({ poll: { question: 'Q' } }, ME)).toBeNull()
    expect(readViewerPoll({ poll: { question: '', options: [{ text: 'a' }] } }, ME)).toBeNull()
    expect(readViewerPoll(meta([]), ME)).toBeNull()
  })

  it('skips an option with no text rather than rendering a blank choice', () => {
    const out = readViewerPoll(meta([{ id: 'a', text: '' as never }, { id: 'b', text: 'Bills' }]), ME)
    expect(out?.options.map((o) => o.id)).toEqual(['b'])
  })
})

describe('votePollLocally', () => {
  const poll = () =>
    readViewerPoll(
      meta([
        { id: 'a', text: 'Chiefs', votes: ['u2'] },
        { id: 'b', text: 'Bills', votes: [] },
      ]),
      ME,
    )!

  it('casts a first vote', () => {
    const out = votePollLocally(poll(), 'b')
    expect(out.options.find((o) => o.id === 'b')).toMatchObject({ count: 1, mine: true })
    expect(out.totalVotes).toBe(2)
  })

  /* One vote per person: a second choice moves it rather than adding one. */
  it('moves an existing vote instead of adding a second', () => {
    const voted = votePollLocally(poll(), 'a')
    const moved = votePollLocally(voted, 'b')

    expect(moved.options.find((o) => o.id === 'a')).toMatchObject({ count: 1, mine: false })
    expect(moved.options.find((o) => o.id === 'b')).toMatchObject({ count: 1, mine: true })
    expect(moved.totalVotes).toBe(2)
  })

  it('withdraws the vote when the held option is chosen again', () => {
    const voted = votePollLocally(poll(), 'b')
    const undone = votePollLocally(voted, 'b')

    expect(undone.options.find((o) => o.id === 'b')).toMatchObject({ count: 0, mine: false })
    expect(undone.totalVotes).toBe(1)
  })

  it('ignores an option that is not on the poll', () => {
    expect(votePollLocally(poll(), 'nope')).toEqual(poll())
  })

  it('does not mutate the poll it was given', () => {
    const p = poll()
    votePollLocally(p, 'b')
    expect(p.options.find((o) => o.id === 'b')).toMatchObject({ count: 0, mine: false })
  })
})

describe('pollShare', () => {
  it('is a percentage of votes cast', () => {
    expect(pollShare({ id: 'a', text: 'x', count: 1, mine: false }, 4)).toBe(25)
  })

  /* Equal bars across an unvoted poll would render a tie nobody cast. */
  it('is zero before anybody votes', () => {
    expect(pollShare({ id: 'a', text: 'x', count: 0, mine: false }, 0)).toBe(0)
  })
})
