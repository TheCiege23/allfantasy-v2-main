/**
 * The rules popup's Draft section (2026-10-29): the league's main draft — type, rounds, pick clock,
 * overnight pause, what happens when a clock runs out, the order, third-round reversal, the auction
 * budget, the schedule and who drafts for a team without a manager. English and Spanish, nothing raw
 * on screen, a completed draft labelled as complete, and a "What changed" line for each key.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { draftRulesFromInputs, ruleSnapshotFromLeague, type DraftRuleInputs, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import type { RuleSection, RuleSnapshot } from '@/lib/league-rules-explainer/types'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
const render = (sections: RuleSection[], lang: 'en' | 'es') =>
  sections.flatMap((s) => [renderRuleText(s.title, t(lang), lang), ...s.lines.map((l) => renderRuleText(l.text, t(lang), lang))])
function expectClean(lines: string[], lang: 'en' | 'es') {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\.|\{\{|\}\}|[{}"[\]]|undefined|null|NaN|\[object/)
    if (lang === 'es') expect(l.toLowerCase(), l).not.toContain('waiver')
  }
}

const inputs = (over: Partial<DraftRuleInputs> = {}): DraftRuleInputs => ({
  sessionLabel: null,
  sessionStatus: 'pre_draft',
  draftType: 'snake',
  rounds: 15,
  pickSeconds: 90,
  thirdRoundReversal: false,
  timerMode: 'per_pick',
  pauseWindow: null,
  picksDuringPause: false,
  autoPickEnabled: true,
  cpuAutoPick: true,
  autopickBehavior: 'queue-first',
  orderMethod: 'manual',
  auction: null,
  startAt: '2026-09-01T23:30:00.000Z',
  autostart: true,
  orphanEnabled: false,
  orphanMode: 'cpu',
  ...over,
})

const row: RulesLeagueRow = { platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', leagueSize: 12, scoring: 'ppr', playoffTeams: 6, settings: {} }
const league = (draft: Partial<RuleSnapshot>, r: RulesLeagueRow = row): RuleSnapshot => ({ ...ruleSnapshotFromLeague(r), ...draft })
const draftSection = (s: RuleSnapshot, lang: 'en' | 'es' = 'en') => render(explainLeagueRules(s).filter((x) => x.id === 'draft'), lang)

describe('draftRulesFromInputs — what each stored value means', () => {
  it('a snake draft with a clock, from the queue then best available', () => {
    expect(draftRulesFromInputs(inputs())).toEqual({
      draftStatus: 'scheduled',
      draftType: 'snake',
      draftRounds: 15,
      draftPickSeconds: 90,
      draftOvernightPause: null,
      draftOnTimeout: 'autopick',
      draftOrderMethod: 'manual',
      draftThirdRoundReversal: false,
      draftAuctionBudget: null,
      draftAuctionMinBid: null,
      draftStartAt: '2026-09-01T23:30:00.000Z',
      draftAutostart: true,
      draftOrphanPicks: null,
    })
  })

  it('the clock waits when auto-pick is off, the timer is soft, or the CPU autopick is off; `skip` skips', () => {
    expect(draftRulesFromInputs(inputs({ autoPickEnabled: false })).draftOnTimeout).toBe('wait')
    expect(draftRulesFromInputs(inputs({ timerMode: 'soft_pause' })).draftOnTimeout).toBe('wait')
    expect(draftRulesFromInputs(inputs({ cpuAutoPick: false })).draftOnTimeout).toBe('wait')
    expect(draftRulesFromInputs(inputs({ autopickBehavior: 'skip' })).draftOnTimeout).toBe('skip')
  })

  it('an untimed draft has no clock and no timeout rule', () => {
    const r = draftRulesFromInputs(inputs({ timerMode: 'none' }))
    expect(r.draftPickSeconds).toBeNull()
    expect(r.draftOnTimeout).toBeNull()
  })

  it('an auction has a budget, a minimum bid and a bid clock, but no pick order and no 3RR', () => {
    const r = draftRulesFromInputs(inputs({ draftType: 'auction', pickSeconds: 35, auction: { budget: 200, minBid: 1 }, thirdRoundReversal: true }))
    expect(r).toMatchObject({ draftType: 'auction', draftAuctionBudget: 200, draftAuctionMinBid: 1, draftPickSeconds: 35, draftOrderMethod: null, draftThirdRoundReversal: null, draftOnTimeout: null })
  })

  it('the overnight pause needs the overnight mode and two real clock times', () => {
    expect(draftRulesFromInputs(inputs({ timerMode: 'overnight_pause', pauseWindow: { start: '22:00', end: '08:00' }, picksDuringPause: true })).draftOvernightPause).toEqual({
      from: '22:00',
      to: '08:00',
      picksAllowed: true,
    })
    expect(draftRulesFromInputs(inputs({ timerMode: 'overnight_pause', pauseWindow: { start: '25:00', end: '08:00' } })).draftOvernightPause).toBeNull()
    expect(draftRulesFromInputs(inputs({ timerMode: 'per_pick', pauseWindow: { start: '22:00', end: '08:00' } })).draftOvernightPause).toBeNull()
  })

  it('a dynasty rookie draft is the Dynasty section’s, not this one', () => {
    expect(draftRulesFromInputs(inputs({ sessionLabel: 'rookie' }))).toEqual({})
  })

  it('unknown values are dropped, never kept raw', () => {
    const r = draftRulesFromInputs(inputs({ draftType: 'mystery', orderMethod: 'vibes', startAt: 'soon' }))
    expect(r.draftType).toBeNull()
    expect(r.draftOrderMethod).toBeNull()
    expect(r.draftStartAt).toBeNull()
    expect(r.draftAutostart).toBeNull()
  })

  it('who drafts for a team without a manager', () => {
    expect(draftRulesFromInputs(inputs({ orphanEnabled: true, orphanMode: 'ai' })).draftOrphanPicks).toBe('ai')
    expect(draftRulesFromInputs(inputs({ orphanEnabled: true, orphanMode: 'cpu' })).draftOrphanPicks).toBe('cpu')
  })

  it('a started draft reads as under way, a finished one as complete', () => {
    expect(draftRulesFromInputs(inputs({ sessionStatus: 'paused' })).draftStatus).toBe('in_progress')
    expect(draftRulesFromInputs(inputs({ sessionStatus: 'completed' })).draftStatus).toBe('completed')
    expect(draftRulesFromInputs(inputs({ sessionStatus: null })).draftStatus).toBe('scheduled')
  })
})

describe('the Draft section', () => {
  const snake = draftRulesFromInputs(
    inputs({
      thirdRoundReversal: true,
      pickSeconds: 28800,
      timerMode: 'overnight_pause',
      pauseWindow: { start: '22:00', end: '08:00' },
      orderMethod: 'weighted_lottery',
      orphanEnabled: true,
      orphanMode: 'ai',
    }),
  )

  it('in English', () => {
    const lines = draftSection(league(snake))
    expectClean(lines, 'en')
    expect(lines[0]).toBe('Draft')
    expect(lines).toEqual(
      expect.arrayContaining([
        'The draft is a snake draft with 15 rounds: the order reverses every round, so the team that picks last in one round picks first in the next.',
        'Third-round reversal: round 3 goes in the same order as round 2, then the order keeps reversing from there.',
        'Each pick has 8 hours on the clock.',
        'Overnight, the clock stops from 22:00 to 08:00 (league time).',
        'If a manager’s clock runs out, a pick is made for them: the first available player in their queue, otherwise the best player available.',
        'The draft order is set by a weighted lottery.',
        'Teams without a manager are drafted by Chimmy, the AI manager.',
      ]),
    )
    expect(lines.some((l) => l.startsWith('The draft is scheduled for ') && l.endsWith('and starts by itself at that time.'))).toBe(true)
  })

  it('in Spanish, never saying waiver', () => {
    const lines = draftSection(league(snake), 'es')
    expectClean(lines, 'es')
    expect(lines).toContain('Cada selección tiene 8 horas de reloj.')
    expect(lines).toContain('El orden del draft lo decide una lotería ponderada.')
  })

  it('an auction names its budget and bid clock', () => {
    const lines = draftSection(league(draftRulesFromInputs(inputs({ draftType: 'auction', pickSeconds: 35, rounds: 16, auction: { budget: 200, minBid: 1 } }))))
    expectClean(lines, 'en')
    expect(lines).toEqual(
      expect.arrayContaining([
        'The draft is an auction: managers bid on players instead of taking turns. Each team buys 16 players.',
        'Each team has $200 to spend, and the lowest bid is $1.',
        'Bidding on a player closes after 35 seconds without a new bid.',
      ]),
    )
  })

  it('a draft with no clock and no date says so', () => {
    const lines = draftSection(league(draftRulesFromInputs(inputs({ timerMode: 'none', startAt: null, draftType: 'linear' }))))
    expect(lines).toEqual(
      expect.arrayContaining(['There is no pick clock: each manager takes as long as they need.', 'The draft has not been scheduled yet.', 'The draft has 15 rounds, in the same order every round.']),
    )
    expect(lines.join(' ')).not.toContain('clock runs out')
  })

  it('a completed draft stays, labelled complete, with no schedule line', () => {
    const lines = draftSection(league(draftRulesFromInputs(inputs({ sessionStatus: 'completed' }))))
    expect(lines[0]).toBe('Draft (complete)')
    expect(lines[1]).toBe('The draft is complete. These settings no longer change anything this season.')
    expect(lines.join(' ')).not.toContain('scheduled')
    const es = draftSection(league(draftRulesFromInputs(inputs({ sessionStatus: 'completed' }))), 'es')
    expect(es[0]).toBe('Draft (terminado)')
  })

  it.each([
    ['redraft', { leagueType: 'redraft' }],
    ['guillotine', { leagueType: 'guillotine', guillotineMode: true }],
    ['keeper', { leagueType: 'keeper' }],
    ['dynasty', { leagueType: 'dynasty', isDynasty: true }],
    ['best ball', { leagueType: 'best_ball', bestBallMode: true }],
    ['survivor', { leagueType: 'survivor', survivorMode: true }],
  ])('is in a %s league', (_name, over) => {
    const s = league(draftRulesFromInputs(inputs()), { ...row, ...over })
    expect(explainLeagueRules(s).map((x) => x.id)).toContain('draft')
  })

  it('an imported league, or a league with no draft read, has no Draft section', () => {
    expect(explainLeagueRules({ ...league(draftRulesFromInputs(inputs())), importedFrom: 'sleeper' }).map((x) => x.id)).not.toContain('draft')
    expect(explainLeagueRules(league({})).map((x) => x.id)).not.toContain('draft')
  })

  it('an unknown value drops its line, never shows raw', () => {
    const lines = draftSection(league({ ...draftRulesFromInputs(inputs()), draftOnTimeout: 'teleport', draftOrderMethod: 'vibes', draftOrphanPicks: 'ghost' } as RuleSnapshot))
    expectClean(lines, 'en')
    expect(lines.join(' ')).not.toMatch(/clock runs out|draft order|without a manager/)
  })
})

describe('"What changed" lines for the draft keys', () => {
  const en = t('en')
  const es = t('es')
  const line = (key: string, before: unknown, after: unknown, lang: 'en' | 'es' = 'en') => {
    const l = explainRuleChange({ key, before, after })
    return l ? renderChangeLine(l, lang === 'en' ? en : es, lang) : null
  }

  it('in English', () => {
    expect(line('draftPickSeconds', 90, 28800)).toBe('Pick clock: 90 seconds → 8 hours')
    expect(line('draftPickSeconds', 120, null)).toBe('Pick clock: 2 minutes → No clock')
    expect(line('draftType', 'snake', 'auction')).toBe('Draft type: Snake → Auction — managers now bid on players instead of taking turns.')
    expect(line('draftRounds', 15, 16)).toBe('Draft rounds: 15 rounds → 16 rounds — every team drafts 1 more player.')
    expect(line('draftOnTimeout', 'autopick', 'wait')).toBe(
      'When the clock runs out: Pick from the queue, else the best available → Wait for the manager — If a manager’s clock runs out, the draft waits for them: nobody picks on their behalf.',
    )
    expect(line('draftThirdRoundReversal', false, true)).toBe(
      'Third-round reversal: Off → On — Third-round reversal: round 3 goes in the same order as round 2, then the order keeps reversing from there.',
    )
    expect(line('draftAutostart', true, false)).toBe('Draft starts by itself: On → Off — the commissioner now starts the draft.')
    expect(line('draftOrphanPicks', null, 'ai')).toBe('Drafting for teams without a manager: Off → Chimmy — Teams without a manager are drafted by Chimmy, the AI manager.')
    expect(line('draftOvernightPause', null, { from: '22:00', to: '08:00', picksAllowed: false })).toBe('Overnight clock pause: Off → 22:00–08:00')
    expect(line('draftAuctionBudget', 200, 300)).toBe('Auction budget: $200 → $300')
    expect(line('draftStartAt', null, '2026-09-01T23:30:00.000Z')).toMatch(/^Draft time: Not scheduled → .+2026/)
    expect(line('draftOrderMethod', 'manual', 'random')).toBe('Draft order: Set by the commissioner → Random draw — The draft order is drawn at random.')
  })

  it('in Spanish, never saying waiver', () => {
    const all = [
      line('draftPickSeconds', 90, 86400, 'es'),
      line('draftType', 'linear', 'snake', 'es'),
      line('draftOnTimeout', 'wait', 'skip', 'es'),
      line('draftOrphanPicks', 'cpu', null, 'es'),
      line('draftRounds', 16, 14, 'es'),
    ]
    expect(all[0]).toBe('Reloj de selección: 90 segundos → 1 día')
    expect(all[4]).toBe('Rondas del draft: 16 rondas → 14 rondas — cada equipo elige 2 jugadores menos.')
    for (const l of all) {
      expect(l).not.toBeNull()
      expect(l!).not.toMatch(/waiver|leagueRules\.|\{\{/i)
    }
  })

  it('an unknown value yields no line', () => {
    expect(explainRuleChange({ key: 'draftType', before: 'snake', after: 'mystery' })).toBeNull()
    expect(explainRuleChange({ key: 'draftOnTimeout', before: 'wait', after: { evil: true } })).toBeNull()
    // Not a rule: never a change.
    expect(explainRuleChange({ key: 'draftStatus', before: 'scheduled', after: 'completed' })).toBeNull()
    expect(explainRuleChange({ key: 'draftAuctionMinBid', before: 1, after: 2 })).toBeNull()
  })

  it('the diff carries only the draft keys that moved, never the status or the minimum bid', () => {
    const before = draftRulesFromInputs(inputs())
    const after = draftRulesFromInputs(inputs({ pickSeconds: 60, sessionStatus: 'in_progress' }))
    expect(diffRuleSnapshots(before, after)).toEqual([{ key: 'draftPickSeconds', before: 90, after: 60 }])
  })
})
