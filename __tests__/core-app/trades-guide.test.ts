import { describe, expect, it } from 'vitest'
import { summarizeTrades, tradesChips, tradesHeadline } from '@/lib/core-app/tradesGuide'
import { tradesGuideMessages } from '@/lib/core-app/messages/tradesGuide'
import type { PendingTrade, TradeWindowRow } from '@/lib/core-app/tradesBoard'

const row = (over: Partial<TradeWindowRow>): TradeWindowRow => ({
  leagueId: 'L',
  leagueName: 'League',
  platform: 'sleeper',
  logoUrl: null,
  deadlineWeek: 12,
  noDeadline: false,
  weeksLeft: 2,
  regularSeasonLength: 14,
  tradesOnFile: 0,
  latest: null,
  href: '#',
  reasoning: '',
  ...over,
})
const pending = (youProposed: boolean): PendingTrade =>
  ({ id: String(Math.random()), leagueId: 'L', leagueName: 'League', platform: 'native', logoUrl: null, status: 'pending', expiresAt: null, youProposed, items: [] }) as PendingTrade

describe('summarizeTrades', () => {
  it('counts offers sent TO you, leagues with new trades, deadlines this week or next, and open windows', () => {
    const s = summarizeTrades({
      pending: [pending(false), pending(true)],
      windows: [
        row({ freshTrade: true, weeksLeft: 0 }),
        row({ freshTrade: true, weeksLeft: 1 }),
        row({ weeksLeft: 2 }),
        row({ weeksLeft: -1 }),
        row({ weeksLeft: null }),
      ],
    })
    expect(s).toEqual({ offersWaiting: 1, newTrades: 2, deadlinesSoon: 2, openLeagues: 3 })
  })

  it('returns null with no board, and the headline then says only what the page is', () => {
    expect(summarizeTrades(null)).toBeNull()
    expect(tradesHeadline(null)).toEqual({ kind: 'unknown' })
    expect(tradesChips(null)).toEqual([])
  })
})

describe('tradesHeadline', () => {
  it('an offer to answer beats news, and news beats a quiet week', () => {
    expect(tradesHeadline({ offersWaiting: 2, newTrades: 5, deadlinesSoon: 0, openLeagues: 3 })).toEqual({ kind: 'offers', n: 2 })
    expect(tradesHeadline({ offersWaiting: 0, newTrades: 5, deadlinesSoon: 0, openLeagues: 3 })).toEqual({ kind: 'new', n: 5 })
    expect(tradesHeadline({ offersWaiting: 0, newTrades: 0, deadlinesSoon: 1, openLeagues: 3 })).toEqual({ kind: 'quiet' })
  })
})

describe('tradesChips', () => {
  it('shows the offers chip only when there is an offer, and a zero links nowhere', () => {
    const quiet = tradesChips({ offersWaiting: 0, newTrades: 0, deadlinesSoon: 2, openLeagues: 4 })
    expect(quiet.map((c) => c.key)).toEqual(['new', 'deadlines', 'open'])
    expect(quiet.find((c) => c.key === 'new')).toMatchObject({ value: 0, href: null })
    expect(quiet.find((c) => c.key === 'deadlines')).toMatchObject({ value: 2, href: '#af-tg-trades', tone: 'warn' })

    const busy = tradesChips({ offersWaiting: 1, newTrades: 3, deadlinesSoon: 0, openLeagues: 4 })
    expect(busy[0]).toMatchObject({ key: 'offers', value: 1, href: '#af-tr-pending', tone: 'bad' })
    expect(busy).toHaveLength(4)
  })
})

describe('trades guide copy', () => {
  it('reads plainly in both languages and never says «waiver» in Spanish', () => {
    expect(tradesGuideMessages.en.headOffers(1)).toBe('1 trade offer is waiting for you')
    expect(tradesGuideMessages.en.headNew(2)).toBe('New trades in 2 of your leagues this week')
    expect(tradesGuideMessages.en.offersNone(8, 82)).toBe('No offers waiting in the 8 leagues checked so far.')
    expect(tradesGuideMessages.en.offersNone(4, 4)).toBe('No offers waiting in your 4 leagues.')
    const es = JSON.stringify(Object.values(tradesGuideMessages.es!).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(es.toLowerCase()).not.toMatch(/waiver/)
  })
})
