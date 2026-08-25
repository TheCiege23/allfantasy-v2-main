import { describe, expect, it } from 'vitest'
import { readReactions, toggleReactionLocally } from '@/lib/chat-core/messageReactions'

const ME = 'user-me'

describe('readReactions', () => {
  it('reads the shape the server actually stores', () => {
    const out = readReactions({ reactions: [{ emoji: '🔥', count: 2, userIds: [ME, 'u2'] }] }, ME)
    expect(out).toEqual([{ emoji: '🔥', count: 2, mine: true }])
  })

  it('knows when the reaction is not the viewer\u2019s', () => {
    expect(readReactions({ reactions: [{ emoji: '🔥', count: 1, userIds: ['u2'] }] }, ME)[0].mine).toBe(false)
  })

  it('treats an anonymous viewer as having reacted to nothing', () => {
    expect(readReactions({ reactions: [{ emoji: '🔥', count: 1, userIds: ['u2'] }] }, null)[0].mine).toBe(false)
  })

  /*
   * The stored count is written by a read-modify-write, so two people reacting
   * at once can leave it disagreeing with the ids underneath it. The ids are the
   * record of what happened.
   */
  it('recomputes the count from the ids rather than trusting it', () => {
    const out = readReactions({ reactions: [{ emoji: '🔥', count: 99, userIds: ['a', 'b'] }] }, ME)
    expect(out[0].count).toBe(2)
  })

  it('drops an entry nobody is left on rather than showing a zero chip', () => {
    expect(readReactions({ reactions: [{ emoji: '🔥', count: 0, userIds: [] }] }, ME)).toEqual([])
  })

  it('costs one chip, not the row, when an entry is malformed', () => {
    const out = readReactions(
      { reactions: [null, { emoji: '' }, { emoji: '👍', userIds: ['u2'] }, 'nope'] },
      ME,
    )
    expect(out).toEqual([{ emoji: '👍', count: 1, mine: false }])
  })

  it('returns nothing for metadata without reactions', () => {
    expect(readReactions(null, ME)).toEqual([])
    expect(readReactions({}, ME)).toEqual([])
    expect(readReactions({ reactions: 'nope' }, ME)).toEqual([])
    expect(readReactions([1, 2], ME)).toEqual([])
  })

  /* The ids are how the server knows who reacted; they are not for display. */
  it('never exposes the user ids to the UI', () => {
    const out = readReactions({ reactions: [{ emoji: '🔥', count: 1, userIds: ['secret-id'] }] }, ME)
    expect(JSON.stringify(out)).not.toContain('secret-id')
  })
})

describe('toggleReactionLocally', () => {
  it('adds a reaction nobody has used yet', () => {
    expect(toggleReactionLocally([], '🔥')).toEqual([{ emoji: '🔥', count: 1, mine: true }])
  })

  it('joins a reaction someone else started', () => {
    expect(toggleReactionLocally([{ emoji: '🔥', count: 1, mine: false }], '🔥')).toEqual([
      { emoji: '🔥', count: 2, mine: true },
    ])
  })

  it('withdraws the viewer\u2019s own reaction', () => {
    expect(toggleReactionLocally([{ emoji: '🔥', count: 2, mine: true }], '🔥')).toEqual([
      { emoji: '🔥', count: 1, mine: false },
    ])
  })

  it('removes the chip entirely when the last reactor withdraws', () => {
    expect(toggleReactionLocally([{ emoji: '🔥', count: 1, mine: true }], '🔥')).toEqual([])
  })

  it('leaves other reactions untouched', () => {
    const before = [
      { emoji: '👍', count: 3, mine: false },
      { emoji: '🔥', count: 1, mine: true },
    ]
    expect(toggleReactionLocally(before, '🔥')).toEqual([{ emoji: '👍', count: 3, mine: false }])
  })

  it('does not mutate the list it was given', () => {
    const before = [{ emoji: '🔥', count: 1, mine: false }]
    toggleReactionLocally(before, '🔥')
    expect(before).toEqual([{ emoji: '🔥', count: 1, mine: false }])
  })
})
