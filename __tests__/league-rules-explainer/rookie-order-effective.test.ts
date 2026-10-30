/**
 * The rules popup's rookie draft order is the order the draft ENGINE seats from. The engine applies the
 * weighted lottery, then the live rookie order, then the automatic order (`settings.rookie_draft_order`);
 * the popup used to print the dynasty config's method whatever was on. EN + ES, and the save routes that
 * move the order publish a "What changed" card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, publishRuleChangesEvent } = vi.hoisted(() => ({
  db: { league: { findUnique: vi.fn() }, dynastyLeagueConfig: { findUnique: vi.fn() } },
  publishRuleChangesEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent }))

import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { effectiveDynastyRules, effectiveRookieDraftOrder, ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { publishRookieDraftOrderChange } from '@/lib/league-rules-explainer/rookieOrderChange'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k

const AUTO_WORST = { rookie_draft_order: { mode: 'worst_to_first', enabled: true } }
const AUTO_PF = { rookie_draft_order: { mode: 'reverse_max_pf', enabled: true } }
const LIVE = { rookie_draft_order: { mode: 'worst_to_first', enabled: false, live: { enabled: true } } }

describe('effectiveRookieDraftOrder — the engine’s precedence', () => {
  it('the weighted lottery wins over everything', () => {
    expect(effectiveRookieDraftOrder('weighted_lottery', LIVE)).toBe('weighted_lottery')
    expect(effectiveRookieDraftOrder('weighted_lottery', AUTO_PF)).toBe('weighted_lottery')
  })
  it('then the live order, then the automatic order', () => {
    expect(effectiveRookieDraftOrder('max_pf', LIVE)).toBe('live')
    expect(effectiveRookieDraftOrder('max_pf', AUTO_WORST)).toBe('auto_worst_to_first')
    expect(effectiveRookieDraftOrder('reverse_standings', AUTO_PF)).toBe('auto_reverse_max_pf')
  })
  it('a switched-off automatic order leaves the config’s own method', () => {
    expect(effectiveRookieDraftOrder('max_pf', { rookie_draft_order: { mode: 'reverse_max_pf', enabled: false } })).toBe('max_pf')
    expect(effectiveRookieDraftOrder('reverse_standings', {})).toBe('reverse_standings')
    expect(effectiveRookieDraftOrder(null, null)).toBeNull()
  })
})

const row: RulesLeagueRow = {
  platform: 'allfantasy',
  sport: 'NFL',
  leagueType: 'dynasty',
  isDynasty: true,
  leagueSize: 12,
  scoring: 'ppr',
  playoffTeams: 6,
  playoffStartWeek: 15,
  waiverType: 'faab',
  waiverBudget: 100,
  settings: { scoring_mode: 'points' },
}
const dynastyLines = (settings: Record<string, unknown>, lang: 'en' | 'es') => {
  const s = { ...ruleSnapshotFromLeague({ ...row, settings }), ...effectiveDynastyRules({ rookiePickOrderMethod: 'max_pf' }, settings) }
  return explainLeagueRules(s)
    .filter((x) => x.id === 'dynasty')
    .flatMap((x) => x.lines.map((l) => renderRuleText(l.text, t(lang), lang)))
}

describe('the popup says the order the engine uses', () => {
  it('in English', () => {
    expect(dynastyLines(AUTO_WORST, 'en').join('\n')).toContain('teams that missed the playoffs pick first, worst record first')
    expect(dynastyLines(AUTO_PF, 'en').join('\n')).toContain('lowest max PF first')
    expect(dynastyLines(LIVE, 'en').join('\n')).toContain('the live rookie order')
    // the config's method still reads when nothing overrides it
    expect(dynastyLines({}, 'en').join('\n')).toContain('lowest possible points (max PF)')
  })
  it('in Spanish, with no raw keys and no «waiver»', () => {
    for (const s of [AUTO_WORST, AUTO_PF, LIVE]) {
      const lines = dynastyLines(s, 'es')
      for (const l of lines) {
        expect(l).not.toMatch(/leagueRules\.|\{\{|undefined/)
        expect(l.toLowerCase()).not.toContain('waiver')
      }
    }
    expect(dynastyLines(AUTO_WORST, 'es').join('\n')).toContain('del peor récord al mejor')
  })
  it('a change between orders renders as a "What changed" line in both languages', () => {
    const line = explainRuleChange({ key: 'rookieDraftOrder', before: 'max_pf', after: 'auto_worst_to_first' })
    expect(line).not.toBeNull()
    expect(JSON.stringify(renderChangeLine(line!, t('en'), 'en'))).toContain('Automatic: worst record first')
    expect(JSON.stringify(renderChangeLine(line!, t('es'), 'es'))).toContain('Automático: peor récord primero')
  })
})

describe('publishRookieDraftOrderChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.dynastyLeagueConfig.findUnique.mockResolvedValue({ rookiePickOrderMethod: 'max_pf' })
  })
  it('publishes one card when the order the engine uses moves', async () => {
    db.league.findUnique.mockResolvedValue({ settings: AUTO_WORST })
    await publishRookieDraftOrderChange({ leagueId: 'L1', actorUserId: 'u1', settingsBefore: {} })
    expect(publishRuleChangesEvent).toHaveBeenCalledWith({
      leagueId: 'L1',
      actorUserId: 'u1',
      section: 'rookie-draft-order',
      changes: [{ key: 'rookieDraftOrder', before: 'max_pf', after: 'auto_worst_to_first' }],
    })
  })
  it('publishes nothing when the effective order is unchanged', async () => {
    db.league.findUnique.mockResolvedValue({ settings: AUTO_WORST })
    await publishRookieDraftOrderChange({ leagueId: 'L1', actorUserId: 'u1', settingsBefore: AUTO_WORST })
    // a lottery league's order does not move whatever the automatic setting says
    db.dynastyLeagueConfig.findUnique.mockResolvedValue({ rookiePickOrderMethod: 'weighted_lottery' })
    await publishRookieDraftOrderChange({ leagueId: 'L1', actorUserId: 'u1', settingsBefore: {} })
    expect(publishRuleChangesEvent).not.toHaveBeenCalled()
  })
  it('never throws', async () => {
    db.league.findUnique.mockRejectedValue(new Error('db down'))
    await expect(publishRookieDraftOrderChange({ leagueId: 'L1', actorUserId: 'u1', settingsBefore: {} })).resolves.toBeUndefined()
  })
})
