import { describe, expect, it } from 'vitest'
import { buildChimmyPlayerCards } from '@/lib/chimmy/chimmyPlayerCards'

function roster(starters: Array<[string, string]>, bench: Array<[string, string]> = []) {
  const mk = ([playerId, playerName]: [string, string], isStarter: boolean) => ({
    playerId,
    playerName,
    position: 'WR',
    team: 'JAX',
    injuryStatus: null,
    adp: null,
    projectedPoints: null,
    isStarter,
  })
  return [
    {
      userId: 'u1',
      teamName: 'My Team',
      starters: starters.map((s) => mk(s, true)),
      bench: bench.map((b) => mk(b, false)),
    },
  ] as never
}

describe('buildChimmyPlayerCards', () => {
  it('returns a card with a derived headshot for a player the answer names', () => {
    const cards = buildChimmyPlayerCards({
      answer: 'Start Brian Thomas Jr. over your other flex options.',
      rosters: roster([['5859', 'Brian Thomas Jr.']]),
      sport: 'NFL' as never,
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      playerId: '5859',
      name: 'Brian Thomas Jr.',
      position: 'WR',
      team: 'JAX',
      isStarter: true,
    })
    expect(cards[0].imageUrl).toContain('5859')
  })

  it('ignores roster players the answer does not mention', () => {
    const cards = buildChimmyPlayerCards({
      answer: 'Start Brian Thomas Jr. this week.',
      rosters: roster([
        ['5859', 'Brian Thomas Jr.'],
        ['2216', 'Somebody Else'],
      ]),
      sport: 'NFL' as never,
    })

    expect(cards.map((c) => c.name)).toEqual(['Brian Thomas Jr.'])
  })

  /*
   * A synthetic `name:` id is not a Sleeper id, so no CDN URL can be derived —
   * null is correct and the UI renders initials.
   */
  it('yields a null image rather than a guessed one for synthetic ids', () => {
    const cards = buildChimmyPlayerCards({
      answer: 'Consider benching Brian Thomas Jr.',
      rosters: roster([['name:Brian Thomas Jr.:WR:JAX', 'Brian Thomas Jr.']]),
      sport: 'NFL' as never,
    })

    expect(cards).toHaveLength(1)
    expect(cards[0].imageUrl).toBeNull()
  })

  it('does not match a name embedded inside another word', () => {
    const cards = buildChimmyPlayerCards({
      answer: 'The Ross-Smithson trade is fine.',
      rosters: roster([['5859', 'Ross']]),
      sport: 'NFL' as never,
    })

    expect(cards).toEqual([])
  })

  it('returns nothing when there is no roster to draw candidates from', () => {
    expect(
      buildChimmyPlayerCards({ answer: 'Start Brian Thomas Jr.', rosters: null, sport: 'NFL' as never }),
    ).toEqual([])
  })

  it('caps the number of cards so one answer cannot flood the panel', () => {
    const many = Array.from({ length: 12 }, (_, i) => [`${5000 + i}`, `Player Number${i}`]) as Array<
      [string, string]
    >
    const cards = buildChimmyPlayerCards({
      answer: many.map(([, name]) => name).join(', '),
      rosters: roster(many),
      sport: 'NFL' as never,
    })

    expect(cards.length).toBeLessThanOrEqual(6)
  })

  it('deduplicates a player who appears on more than one listed roster slot', () => {
    const cards = buildChimmyPlayerCards({
      answer: 'Brian Thomas Jr. is the play.',
      rosters: roster([['5859', 'Brian Thomas Jr.']], [['5859', 'Brian Thomas Jr.']]),
      sport: 'NFL' as never,
    })

    expect(cards).toHaveLength(1)
  })
})
