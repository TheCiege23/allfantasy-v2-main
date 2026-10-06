/**
 * The Commissioner Hub's composed sentences in Spanish (2026-10-05).
 *
 * The health flags, review cards, task cards, member activity and health score are written on the
 * server from league data — names lists, counts, "and 3 more" — so they cannot be translated by
 * pattern at render without coming out half Spanish. Each builder takes the reader's language
 * instead (default English, so its other callers are untouched) and writes the sentence itself.
 *
 * This runs every builder over fixtures that reach each branch, and:
 *  1. pins the ENGLISH output to the snapshot written from the builders before they took a
 *     language — the English is byte-identical;
 *  2. requires every Spanish output to differ from its English and to carry no English word.
 */
import { describe, expect, it } from 'vitest'
import {
  abandonedTeamsFlag,
  missingLineupsFlag,
  unequalSchedulesFlag,
  unpaidDuesFlag,
  unresolvedVotesFlag,
  type HealthFlag,
  type LeaguePoll,
} from '@/lib/core-app/commissioner/health'
import { reviewSignalCards } from '@/lib/core-app/commissioner/signals'
import { buildTaskCards, type TaskCard } from '@/lib/core-app/commissioner/tasks'
import { memberActivityFromReads, resolveMemberActivity, staleActivityReason } from '@/lib/core-app/commissioner/activity'
import { resolveHubHealthScore } from '@/lib/core-app/commissioner/healthScore'
import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'
import { untranslatedLiterals } from './helpers/untranslatedLiterals'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

/** The server files whose sentences are written in the reader's language at the source. */
const SOURCES = [
  'lib/core-app/commissionerHub.ts',
  'lib/core-app/commissioner/health.ts',
  'lib/core-app/commissioner/signals.ts',
  'lib/core-app/commissioner/tasks.ts',
  'lib/core-app/commissioner/activity.ts',
  'lib/core-app/commissioner/healthScore.ts',
]

const NOW = new Date('2026-10-05T16:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const act = { label: 'ACT-LABEL', href: '/league/L1', external: false }
const stale = { reason: 'STALE-REASON', action: { label: 'STALE-ACT', href: '/core/sync', external: false } }
// Names chosen so no fixture name is an English word the Spanish check would trip on.
const N = ['Xolo', 'Zibba', 'Quorra', 'Vexa', 'Wuzzo', 'Kplex']

type Lang = 'en' | 'es'

function flagStrings(f: HealthFlag): string[] {
  const out = [f.label]
  if (f.measured) out.push(f.headline, f.detail)
  else out.push(f.reason)
  if (f.action) out.push(f.action.label)
  return out
}
function cardStrings(c: TaskCard): string[] {
  return [c.title, c.detail, ...(c.due ? [c.due] : []), ...(c.action ? [c.action.label] : [])]
}

const poll = (question: string, closesAt: string | null, postedAt = ago(1).toISOString()): LeaguePoll =>
  ({ id: question, question, options: [], totalVotes: 0, closesAt, closed: false, postedAt } as unknown as LeaguePoll)

/** Every builder output, by case name, in one language. */
function collect(language: Lang): Record<string, string[]> {
  const L = { language }
  const out: Record<string, string[]> = {}
  const add = (k: string, v: string[]) => (out[k] = v)

  // ── abandoned ──
  add('abandoned/stale', flagStrings(abandonedTeamsFlag({ managers: [], orphanTeams: [], totalTeams: 4, action: act, stale, ...L })))
  add('abandoned/unread', flagStrings(abandonedTeamsFlag({ managers: null, orphanTeams: [], totalTeams: 4, action: act, ...L })))
  add('abandoned/no-teams', flagStrings(abandonedTeamsFlag({ managers: [], orphanTeams: ['x'], totalTeams: 0, action: act, ...L })))
  add('abandoned/all-quiet', flagStrings(abandonedTeamsFlag({ managers: [{ name: N[0], status: 'inactive' }, { name: N[1], status: 'inactive' }], orphanTeams: [], totalTeams: 2, action: act, ...L })))
  add('abandoned/clean', flagStrings(abandonedTeamsFlag({ managers: [{ name: N[0], status: 'active' }], orphanTeams: [], totalTeams: 1, action: act, ...L })))
  add('abandoned/clean-no-managers', flagStrings(abandonedTeamsFlag({ managers: [], orphanTeams: [], totalTeams: 2, action: act, ...L })))
  add('abandoned/one-each', flagStrings(abandonedTeamsFlag({ managers: [{ name: N[0], status: 'inactive' }, { name: N[1], status: 'active' }], orphanTeams: [N[2]], totalTeams: 3, action: act, ...L })))
  add('abandoned/many', flagStrings(abandonedTeamsFlag({ managers: N.map((name, i) => ({ name, status: i < 5 ? 'inactive' as const : 'active' as const })), orphanTeams: N.slice(0, 5), totalTeams: 11, action: act, ...L })))

  // ── lineups ──
  const full = (name: string) => ({ name, starters: ['a', 'b', 'c'] })
  add('lineups/mfl', flagStrings(missingLineupsFlag({ platform: 'mfl', inSeason: true, rosters: [], action: act, ...L })))
  add('lineups/fantrax', flagStrings(missingLineupsFlag({ platform: 'fantrax', inSeason: true, rosters: [], action: act, ...L })))
  add('lineups/stale', flagStrings(missingLineupsFlag({ platform: 'sleeper', inSeason: true, rosters: [], action: act, stale, ...L })))
  add('lineups/offseason', flagStrings(missingLineupsFlag({ platform: 'sleeper', inSeason: false, rosters: [], action: act, ...L })))
  add('lineups/unreadable', flagStrings(missingLineupsFlag({ platform: 'sleeper', inSeason: true, rosters: [{ name: N[0], starters: null }], action: act, ...L })))
  add('lineups/full', flagStrings(missingLineupsFlag({ platform: 'sleeper', inSeason: true, rosters: [full(N[0]), full(N[1])], requiredStarters: 3, action: act, ...L })))
  add('lineups/one-hole', flagStrings(missingLineupsFlag({ platform: 'sleeper', inSeason: true, rosters: [full(N[0]), { name: N[1], starters: ['a', 'b'] }, { name: N[2], starters: null }], requiredStarters: 3, action: act, ...L })))
  add('lineups/many-holes', flagStrings(missingLineupsFlag({ platform: 'sleeper', inSeason: true, rosters: [...N.map((name) => ({ name, starters: ['a'] })), { name: 'r1', starters: null }, { name: 'r2', starters: null }], requiredStarters: 3, action: act, ...L })))

  // ── schedule ──
  const games = (byRoster: Record<string, number>) =>
    Object.entries(byRoster).flatMap(([rosterId, n]) => Array.from({ length: n }, (_, i) => ({ rosterId, week: i + 1, matchupId: 1 })))
  const sched = (g: ReturnType<typeof games>, ids: string[], through: number | null, elim = false) =>
    flagStrings(unequalSchedulesFlag({ games: g, rosterIds: ids, teamName: (id) => `T${id}`, throughWeek: through, eliminationFormat: elim, action: act, ...L }))
  add('schedule/elimination', sched([], [], 3, true))
  add('schedule/none-played', sched([], ['1'], null))
  add('schedule/no-teams', sched(games({ x: 1 }).map((g) => ({ ...g, matchupId: null })), [], 3))
  add('schedule/equal-one', sched(games({ '1': 1, '2': 1 }), ['1', '2'], 1))
  add('schedule/equal', sched(games({ '1': 3, '2': 3 }), ['1', '2'], 3))
  add('schedule/behind-one', sched(games({ '1': 3, '2': 2 }), ['1', '2'], 3))
  add('schedule/behind-many', sched(games({ '1': 4, '2': 1, '3': 1, '4': 2, '5': 3, '6': 2, '7': 1 }), ['1', '2', '3', '4', '5', '6', '7'], 4))

  // ── dues ──
  const tracker = (entries: Array<{ teamId: string; paid: boolean }>, amount: number | null = 50) =>
    ({ enabled: true, amount, currency: 'USD', paymentLink: null, paymentProvider: null, entries })
  const teams = N.slice(0, 5).map((name, i) => ({ id: `t${i}`, name }))
  add('dues/untracked', flagStrings(unpaidDuesFlag({ tracker: null, teams, action: act, ...L })))
  add('dues/no-teams', flagStrings(unpaidDuesFlag({ tracker: tracker([]), teams: [], action: act, ...L })))
  add('dues/all-paid', flagStrings(unpaidDuesFlag({ tracker: tracker(teams.map((t) => ({ teamId: t.id, paid: true }))), teams, action: act, ...L })))
  add('dues/one-owes', flagStrings(unpaidDuesFlag({ tracker: tracker(teams.slice(1).map((t) => ({ teamId: t.id, paid: true }))), teams, action: act, ...L })))
  add('dues/many-owe-no-amount', flagStrings(unpaidDuesFlag({ tracker: tracker([], null), teams, action: act, ...L })))

  // ── votes ──
  const soonIso = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString()
  add('votes/unread', flagStrings(unresolvedVotesFlag({ polls: null, now: NOW, action: act, ...L })))
  add('votes/none', flagStrings(unresolvedVotesFlag({ polls: [], now: NOW, action: act, ...L })))
  add('votes/one', flagStrings(unresolvedVotesFlag({ polls: [poll('Xqz?', soonIso)], now: NOW, action: act, ...L })))
  add('votes/many', flagStrings(unresolvedVotesFlag({ polls: [poll('Xqz?', soonIso), poll('Wvb?', null, ago(9).toISOString()), poll('Pqr?', soonIso), poll('Zzk?', null)], now: NOW, action: act, ...L })))

  // ── review signals ──
  add('signals/one', reviewSignalCards('L1', { integrityAlerts: 1, tradesAwaitingReview: 1, overdueWaiverClaims: 1, draftDateMissing: true }, language).flatMap(cardStrings))
  add('signals/many', reviewSignalCards('L1', { integrityAlerts: 3, tradesAwaitingReview: 2, overdueWaiverClaims: 4, draftDateMissing: false }, language).flatMap(cardStrings))

  // ── task cards: stale sync, calendar, workspace ──
  const tasks = buildTaskCards({
    issues: [],
    flags: [],
    calendar: [{ id: 'd1', kind: 'draft', title: 'DRAFT-TITLE', at: null, allDay: true, week: null, whenLabel: 'WHEN', status: 'soon', detail: 'DETAIL', source: 'platform' }],
    workspace: [{ id: 'w1', sourceKey: 'x', title: 'WS-TITLE', description: 'WS-DESC', priority: 'normal', dueAt: null, href: '/x' }],
    staleSync: { days: 9, href: '/core/sync', platformLabel: 'Sleeper' },
    ...L,
  })
  add('tasks', [...tasks.cards, ...tasks.overflow].flatMap(cardStrings))

  // ── member activity ──
  add('activity/stale', [staleActivityReason({ native: false, lastSyncedAt: ago(5), now: NOW, ...L }) ?? ''])
  add('activity/imported-unread', [JSON.stringify(memberActivityFromReads({ native: false, managers: null, window: null }, [], NOW, 14, language))])
  const imported = (lastActivityAt: Date | null, eventCount: number, managers: Array<{ managerName: string; currentCount: number; priorCount: number; lastActionAt?: Date | null }>) =>
    resolveMemberActivity({ kind: 'imported', managers, teams: [N[5]], lastActivityAt, eventCount }, NOW, 14, language)
  const rowsOf = (a: ReturnType<typeof imported>) => (a.available ? [...a.data.rows.map((r) => r.detail), a.data.basis] : [a.reason])
  add('activity/imported-none', rowsOf(imported(null, 0, [])))
  add('activity/imported-old', rowsOf(imported(ago(20), 4, [])))
  add('activity/imported-old-one-day', rowsOf(resolveMemberActivity({ kind: 'imported', managers: [], lastActivityAt: ago(1), eventCount: 1 }, NOW, 0, language)))
  add('activity/imported-unmatched', rowsOf(imported(ago(2), 4, [])))
  add('activity/imported-rows', rowsOf(imported(ago(2), 4, [{ managerName: N[0], currentCount: 2, priorCount: 1, lastActionAt: ago(2) }, { managerName: N[1], currentCount: 1, priorCount: 0, lastActionAt: ago(1) }, { managerName: N[2], currentCount: 0, priorCount: 3 }])))
  const native = (rows: Parameters<typeof resolveMemberActivity>[0] extends infer T ? (T extends { kind: 'native'; rows: infer R } ? R : never) : never) =>
    rowsOf(resolveMemberActivity({ kind: 'native', rows }, NOW, 14, language))
  add('activity/native-unread', native(null))
  add('activity/native-empty', native([{ teamName: null, managerName: null, status: 'unknown', lastActionAt: null }]))
  add('activity/native-rows', native([
    { teamName: N[0], managerName: null, status: 'unknown', lastActionAt: null },
    { teamName: N[1], managerName: null, status: 'active', lastActionAt: NOW.toISOString() },
    { teamName: N[2], managerName: null, status: 'active', lastActionAt: ago(1).toISOString() },
    { teamName: N[3], managerName: null, status: 'inactive', lastActionAt: ago(6).toISOString() },
  ]))

  // ── health score ──
  const score = (s: ReturnType<typeof resolveHubHealthScore>) => [s.available ? s.data.summary : s.reason]
  add('score/stale', score(resolveHubHealthScore({ snapshot: null, unread: false, activityStale: true, staleDays: 6, ...L })))
  add('score/unread', score(resolveHubHealthScore({ snapshot: null, unread: true, activityStale: false, staleDays: 0, ...L })))
  add('score/thin', score(resolveHubHealthScore({ snapshot: null, unread: false, activityStale: false, staleDays: 0, ...L })))

  return out
}

/** English words that must not survive in a Spanish sentence (fixture names avoid all of them). "draft" is
 * absent on purpose: the app's Spanish uses it as a loanword everywhere ("el draft", Draft HQ). */
const ENGLISH = /\b(the|and|has|have|with|without|of|is|are|was|be|been|no one|none|nobody|every|everyone|team|teams|manager|managers|lineup|lineups|week|weeks|days?|ago|yet|could|couldn|can|not|read|just|now|moves?|made|still|owe|owes|dues|vote|votes|open|closes|deadline|review|trade|trades|claim|claims|waiting|over|alerts?|set|date|roster|rosters|slot|slots|empty|full|games?|played|behind|through|most|more|last|today|yesterday|active|idle|imported|league|sync|re-sync|score|scored|enough|data|activity|paid|unpaid|tracked|tracking|owner|quiet|abandoned|schedules?|unequal|missing|unresolved|see|calendar)\b/i

describe('commissioner hub builders', () => {
  it('🛑 the English is byte-identical to what the builders wrote before they took a language', () => {
    expect(collect('en')).toMatchSnapshot()
  })

  it('🛑 every Spanish sentence differs from its English and carries no English word', () => {
    const en = collect('en')
    const es = collect('es')
    const problems: string[] = []
    // What a builder is handed rather than writes (fixture placeholders, platform and product names).
    const PASS = /STALE-REASON|STALE-ACT|ACT-LABEL|DRAFT-TITLE|WHEN|DETAIL|WS-TITLE|WS-DESC|Sleeper|AllFantasy|MFL|Fantrax|FAAB/g
    for (const [k, list] of Object.entries(es)) {
      expect(list.length, k).toBe(en[k]?.length) // same shape in both languages
      list.forEach((s, i) => {
        const english = en[k]?.[i]
        const own = s.replace(PASS, '').trim()
        if (own === '') return // nothing but a handed-in value
        if (s === english) problems.push(`${k}[${i}] unchanged: ${s}`)
        else if (ENGLISH.test(own)) problems.push(`${k}[${i}] English left: ${s}`)
      })
    }
    expect(problems).toEqual([])
  })

  it('🛑 getCommissionerHub hands the reader’s language to every builder that writes a sentence', () => {
    // A builder never told the language writes English — silently, with every other check here green.
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/commissionerHub.ts'), 'utf8')
    const sf = ts.createSourceFile('hub.ts', src, ts.ScriptTarget.Latest, true)
    const BUILDERS = new Set([
      'abandonedTeamsFlag', 'missingLineupsFlag', 'unequalSchedulesFlag', 'unpaidDuesFlag', 'unresolvedVotesFlag',
      'buildTaskCards', 'resolveHubHealthScore', 'memberActivityFromReads', 'staleActivityReason',
      'unownedTeamNames', 'buildCommissionerAccessRows', 'describeSyncAge', 'describeTradeDeadline', 'describePlayoffs',
      'buildLeagueAreas', 'buildWorkflows', 'buildCommunities', 'commissionerFormatCards', 'loadCommissionerHistory',
    ])
    const calls: Array<{ name: string; passes: boolean }> = []
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && BUILDERS.has(n.expression.text)) {
        // The argument itself, or a `language` property of an object argument — NOT the word anywhere
        // inside one, which a nested `unownedTeamNames(teams, language)` would satisfy for its parent.
        const passes = n.arguments.some(
          (a) =>
            (ts.isIdentifier(a) && a.text === 'language') ||
            (ts.isObjectLiteralExpression(a) &&
              a.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'language')),
        )
        calls.push({ name: n.expression.text, passes })
      }
      n.forEachChild(visit)
    }
    visit(sf)
    expect(new Set(calls.map((c) => c.name))).toEqual(BUILDERS) // the check sees every builder
    expect(calls.filter((c) => !c.passes).map((c) => c.name)).toEqual([])
  })

  it('🛑 no English sentence in these files lacks its Spanish branch — getCommissionerHub’s own included', () => {
    // getCommissionerHub reads a dozen tables, so its tiles and reasons are held to the source instead.
    expect(SOURCES.flatMap((f) => untranslatedLiterals(f))).toEqual([])
  })
})

describe('the league health summary', () => {
  const base = {
    sport: 'NFL', leagueType: 'redraft', leagueId: 'L', numTeams: 12, currentWeek: 5, totalWeeks: 17,
    activeManagers: 12, inactiveManagers: 0, abandonedTeams: 0, lineupSubmissionRate: 0.9,
    totalTradesThisSeason: 8, totalWaiverClaims: 40, avgFaabSpentPct: 30, chatMessageCount: 10, voteCount: 1,
    disputeCount: 0, commissionerActionsThisSeason: 2, unresolvedDisputes: 0, playoffTeams: 6,
    waiverType: 'faab', tradeReviewProcess: 'none', previousSeasonHealthScore: null, leagueHealthScore: null,
  }
  const summaries = [
    base,
    { ...base, inactiveManagers: 4, activeManagers: 8, chatMessageCount: 30 },
    { ...base, lineupSubmissionRate: 0.5, totalTradesThisSeason: 0, chatMessageCount: 0, totalWaiverClaims: 0 },
    { ...base, abandonedTeams: 2, unresolvedDisputes: 3, disputeCount: 4 },
    { ...base, lineupSubmissionRate: 0.99, chatMessageCount: 40, totalTradesThisSeason: 30 },
  ].map((input) => monitorLeagueHealth(input as never).summary)

  it('the engine’s real summaries are rebuilt in Spanish, piece by piece', () => {
    expect(summaries.map((s) => hubCopy(s, 'es'))).toEqual([
      'Salud de la liga: 78/100 (saludable). Estructura justa: buena configuración y pocas disputas. Sin problemas destacados.',
      'Salud de la liga: 57/100 (en observación). Estructura justa: buena configuración y pocas disputas. Problema: 4 mánagers inactivos: la participación está en riesgo.',
      'Salud de la liga: 66/100 (saludable). Estructura justa: buena configuración y pocas disputas. Problema: Participación baja: la actividad de la liga está por debajo de lo saludable.',
      'Salud de la liga: 36/100 (en riesgo). Sin fortalezas destacadas. Problema: 2 equipos abandonados: hace falta actuar de inmediato.',
      'Salud de la liga: 87/100 (excelente). Mucha participación: intercambios y agentes libres activos. Sin problemas destacados.',
    ])
    expect(summaries.map((s) => hubCopy(s, 'en'))).toEqual(summaries)
  })

  it('🛑 every strength and problem the engine can write has Spanish — read from the engine’s source', () => {
    // Only the FIRST strength and problem reach the summary, so real cases cannot reach every piece.
    const engine = readFileSync(resolve(process.cwd(), 'lib/league-health/league-health-engine.ts'), 'utf8')
    const pieces = (list: string) =>
      [...engine.matchAll(new RegExp(`${list}\\.push\\(([\`'])((?:(?!\\1).)*)\\1\\)`, 'g'))].map((m) => m[2]!.replace(/\$\{[^}]+\}/g, '3'))
    const strengths = [...pieces('strengths'), 'No major strengths.']
    const problems = pieces('problems')
    expect(strengths.length).toBeGreaterThanOrEqual(6)
    expect(problems.length).toBeGreaterThanOrEqual(5)
    const missing = [
      ...strengths.map((s) => `League health: 70/100 (healthy). ${s} No major problems.`),
      ...problems.map((p) => `League health: 40/100 (at_risk). No major strengths. Problem: ${p}`),
    ].filter((s) => hubCopy(s, 'es') === s)
    expect(missing).toEqual([])
  })

  it('a summary with a piece it does not know stays whole English, never half', () => {
    const odd = 'League health: 70/100 (healthy). A strength nobody wrote yet No major problems.'
    expect(hubCopy(odd, 'es')).toBe(odd)
  })
})
