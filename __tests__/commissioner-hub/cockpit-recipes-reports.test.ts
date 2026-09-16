import { describe, it, expect } from 'vitest'
import {
  RECIPE_KEYS,
  buildRecipeSettingsMerge,
  dueRecipeMessages,
  readRecipeSettings,
  weeklyRecapAllowed,
  type RecipeFacts,
} from '@/lib/core-app/commissioner/recipes'
import {
  collapseQuietSyncs,
  fromAuditLog,
  fromAutomationRun,
  fromSyncRun,
  mergeTimeline,
  recentChanges,
} from '@/lib/core-app/commissioner/timeline'
import {
  activityChart,
  balanceChart,
  dedupeActivity,
  fantasyWeekStart,
  scoringChart,
  waiverParticipationChart,
  type ActivityRow,
} from '@/lib/core-app/commissioner/charts'
import { buildCommunities, buildLeagueAreas, buildWorkflows } from '@/lib/core-app/commissioner/areas'

const NOW = new Date('2026-10-11T12:00:00Z') // Sunday, 8am ET

describe('recipe settings', () => {
  it('defaults the weekly recap ON for Sleeper — it already runs — and everything else off', () => {
    const s = readRecipeSettings({}, 'sleeper')
    expect(s.saved).toBe(false)
    expect(s.values.weeklyRecap).toBe(true)
    expect(RECIPE_KEYS.filter((k) => k !== 'weeklyRecap').every((k) => s.values[k] === false)).toBe(true)
    expect(readRecipeSettings({}, 'espn').values.weeklyRecap).toBe(false)
  })

  it('only an explicit false stops the recap', () => {
    expect(weeklyRecapAllowed(null, 'sleeper')).toBe(true)
    expect(weeklyRecapAllowed({ commissionerRecipes: { recipes: {} } }, 'sleeper')).toBe(true)
    expect(weeklyRecapAllowed({ commissionerRecipes: { recipes: { weeklyRecap: false } } }, 'sleeper')).toBe(false)
  })

  it('always sends the whole object, because settingsMerge is one level deep', () => {
    const current = readRecipeSettings({}, 'sleeper').values
    const merge = buildRecipeSettingsMerge(current, { key: 'votingDeadline', enabled: true }, NOW)
    expect(Object.keys(merge.commissionerRecipes.recipes).sort()).toEqual([...RECIPE_KEYS].sort())
    expect(merge.commissionerRecipes.recipes.weeklyRecap).toBe(true)
    expect(merge.commissionerRecipes.active).toBe(true)
  })

  it('is not "active" for the sender when only the recap is on — the recap has its own cron', () => {
    const current = readRecipeSettings({}, 'sleeper').values
    const merge = buildRecipeSettingsMerge(current, { key: 'weeklyRecap', enabled: true }, NOW)
    expect(merge.commissionerRecipes.active).toBe(false)
  })
})

describe('what the sender posts', () => {
  const facts = (over: Partial<RecipeFacts> = {}): RecipeFacts => ({
    now: NOW,
    leagueName: 'Dragons',
    sport: 'NFL',
    platform: 'sleeper',
    status: 'in_season',
    season: 2026,
    currentWeek: 6,
    playoffStartWeek: 15,
    playoffSpots: 4,
    kickoffs: [new Date('2026-10-11T17:00:00Z')],
    emptyLineups: [{ name: 'Holes', empty: 2 }],
    inactiveTeams: ['Ghost Town'],
    dataStale: false,
    polls: [
      { id: 'p1', question: 'Keepers?', closesAt: '2026-10-11T20:00:00Z' },
      { id: 'p2', question: 'Later', closesAt: '2026-10-20T20:00:00Z' },
    ],
    standings: [
      { name: 'A', wins: 5, losses: 0, ties: 0 },
      { name: 'B', wins: 4, losses: 1, ties: 0 },
    ],
    ...over,
  })
  const allOn = { lineupReminder: true, weeklyRecap: true, inactivityWarning: true, votingDeadline: true, playoffAnnouncement: true }
  const allOff = { lineupReminder: false, weeklyRecap: false, inactivityWarning: false, votingDeadline: false, playoffAnnouncement: false }

  it('posts nothing for switches that are off', () => {
    expect(dueRecipeMessages(allOff, facts())).toEqual([])
  })

  it('reminds on a game day, warns the inactive, and nudges the poll closing today', () => {
    const due = dueRecipeMessages(allOn, facts())
    expect(due.map((d) => d.recipe)).toEqual(['lineupReminder', 'inactivityWarning', 'votingDeadline'])
    expect(due[0].text).toContain('Holes (2)')
    expect(due[0].windowKey).toBe('lineup:2026-10-11')
    // Only the poll closing inside 24 hours.
    expect(due[2].windowKey).toBe('vote:p1')
    // The weekly recap is never posted here — its own cron owns it.
    expect(due.some((d) => d.recipe === 'weeklyRecap')).toBe(false)
  })

  it('skips the lineup reminder on a day with no kickoff, or when every lineup is full', () => {
    expect(dueRecipeMessages(allOn, facts({ kickoffs: [new Date('2026-10-15T00:15:00Z')] })).some((d) => d.recipe === 'lineupReminder')).toBe(false)
    expect(dueRecipeMessages(allOn, facts({ emptyLineups: [] })).some((d) => d.recipe === 'lineupReminder')).toBe(false)
  })

  it('never sends a lineup reminder for an MFL league, whose blank lineups are unreported', () => {
    expect(dueRecipeMessages(allOn, facts({ platform: 'mfl' })).some((d) => d.recipe === 'lineupReminder')).toBe(false)
  })

  it('announces the playoffs once, in the week they start, with the seeds', () => {
    const due = dueRecipeMessages(allOn, facts({ currentWeek: 15 }))
    const playoff = due.find((d) => d.recipe === 'playoffAnnouncement')
    expect(playoff?.windowKey).toBe('playoffs:2026')
    expect(playoff?.text).toContain('1. A (5-0)')
    expect(dueRecipeMessages(allOn, facts({ currentWeek: 14 })).some((d) => d.recipe === 'playoffAnnouncement')).toBe(false)
  })

  it('never posts lineup or inactivity messages off a stale sync — only the poll reminder still goes', () => {
    const due = dueRecipeMessages(allOn, facts({ dataStale: true }))
    expect(due.map((d) => d.recipe)).toEqual(['votingDeadline'])
  })

  it('does not warn about inactivity once the season is over', () => {
    expect(dueRecipeMessages(allOn, facts({ status: 'complete' })).some((d) => d.recipe === 'inactivityWarning')).toBe(false)
  })
})

describe('audit timeline', () => {
  it('merges newest first and drops duplicates', () => {
    const a = fromAuditLog({ id: '1', actionType: 'settings_patch', entityType: 'league', metadata: { updatedFields: ['tradeDeadlineWeek'] }, createdAt: new Date('2026-10-10T00:00:00Z'), actorName: 'Commish' })
    const b = fromAutomationRun({ id: '2', jobType: 'workspace.refreshTasks', status: 'completed', startedAt: new Date('2026-10-11T00:00:00Z'), finishedAt: null, metadata: { opened: 2, autoResolved: 0, detected: 2 } })
    const merged = mergeTimeline([a, b, a])
    expect(merged.map((e) => e.id)).toEqual(['automation:2', 'audit:1'])
    expect(a.kind).toBe('rules')
    expect(a.detail).toBe('Updated Trade deadline week.')
    expect(b.detail).toBe('2 new tasks.')
  })

  it('collapses a run of successful syncs into one row, but never across other events', () => {
    const sync = (id: string, at: string, rows = 0) =>
      fromSyncRun({ id, status: 'success', rowsWritten: rows, errorMessage: null, startedAt: new Date(at), completedAt: null }, 'Sleeper')
    const change = fromAuditLog({ id: 'c', actionType: 'settings_patch', entityType: 'league', metadata: null, createdAt: new Date('2026-10-10T12:00:00Z'), actorName: null })
    const out = collapseQuietSyncs(
      mergeTimeline([
        sync('q1', '2026-10-11T03:00:00Z'),
        sync('q2', '2026-10-11T02:00:00Z'),
        sync('q3', '2026-10-11T01:00:00Z', 12),
        change,
        sync('q4', '2026-10-10T00:00:00Z'),
        sync('q5', '2026-10-09T23:00:00Z'),
      ]),
    )
    expect(out.map((e) => e.detail)).toEqual([
      '3 syncs · 12 records updated in all.',
      null,
      'Nothing had changed · 2 checks.',
    ])
  })

  it('does not fold a failed sync into the quiet ones', () => {
    const ok = fromSyncRun({ id: 'a', status: 'success', rowsWritten: 0, errorMessage: null, startedAt: new Date('2026-10-11T03:00:00Z'), completedAt: null }, 'Sleeper')
    const bad = fromSyncRun({ id: 'b', status: 'failed', rowsWritten: 0, errorMessage: 'x', startedAt: new Date('2026-10-11T02:00:00Z'), completedAt: null }, 'Sleeper')
    expect(collapseQuietSyncs(mergeTimeline([ok, bad])).map((e) => e.tone)).toEqual(['good', 'bad'])
  })

  it('recent changes shows at most one sync, so a busy sync log cannot crowd out the news', () => {
    const sync = (id: string, at: string) =>
      fromSyncRun({ id, status: 'success', rowsWritten: 3, errorMessage: null, startedAt: new Date(at), completedAt: null }, 'Sleeper')
    const change = fromAuditLog({ id: 'c', actionType: 'commissioner_edit_faab', entityType: 'roster', metadata: null, createdAt: new Date('2026-09-01T00:00:00Z'), actorName: null })
    const list = mergeTimeline([sync('1', '2026-10-11T03:00:00Z'), sync('2', '2026-10-11T02:00:00Z'), sync('3', '2026-10-11T01:00:00Z'), change])
    expect(recentChanges(list).map((e) => e.id)).toEqual(['sync:1', 'audit:c'])
  })

  it('never shows a raw sync error to the commissioner', () => {
    const e = fromSyncRun({ id: 'f', status: 'failed', rowsWritten: 0, errorMessage: 'ECONNRESET token=abc', startedAt: NOW, completedAt: null }, 'Sleeper')
    expect(e.tone).toBe('bad')
    expect(JSON.stringify(e)).not.toContain('token')
  })
})

describe('charts', () => {
  const row = (type: string, at: string, keys: string[] = ['sleeper:1']): ActivityRow => ({
    activityType: type,
    occurredAt: new Date(at),
    managerKeys: keys,
  })

  it('dedupes one event stored under both league id spaces', () => {
    const rows = [row('trade', '2026-10-06T10:00:00Z', ['sleeper:1', 'sleeper:2']), row('trade', '2026-10-06T10:00:00Z', ['sleeper:2', 'sleeper:1'])]
    expect(dedupeActivity(rows)).toHaveLength(1)
  })

  it('buckets fantasy weeks from Tuesday', () => {
    expect(fantasyWeekStart(new Date('2026-10-12T23:00:00Z')).toISOString().slice(0, 10)).toBe('2026-10-06')
    expect(fantasyWeekStart(new Date('2026-10-13T01:00:00Z')).toISOString().slice(0, 10)).toBe('2026-10-13')
  })

  it('charts eight weeks ending this week', () => {
    const chart = activityChart([row('waiver', '2026-10-07T00:00:00Z'), row('trade', '2026-07-01T00:00:00Z')], NOW)
    expect(chart.bars).toHaveLength(8)
    expect(chart.bars[7].value).toBe(1)
    // Outside the window — not counted, not crashing.
    expect(chart.bars.reduce((n, b) => n + b.value, 0)).toBe(1)
  })

  it('names managers with no waiver claim rather than hiding them', () => {
    const chart = waiverParticipationChart(
      [row('waiver', '2026-10-07T00:00:00Z', ['sleeper:1']), row('waiver', '2026-10-08T00:00:00Z', ['sleeper:9'])],
      [{ key: '1', name: 'Active' }, { key: '2', name: 'Silent' }],
    )
    expect(chart.bars.map((b) => [b.label, b.value])).toEqual([['Active', 1], ['Silent', 0]])
    expect(chart.takeaway).toBe('1 of 2 managers have made a claim · 2 claims in all.')
  })

  it('shows every team in the balance chart — no ten-bar cap', () => {
    const teams = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, wins: i % 4, losses: 3 - (i % 4), ties: 0, pointsFor: 400 + i * 10 }))
    expect(balanceChart(teams)?.bars).toHaveLength(12)
    expect(balanceChart([teams[0]])).toBeNull()
  })

  it('ignores 0–0 placeholder weeks when charting scoring', () => {
    const chart = scoringChart([
      { week: 1, pointsFor: 100, pointsAgainst: 90, matchupId: 1 },
      { week: 1, pointsFor: 120, pointsAgainst: 80, matchupId: 1 },
      { week: 2, pointsFor: 0, pointsAgainst: 0, matchupId: 2 },
    ])
    expect(chart?.bars.map((b) => b.label)).toEqual(['Wk 1'])
    expect(chart?.bars[0].value).toBe(110)
  })
})

describe('league areas, guides and connections', () => {
  const sleeper = { id: 'L1', name: 'Dragons', platform: 'sleeper', platformLeagueId: '1180000000000000000', season: 2026, native: false }
  const native = { id: 'L2', name: 'Home', platform: 'manual', platformLeagueId: null, season: 2026, native: true }

  it('lists all ten league areas, each with a working in-app link', () => {
    const areas = buildLeagueAreas(sleeper)
    expect(areas.map((a) => a.key)).toEqual([
      'overview',
      'settings',
      'members',
      'standings',
      'schedule',
      'drafts',
      'trades',
      'waivers',
      'history',
      'announcements',
    ])
    for (const a of areas) {
      expect(a.link.external).toBe(false)
      expect(a.link.href.startsWith('/')).toBe(true)
      expect(a.link.href).toContain('L1')
    }
  })

  it('sends an imported league’s rule change to its platform, and a native one to settings', () => {
    const imported = buildWorkflows(sleeper).find((w) => w.key === 'change-rule')
    expect(imported?.authorityNote).toContain('Sleeper')
    expect(imported?.steps.some((s) => s.title === 'Make the change on Sleeper')).toBe(true)
    expect(imported?.steps.some((s) => s.link?.href.startsWith('/core/sync'))).toBe(true)

    const home = buildWorkflows(native).find((w) => w.key === 'change-rule')
    expect(home?.authorityNote).toBeNull()
    expect(home?.steps.some((s) => s.title === 'Apply it in settings')).toBe(true)
  })

  it('has four guides, each with at least three steps', () => {
    const wfs = buildWorkflows(sleeper)
    expect(wfs.map((w) => w.key)).toEqual(['replace-manager', 'change-rule', 'schedule-draft', 'resolve-dispute'])
    for (const w of wfs) expect(w.steps.length).toBeGreaterThanOrEqual(3)
  })

  it('offers Discord setup only to the league owner', () => {
    const base = {
      league: sleeper,
      discord: null,
      datedEventCount: 0,
      payment: { link: null, provider: null, tracked: false },
      claimedTeams: 3,
      totalTeams: 12,
    }
    const owner = buildCommunities({ ...base, viewerIsOwner: true }).find((c) => c.key === 'discord')
    const co = buildCommunities({ ...base, viewerIsOwner: false }).find((c) => c.key === 'discord')
    expect(owner?.link?.href).toBe('/core/discord?league=L1')
    expect(co?.link).toBeNull()
    expect(co?.status).toBe('unavailable')
  })

  it('links a payment page only when one is set', () => {
    const channels = buildCommunities({
      league: native,
      viewerIsOwner: true,
      discord: null,
      datedEventCount: 2,
      payment: { link: 'https://www.leaguesafe.com/l/1', provider: 'leaguesafe', tracked: true },
      claimedTeams: 0,
      totalTeams: 10,
    })
    const pay = channels.find((c) => c.key === 'payments')
    expect(pay?.link).toEqual({ label: 'Open LeagueSafe', href: 'https://www.leaguesafe.com/l/1', external: true })
    expect(channels.find((c) => c.key === 'calendar')?.status).toBe('available')
    expect(channels.find((c) => c.key === 'announcements')?.status).toBe('unavailable')
  })
})
