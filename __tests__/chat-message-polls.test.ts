import { describe, expect, it } from 'vitest'
import { isPollClosed, pollShare, readViewerPoll, votePollLocally } from '@/lib/chat-core/messagePolls'

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
      closesAt: null,
      closedByHand: false,
      allowMultiple: false,
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

/*
 * The composer has collected a deadline and a multi-choice flag on every poll it
 * has ever posted. Both were stored and neither was ever read back, so a poll
 * ran forever and a multi-choice poll behaved as single-choice.
 */
describe('poll deadlines', () => {
  const withClose = (closeAt: string, closed?: boolean) => ({
    poll: { question: 'Q', options: [{ id: 'a', text: 'x', votes: [] }], closeAt, closed },
  })

  it('reads the deadline the composer stored', () => {
    const out = readViewerPoll(withClose('2026-09-01T00:00:00.000Z'), ME)
    expect(out?.closesAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('ignores a deadline that is not a date', () => {
    expect(readViewerPoll(withClose('whenever'), ME)?.closesAt).toBeNull()
  })

  it('is open before the deadline', () => {
    const poll = readViewerPoll(withClose(new Date(Date.now() + 60_000).toISOString()), ME)!
    expect(isPollClosed(poll)).toBe(false)
  })

  it('is closed once the deadline has passed', () => {
    const poll = readViewerPoll(withClose(new Date(Date.now() - 60_000).toISOString()), ME)!
    expect(isPollClosed(poll)).toBe(true)
  })

  it('is closed when somebody closed it, deadline or not', () => {
    const poll = readViewerPoll(withClose(new Date(Date.now() + 60_000).toISOString(), true), ME)!
    expect(isPollClosed(poll)).toBe(true)
  })

  it('never closes a poll with no deadline on its own', () => {
    const poll = readViewerPoll({ poll: { question: 'Q', options: [{ id: 'a', text: 'x' }] } }, ME)!
    expect(isPollClosed(poll)).toBe(false)
  })

  it('decides against the clock it is given, not the device’s', () => {
    const poll = readViewerPoll(withClose('2026-09-01T00:00:00.000Z'), ME)!
    expect(isPollClosed(poll, Date.parse('2026-08-31T23:59:59Z'))).toBe(false)
    expect(isPollClosed(poll, Date.parse('2026-09-01T00:00:01Z'))).toBe(true)
  })

  it('refuses a vote on a closed poll', () => {
    const poll = readViewerPoll(withClose(new Date(Date.now() - 60_000).toISOString()), ME)!
    expect(votePollLocally(poll, 'a')).toEqual(poll)
  })
})

describe('multi-choice polls', () => {
  const multi = () =>
    readViewerPoll(
      {
        poll: {
          question: 'Q',
          allowMultiple: true,
          options: [
            { id: 'a', text: 'Chiefs', votes: [ME] },
            { id: 'b', text: 'Bills', votes: [] },
          ],
        },
      },
      ME,
    )!

  it('reads the flag the composer stored', () => {
    expect(multi().allowMultiple).toBe(true)
  })

  /* On a single-choice poll this would have moved the vote. */
  it('keeps an existing choice when a second is added', () => {
    const out = votePollLocally(multi(), 'b')

    expect(out.options.find((o) => o.id === 'a')).toMatchObject({ count: 1, mine: true })
    expect(out.options.find((o) => o.id === 'b')).toMatchObject({ count: 1, mine: true })
    expect(out.totalVotes).toBe(2)
  })

  it('still withdraws a choice that is tapped again', () => {
    const out = votePollLocally(multi(), 'a')
    expect(out.options.find((o) => o.id === 'a')).toMatchObject({ count: 0, mine: false })
  })
})
