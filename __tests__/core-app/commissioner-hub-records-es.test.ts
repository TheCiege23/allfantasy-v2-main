/**
 * The Commissioner Hub's records in Spanish (2026-10-05): the league calendar (and its .ics name),
 * the charts, the audit log and the automation catalog.
 *
 * - Calendar and charts are written in the reader's language at the source (`pickLanguage`).
 * - The audit log stays English as data — `collapseQuietSyncs` parses its own "N records updated" —
 *   and is worded at render by `hubCopy`, so its Spanish is checked after that pass.
 * - The automation catalog is worded for the hub only; `RECIPES`, which the job reads to write the
 *   posts that go into league CHAT, is held byte-identical.
 *
 * The English of every builder is pinned to a snapshot written from the code BEFORE it took a
 * language; every Spanish output is non-empty, different from its English and free of English words.
 */
import { describe, expect, it } from 'vitest'
import { buildIcs, buildLeagueCalendar, type CalendarInput } from '@/lib/core-app/commissioner/calendar'
import {
  activityChart,
  balanceChart,
  engagementChart,
  scoringChart,
  tradesChart,
  waiverParticipationChart,
  type ActivityRow,
  type HubChart,
} from '@/lib/core-app/commissioner/charts'
import {
  collapseQuietSyncs,
  fromAuditLog,
  fromAutomationRun,
  fromBroadcast,
  fromFeedEvent,
  fromImportRun,
  fromSyncRun,
  TIMELINE_KIND_LABEL,
  type TimelineEntry,
} from '@/lib/core-app/commissioner/timeline'
import { RECIPES, recipeCatalogEntry } from '@/lib/core-app/commissioner/recipes'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'
import { untranslatedLiterals } from './helpers/untranslatedLiterals'

type Lang = 'en' | 'es'
const NOW = new Date('2026-10-05T16:00:00Z')
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY)

function calendarCases(language: Lang): Record<string, string[]> {
  const base: CalendarInput = {
    now: NOW, leagueId: 'L1', platformLabel: 'Sleeper', native: true, status: 'in_season', season: 2026,
    draftAt: null, waivers: null, tradeDeadlineWeek: null, noTradeDeadline: false, playoffStartWeek: null,
    currentWeek: 5, weekStarts: new Map([[11, at(40)], [15, at(70)]]), dues: null, polls: [], language,
  } as CalendarInput
  const run = (over: Partial<CalendarInput>) => {
    const c = buildLeagueCalendar({ ...base, ...over, language } as CalendarInput)
    return [...c.events.flatMap((e) => [e.title, e.detail, e.whenLabel]), ...c.gaps]
  }
  return {
    'cal/native-full': run({
      draftAt: at(3), waivers: { type: 'faab', dayOfWeek: 3, timeUtc: '08:00' }, tradeDeadlineWeek: 11, playoffStartWeek: 15,
      dues: { enabled: true, amountLabel: '$50', unpaid: 2 }, polls: [{ id: 'p1', question: 'Xqz?', closesAt: at(1).toISOString() }, { id: 'p2', question: 'Wvb?', closesAt: null }],
    }),
    'cal/native-empty': run({ status: 'pre_draft', waivers: { type: 'faab', dayOfWeek: null, timeUtc: null } }),
    'cal/native-fcfs-paid': run({ waivers: { type: 'fcfs', dayOfWeek: null, timeUtc: null }, dues: { enabled: true, amountLabel: null, unpaid: 0 }, noTradeDeadline: true }),
    'cal/drafting': run({ status: 'drafting', tradeDeadlineWeek: 9, playoffStartWeek: 14 }),
    'cal/imported': run({ native: false, status: 'pre_draft' }),
    'cal/renew-native': run({ status: 'complete' }),
    'cal/renew-imported': run({ native: false, status: 'complete' }),
  }
}

const icsName = (language: Lang) =>
  (buildIcs({ leagueId: 'L1', leagueName: 'Xolo League', events: buildLeagueCalendar({ now: NOW, leagueId: 'L1', platformLabel: 'Sleeper', native: true, status: 'in_season', season: 2026, draftAt: at(3), waivers: null, tradeDeadlineWeek: null, noTradeDeadline: false, playoffStartWeek: null, currentWeek: 5, weekStarts: new Map(), dues: null, polls: [], language } as CalendarInput).events, now: NOW, language } as never) ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('X-WR-CALNAME')) ?? ''

const chartStrings = (c: HubChart | null) => (c ? [c.title, c.subtitle, ...(c.takeaway ? [c.takeaway] : []), ...c.bars.flatMap((b) => [b.label, b.display])] : [])

function chartCases(language: Lang): Record<string, string[]> {
  const row = (activityType: string, days: number, key = 'sleeper:u1'): ActivityRow => ({ activityType, occurredAt: at(-days), managerKeys: [key] })
  const rows = [row('trade', 1), row('waiver', 2), row('waiver', 9, 'sleeper:u2'), row('add', 15), row('trade', 30)]
  const managers = [{ key: 'u1', name: 'Xolo' }, { key: 'u2', name: 'Zibba' }, { key: 'u3', name: 'Quorra' }]
  return {
    'chart/activity': chartStrings(activityChart(rows, NOW, language)),
    'chart/activity-empty': chartStrings(activityChart([], NOW, language)),
    'chart/activity-one': chartStrings(activityChart([row('add', 0)], NOW, language)),
    'chart/trades': chartStrings(tradesChart(rows, NOW, language)),
    'chart/trades-empty': chartStrings(tradesChart([], NOW, language)),
    'chart/trades-one': chartStrings(tradesChart([row('trade', 0)], NOW, language)),
    'chart/waivers': chartStrings(waiverParticipationChart(rows, managers, language)),
    'chart/waivers-none': chartStrings(waiverParticipationChart([], managers, language)),
    'chart/balance': chartStrings(balanceChart([
      { name: 'Xolo', wins: 4, losses: 1, ties: 0, pointsFor: 640.4 },
      { name: 'Zibba', wins: 2, losses: 2, ties: 1, pointsFor: 512 },
      { name: 'Quorra', wins: 1, losses: 4, ties: 0, pointsFor: 430 },
    ], language)),
    'chart/balance-one-game': chartStrings(balanceChart([
      { name: 'Xolo', wins: 1, losses: 0, ties: 0, pointsFor: 120 },
      { name: 'Zibba', wins: 0, losses: 1, ties: 0, pointsFor: 100 },
    ], language)),
    'chart/scoring': chartStrings(scoringChart([
      { week: 1, pointsFor: 110, pointsAgainst: 100, matchupId: 1 }, { week: 1, pointsFor: 100, pointsAgainst: 110, matchupId: 1 },
      { week: 2, pointsFor: 130, pointsAgainst: 90, matchupId: 2 },
    ], { currentWeek: 3, complete: false }, language)),
    'chart/scoring-uncertified': chartStrings(scoringChart([{ week: 1, pointsFor: 90, pointsAgainst: 80, matchupId: 1 }], undefined, language)),
    'chart/engagement': chartStrings(engagementChart([{ status: 'active' }, { status: 'at_risk' }, { status: 'inactive' }, { status: 'unknown' }], language)),
  }
}

/** The audit log has no language: its English is the data, worded by the screen. */
function timelineEntries(): TimelineEntry[] {
  const t0 = new Date('2026-10-01T12:00:00Z')
  const sync = (id: string, minutes: number, rows: number, status = 'completed') =>
    fromSyncRun({ id, status, rowsWritten: rows, errorMessage: null, startedAt: new Date(t0.getTime() - minutes * 60_000), completedAt: null }, 'Sleeper')
  return [
    fromImportRun({ id: 'i1', provider: 'sleeper', season: 2026, status: 'completed', error: null, startedAt: t0, completedAt: t0 }, 'Sleeper'),
    fromImportRun({ id: 'i2', provider: 'sleeper', season: 2025, status: 'failed', error: 'x', startedAt: t0, completedAt: null }, 'Sleeper'),
    fromImportRun({ id: 'i3', provider: 'sleeper', season: 2024, status: 'running', error: null, startedAt: t0, completedAt: null }, 'Sleeper'),
    sync('s1', 1, 1), sync('s2', 2, 0), sync('s3', 3, 0, 'failed'),
    ...collapseQuietSyncs([sync('c1', 10, 2), sync('c2', 11, 3), sync('c3', 12, 0)]),
    ...collapseQuietSyncs([sync('q1', 20, 0), sync('q2', 21, 0)]),
    fromAuditLog({ id: 'a1', actionType: 'commissioner_run_waivers', entityType: 'league', metadata: {}, createdAt: t0, actorName: 'Xolo' }),
    fromAuditLog({ id: 'a2', actionType: 'trade_reversal_out', entityType: 'trade', metadata: {}, createdAt: t0, actorName: null }),
    fromFeedEvent({ id: 'f1', type: 'x', summary: '', actorType: 'system', occurredAt: t0 }),
    fromBroadcast({ id: 'b1', message: 'Xqz wvb', createdAt: t0, actorName: 'Zibba' }),
    fromAutomationRun({ id: 'r1', jobType: 'workspace.refreshTasks', status: 'completed', startedAt: t0, finishedAt: t0, metadata: { opened: 2, autoResolved: 1 } }),
    fromAutomationRun({ id: 'r2', jobType: 'workspace.refreshTasks', status: 'completed', startedAt: t0, finishedAt: t0, metadata: { opened: 0, autoResolved: 0, detected: 3 } }),
    fromAutomationRun({ id: 'r3', jobType: 'workspace.refreshTasks', status: 'completed', startedAt: t0, finishedAt: t0, metadata: { opened: 0, autoResolved: 0 } }),
    fromAutomationRun({ id: 'r4', jobType: 'workspace.refreshTasks', status: 'completed', startedAt: t0, finishedAt: t0, metadata: { opened: 1 } }),
    fromAutomationRun({ id: 'r5', jobType: 'workspace.refreshTasks', status: 'completed', startedAt: t0, finishedAt: t0, metadata: { autoResolved: 1 } }),
    fromAutomationRun({ id: 'r6', jobType: 'waivers.processLeague', status: 'skipped', startedAt: t0, finishedAt: t0, metadata: {} }),
    fromAutomationRun({ id: 'r7', jobType: 'reports.generateScheduled', status: 'completed', startedAt: t0, finishedAt: t0, metadata: {} }),
    fromAutomationRun({ id: 'r8', jobType: 'commissioner.recipes', status: 'completed', startedAt: t0, finishedAt: t0, metadata: {} }),
  ]
}
const timelineStrings = (es: boolean): string[] =>
  timelineEntries().flatMap((e) => [e.title, e.detail ?? '', e.actor ?? ''].filter(Boolean).map((s) => (es ? hubCopy(s, 'es') : s)))

const PASS = /\b(AllFantasy|Sleeper|ESPN|FAAB|ET|Xolo|Zibba|Quorra|Xqz|Wvb|wvb|League|Draft)\b|@everyone|\$\d+/g
/*
 * "draft"/"Draft" is the app's Spanish loanword ("el draft"); the weekday and month abbreviations are
 * es-US's. "no" is absent because it is Spanish too. The word edges are LETTER-aware, not `\b`: JS's
 * `\b` counts "ó" as a boundary, so "import" matched inside "importó".
 */
const ENGLISH = /(?<!\p{L})(the|and|or|has|have|with|of|is|are|be|to|for|on|in|from|by|this|that|not|every|week|weeks|weeks?|trades?|claims?|moves?|managers?|teams?|points|game|games|season|set|date|deadline|processed?|process|close|closes|closed|open|paid|unpaid|dues|vote|poll|renew|playoffs begin|import|imported|synced|sync|records?|updated|changed|nothing|ran|built|checked|edited|reversed|posted|saved|sent|skipped|failed|average|avg|high|low|active|inactive|slowing|tell|separate|scorers|participation|engagement|activity|balance|scoring|recorded|completed|per)(?!\p{L})/iu

function spanishProblems(en: Record<string, string[]>, es: Record<string, string[]>): string[] {
  const out: string[] = []
  for (const [k, list] of Object.entries(es)) {
    if (list.length !== en[k]?.length) out.push(`${k}: ${list.length} Spanish vs ${en[k]?.length} English`)
    list.forEach((s, i) => {
      if (typeof s !== 'string' || s.trim() === '') return void out.push(`${k}[${i}] empty (English: ${en[k]?.[i]})`)
      const own = s.replace(PASS, '').replace(/\d[\d,.:]*/g, '').replace(/[^\p{L}\s]/gu, ' ').trim()
      if (own === '') return
      if (s === en[k]?.[i]) out.push(`${k}[${i}] unchanged: ${s}`)
      else if (ENGLISH.test(own)) out.push(`${k}[${i}] English left: ${s}`)
    })
  }
  return out
}

describe('commissioner hub records', () => {
  it('🛑 the English is byte-identical to what the code wrote before it took a language', () => {
    expect({ ...calendarCases('en'), ...chartCases('en'), ics: [icsName('en')], timeline: timelineStrings(false) }).toMatchSnapshot()
  })

  it('🛑 the calendar, its .ics name and the charts read Spanish', () => {
    const problems = spanishProblems({ ...calendarCases('en'), ...chartCases('en'), ics: [icsName('en')] }, { ...calendarCases('es'), ...chartCases('es'), ics: [icsName('es')] })
    expect(problems).toEqual([])
  })

  it('🛑 the audit log reads Spanish once the screen words it — its English data untouched', () => {
    const en = { timeline: timelineStrings(false) }
    const es = { timeline: timelineStrings(true) }
    // The one sentence left whole on purpose: "Updated <raw setting keys>." (none in these fixtures).
    expect(spanishProblems(en, es)).toEqual([])
    for (const label of Object.values(TIMELINE_KIND_LABEL)) expect(hubCopy(label, 'es'), label).not.toBe(label)
    // collapseQuietSyncs still reads the English it wrote: three syncs collapse to one line.
    expect(timelineEntries().filter((e) => e.detail?.includes('syncs ·'))).toHaveLength(1)
  })

  it('🛑 the automation catalog reads Spanish on the hub, and RECIPES — what the chat posts come from — is untouched', () => {
    const leagues = [
      { platform: 'sleeper', sport: 'NFL' }, { platform: 'mfl', sport: 'NFL' }, { platform: 'fantrax', sport: 'NFL' }, { platform: 'espn', sport: 'NBA' },
    ]
    for (const league of leagues) {
      for (const r of RECIPES) {
        expect(recipeCatalogEntry(r, league, 'en')).toEqual({
          key: r.key, label: r.label, description: r.description, cadence: r.cadence, unavailable: r.unavailableReason(league),
        })
      }
    }
    const en: Record<string, string[]> = {}
    const es: Record<string, string[]> = {}
    for (const league of leagues) {
      const k = `${league.platform}-${league.sport}`
      en[k] = RECIPES.flatMap((r) => Object.values(recipeCatalogEntry(r, league, 'en')).filter((v): v is string => typeof v === 'string' && v !== r.key))
      es[k] = RECIPES.flatMap((r) => Object.values(recipeCatalogEntry(r, league, 'es')).filter((v): v is string => typeof v === 'string' && v !== r.key))
    }
    expect(spanishProblems(en, es)).toEqual([])
  })

  it('🛑 no English sentence in the calendar, chart or report builders lacks its Spanish branch', () => {
    expect(
      ['lib/core-app/commissioner/calendar.ts', 'lib/core-app/commissioner/charts.ts'].flatMap((f) => untranslatedLiterals(f)),
    ).toEqual([])
  })
})
