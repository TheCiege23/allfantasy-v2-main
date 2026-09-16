import { describe, expect, it } from 'vitest'
import {
  HOME_CARD_GROUPS,
  orderHomeCards,
  parseCardUsage,
  recordCardUse,
  serializeCardUsage,
  timeSensitiveCards,
  USAGE_MIN_TAPS,
} from '@/lib/core-app/homeCardOrder'

const none = new Set<string>()

describe('orderHomeCards', () => {
  it('is the designed order with no usage and nothing live', () => {
    const order = orderHomeCards({ usage: {}, timeSensitive: none })
    expect(order.bands).toEqual([...HOME_CARD_GROUPS.bands])
    expect(order.main).toEqual([...HOME_CARD_GROUPS.main])
    expect(order.side).toEqual([...HOME_CARD_GROUPS.side])
    expect(order.stack).toEqual([...HOME_CARD_GROUPS.stack])
  })

  it('lifts a card only past the tap threshold — one stray tap moves nothing', () => {
    const below = orderHomeCards({ usage: { rivals: USAGE_MIN_TAPS - 1 }, timeSensitive: none })
    expect(below.side).toEqual(['chimmy', 'career', 'rivals'])
    const above = orderHomeCards({ usage: { rivals: USAGE_MIN_TAPS, career: USAGE_MIN_TAPS + 4 }, timeSensitive: none })
    expect(above.side).toEqual(['career', 'rivals', 'chimmy'])
  })

  it('puts a live section ahead of a habit, and keeps every card inside its own group', () => {
    const order = orderHomeCards({
      usage: { schedule: 40, routine: 40 },
      timeSensitive: timeSensitiveCards({ gameDayActive: true, draftLive: true }),
    })
    expect(order.bands.slice(0, 3)).toEqual(['game-day', 'drafts', 'schedule'])
    expect(order.main).toEqual(['matchups', 'routine'])
    for (const group of Object.keys(HOME_CARD_GROUPS) as Array<keyof typeof HOME_CARD_GROUPS>) {
      expect([...order[group]].sort()).toEqual([...HOME_CARD_GROUPS[group]].sort())
    }
  })
})

describe('card usage cookie', () => {
  it('round-trips, and ignores unknown cards and junk', () => {
    const usage = parseCardUsage(serializeCardUsage({ rivals: 4, career: 1 }))
    expect(usage).toEqual({ rivals: 4, career: 1 })
    expect(parseCardUsage('rivals:4.hack:9.career:-1.matchups:x.%E0%A4%A')).toEqual({})
    expect(parseCardUsage('rivals:4.hack:9.career:-1.matchups:x')).toEqual({ rivals: 4 })
  })

  it('counts a tap, ignores an unknown card, and decays once the total is large', () => {
    expect(recordCardUse({}, 'rivals')).toEqual({ rivals: 1 })
    expect(recordCardUse({ rivals: 2 }, 'not-a-card')).toEqual({ rivals: 2 })
    const decayed = recordCardUse({ rivals: 100, career: 20, chimmy: 1 }, 'career')
    expect(decayed).toEqual({ rivals: 50, career: 10 })
  })
})
