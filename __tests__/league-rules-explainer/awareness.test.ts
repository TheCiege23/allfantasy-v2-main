/**
 * Who has heard about a rule change (lib/league-rules-explainer/awareness.ts and awarenessService.ts):
 * the Chimmy block, the Commish OS task, and the taxi deadline's change card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  league: null as Record<string, unknown> | null,
  events: [] as unknown[],
  rosters: [] as Array<{ platformUserId: string | null }>,
  seenRows: [] as Array<{ userId: string; seen: unknown }>,
  seenOne: null as unknown,
  taxi: vi.fn(),
  upsert: vi.fn(),
  publish: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    roster: { findMany: vi.fn(async () => m.rosters) },
    leagueEvent: { findMany: vi.fn(async () => m.events) },
    appUser: { findUnique: vi.fn(async () => ({ id: 'boss', email: 'b@x', username: 'b' })) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('ANY(') ? m.seenRows : [{ seen: m.seenOne }],
    ),
  },
}))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: m.taxi }))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({ upsertDynastyConfig: m.upsert }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: () => true }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: async () => true }))

import { detectUnseenRuleChange, ruleChangesForChimmy, RULE_CHANGE_NEWS_DAYS } from '@/lib/league-rules-explainer/awareness'
import { buildRuleChangesContextForChimmy, readUnseenRuleChangeTasks } from '@/lib/league-rules-explainer/awarenessService'
import { groupSettingsChanges } from '@/lib/league-rules-explainer/explain'
import { EMPTY_LEAGUE_RULES_SEEN, type LeagueRulesSeen } from '@/lib/league-rules-explainer/view'
import { saveTaxiRules } from '@/lib/taxi/taxiRulesService'

const NOW = new Date('2026-10-20T12:00:00.000Z')
const ev = (id: string, createdAt: string, changes: Array<{ key: string; before: unknown; after: unknown }>, actorUserId = 'boss') => ({ id, createdAt, actorUserId, changes })
const oldEvent = ev('e1', '2026-10-01T12:00:00.000Z', [{ key: 'waiverBudget', before: 100, after: 200 }])
const newEvent = ev('e2', '2026-10-19T12:00:00.000Z', [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }])
const groups = groupSettingsChanges([oldEvent, newEvent], { sport: 'NFL' })
const seenUpTo = (id: string, at: string): LeagueRulesSeen => ({ rulesSeenAt: '2026-09-01T00:00:00.000Z', lastSeenSettingsEventId: id, lastSeenSettingsEventAt: at })

describe('Chimmy', () => {
  it('lists the changes newest first, in the card’s own sentences, marking the ones this manager has not seen', () => {
    const text = ruleChangesForChimmy({ groups, seen: seenUpTo('e1', oldEvent.createdAt), now: NOW })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^\[LEAGUE RULE CHANGES .* you never enforce rules\.\]$/)
    expect(lines[1]).toBe('- Oct 19, 2026 (this manager has not seen this change yet): Trade deadline: Week 12 → Week 13 — trades are allowed one week longer.')
    expect(lines[2]).toMatch(/^- Oct 1, 2026: FAAB budget: \$100 → \$200/)
  })

  it('marks nothing when the seen marker could not be read, and nothing older than two weeks', () => {
    expect(ruleChangesForChimmy({ groups, seen: null, now: NOW })).not.toContain('has not seen')
    const later = new Date(NOW.getTime() + (RULE_CHANGE_NEWS_DAYS + 1) * 86_400_000)
    expect(ruleChangesForChimmy({ groups, seen: EMPTY_LEAGUE_RULES_SEEN, now: later })).not.toContain('has not seen')
  })

  it('adds nothing for a league with no changes', () => {
    expect(ruleChangesForChimmy({ groups: [], seen: null, now: NOW })).toBe('')
  })
})

describe('the Commish OS task', () => {
  const base = { leagueId: 'L1', group: groups[0]!, members: ['a', 'b', 'c'], broadcastsEnabled: true, now: NOW }

  it('counts the managers whose marker is before the newest change, keyed on the change', () => {
    const task = detectUnseenRuleChange({ ...base, seenByUser: new Map([['a', seenUpTo('e2', newEvent.createdAt)], ['b', seenUpTo('e1', oldEvent.createdAt)]]) })
    expect(task).toMatchObject({
      sourceKey: 'rules-unseen:e2:v1',
      title: '2 managers have not seen your latest rule change',
      priority: 'advisory',
      automationCandidate: false,
      relatedLinks: [{ moduleId: 'managers', href: '/core/commissioner?league=L1' }],
    })
    expect(task!.description).toContain('2 of 3 managers have not seen this change yet: Trade deadline: Week 12 → Week 13')
  })

  it('clears itself: everyone has seen it, the change is two weeks old, or members cannot get the card', () => {
    const all = new Map(['a', 'b', 'c'].map((id) => [id, seenUpTo('e2', newEvent.createdAt)]))
    expect(detectUnseenRuleChange({ ...base, seenByUser: all })).toBeNull()
    expect(detectUnseenRuleChange({ ...base, seenByUser: new Map(), now: new Date(NOW.getTime() + RULE_CHANGE_NEWS_DAYS * 86_400_000) })).toBeNull()
    expect(detectUnseenRuleChange({ ...base, seenByUser: new Map(), broadcastsEnabled: false })).toBeNull()
    expect(detectUnseenRuleChange({ ...base, seenByUser: new Map(), group: null })).toBeNull()
    expect(detectUnseenRuleChange({ ...base, seenByUser: new Map(), members: [] })).toBeNull()
  })

  it('one manager reads in the singular', () => {
    expect(detectUnseenRuleChange({ ...base, members: ['a'], seenByUser: new Map() })!.title).toBe('1 manager has not seen your latest rule change')
  })
})

const NATIVE = { userId: 'boss', platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', settings: {} }
const row = (e: ReturnType<typeof ev>) => ({ id: e.id, createdAt: e.createdAt, payload: { ruleChanges: e.changes, actorUserId: e.actorUserId } })

describe('the reads', () => {
  beforeEach(() => {
    m.league = { ...NATIVE }
    m.events = [row(newEvent), row(oldEvent)]
    m.rosters = [{ platformUserId: 'boss' }, { platformUserId: 'a' }, { platformUserId: 'b' }, { platformUserId: null }, { platformUserId: 'b' }]
    m.seenRows = [{ userId: 'a', seen: seenUpTo('e2', newEvent.createdAt) }]
    m.seenOne = seenUpTo('e1', oldEvent.createdAt)
  })

  it('the task excludes the commissioner and duplicate rosters, and reads every member’s marker in one query', async () => {
    const tasks = await readUnseenRuleChangeTasks('L1', NOW)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.title).toBe('1 manager has not seen your latest rule change')
    expect(tasks[0]!.description).toContain('1 of 2 managers')
  })

  it('nothing for an imported league, which has no change history here', async () => {
    m.league = { ...NATIVE, platform: 'sleeper' }
    expect(await readUnseenRuleChangeTasks('L1', NOW)).toEqual([])
    expect(await buildRuleChangesContextForChimmy('L1', 'a', NOW)).toBe('')
  })

  it('Chimmy reads the asking manager’s own marker', async () => {
    const text = await buildRuleChangesContextForChimmy('L1', 'b', NOW)
    expect(text).toContain('(this manager has not seen this change yet): Trade deadline')
  })
})

describe('the taxi deadline’s change card', () => {
  beforeEach(() => {
    m.league = { userId: 'boss', platform: 'allfantasy', leagueType: 'dynasty', isDynasty: true, settings: {} }
    m.taxi.mockReset()
    m.upsert.mockReset()
    m.publish.mockReset()
  })

  it('a save that moves the deadline publishes the before and after', async () => {
    m.taxi.mockResolvedValueOnce({ taxiDeadlineWeek: 6 }).mockResolvedValueOnce({ taxiDeadlineWeek: 9 })
    expect(await saveTaxiRules('L1', 'boss', { lockAfterWeek: 9 })).toEqual({ ok: true })
    expect(m.upsert).toHaveBeenCalledWith('L1', { taxiDeadlineWeek: 9 })
    expect(m.publish).toHaveBeenCalledWith({ leagueId: 'L1', actorUserId: 'boss', section: 'taxi', changes: [{ key: 'taxiDeadlineWeek', before: 6, after: 9 }] })
  })

  it('a save that does not touch the deadline reads nothing extra', async () => {
    expect(await saveTaxiRules('L1', 'boss', { inSeasonMoves: false })).toEqual({ ok: true })
    expect(m.taxi).not.toHaveBeenCalled()
    expect(m.publish).not.toHaveBeenCalled()
  })
})
