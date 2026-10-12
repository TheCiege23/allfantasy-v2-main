import { describe, expect, it } from 'vitest'
import { buildRecapShareText, isWeeklyRecap } from '@/lib/league-chat/recapShare'
import { planRecapSweep, recapNotificationCopy } from '@/lib/league-chat/weeklyRecapSweep'

/*
 * The weekly recap goes where the league talks: share text with the invite link, every Sleeper league
 * reached (not the same hundred), and one "share it" push per person per week.
 */

const RECAP = [
  '📺 Week 5 recap — Death Squad (2026)',
  '',
  '🏆 Weekly awards',
  '  🚀 Boom of the week: MisterG201, 255.0',
  '',
  'Every number here comes from your real matchups. The full records book is in the Legacy tab.',
].join('\n')

describe('isWeeklyRecap', () => {
  it('is the weekly-awards Chimmy moment carrying the recap card', () => {
    expect(isWeeklyRecap({ weeklyRecap: true, chimmyMoment: { v: 1, kind: 'weekly_awards' } })).toBe(true)
  })
  it('is not another Chimmy moment, a plain message, or a card without the moment', () => {
    expect(isWeeklyRecap({ chimmyMoment: { kind: 'trade' }, weeklyRecap: true })).toBe(false)
    expect(isWeeklyRecap({ weeklyRecap: true })).toBe(false)
    expect(isWeeklyRecap({ chimmyMoment: { kind: 'weekly_awards' } })).toBe(false)
    expect(isWeeklyRecap(null)).toBe(false)
  })
})

describe('buildRecapShareText', () => {
  it('drops the in-app footer and ends with the invite link', () => {
    const text = buildRecapShareText(RECAP, 'https://allfantasy.ai/join?code=ABC123')
    expect(text).not.toContain('Legacy tab')
    expect(text.startsWith('📺 Week 5 recap — Death Squad (2026)')).toBe(true)
    expect(text).toContain('Boom of the week: MisterG201, 255.0')
    expect(text.endsWith("Claim your team for next week's recap: https://allfantasy.ai/join?code=ABC123")).toBe(true)
  })
  it('without a usable link, shares the recap with no dangling claim line', () => {
    for (const link of [null, undefined, '', 'javascript:alert(1)', '/join?code=X']) {
      const text = buildRecapShareText(RECAP, link as never)
      expect(text).not.toMatch(/Claim your team/)
      expect(text.endsWith('— Chimmy, on AllFantasy')).toBe(true)
    }
  })
})

describe('planRecapSweep', () => {
  const L = (id: string, sl = `s-${id}`) => ({ id, platformLeagueId: sl })

  it('skips leagues already recapped this week', () => {
    const plan = planRecapSweep({
      leagues: [L('a'), L('b'), L('c')],
      recappedThisWeek: new Set(['b']),
      warmSleeperIds: new Set(['s-a', 's-b', 's-c']),
      memberCounts: new Map(),
      coldLimit: 10,
    })
    expect(plan.order.map((l) => l.id)).toEqual(['a', 'c'])
    expect(plan.alreadyDone).toBe(1)
  })

  it('visits every league, not a fixed hundred', () => {
    const leagues = Array.from({ length: 528 }, (_, i) => L(`l${String(i).padStart(3, '0')}`))
    const plan = planRecapSweep({
      leagues,
      recappedThisWeek: new Set(),
      warmSleeperIds: new Set(leagues.map((l) => l.platformLeagueId)),
      memberCounts: new Map(),
      coldLimit: 0,
    })
    expect(plan.order).toHaveLength(528)
  })

  it('puts leagues with more AllFantasy members first', () => {
    const plan = planRecapSweep({
      leagues: [L('a'), L('b'), L('c')],
      recappedThisWeek: new Set(),
      warmSleeperIds: new Set(['s-a', 's-b', 's-c']),
      memberCounts: new Map([
        ['c', 4],
        ['b', 2],
      ]),
      coldLimit: 10,
    })
    expect(plan.order.map((l) => l.id)).toEqual(['c', 'b', 'a'])
  })

  it('takes at most `coldLimit` never-synced leagues and defers the rest', () => {
    const plan = planRecapSweep({
      leagues: [L('a'), L('b'), L('c'), L('d')],
      recappedThisWeek: new Set(),
      warmSleeperIds: new Set(['s-d']),
      memberCounts: new Map(),
      coldLimit: 2,
    })
    expect(plan.order.map((l) => l.id)).toEqual(['a', 'b', 'd'])
    expect(plan.coldDeferred).toBe(1)
  })
})

describe('recapNotificationCopy', () => {
  it('names the league and opens its chat for one recap', () => {
    expect(recapNotificationCopy([{ leagueId: 'L1', leagueName: 'Death Squad', week: 5 }])).toEqual({
      title: 'Week 5 recap: Death Squad',
      body: 'Chimmy wrote up your league’s week. Share it in your group chat so everyone sees it.',
      actionHref: '/league/L1?openChat=league',
    })
  })
  it('is one notification for several leagues', () => {
    const copy = recapNotificationCopy([
      { leagueId: 'L1', leagueName: 'Death Squad', week: 5 },
      { leagueId: 'L2', leagueName: 'Iron Horse', week: 5 },
    ])
    expect(copy?.title).toBe('Week 5 recaps are in for 2 of your leagues')
    expect(copy?.actionHref).toBe('/league/L1?openChat=league')
  })
  it('is nothing for no recaps', () => {
    expect(recapNotificationCopy([])).toBeNull()
  })
})
