/**
 * Puts answer-bank questions (__tests__/chimmy-eval/answer-bank.ts) through Chimmy's production
 * answer path against a READ-ONLY database, then grades each transcript with a second model.
 *
 *   node --require ./scripts/_server-only-stub.cjs --import tsx scripts/chimmy-eval/run-answer-bank.ts \
 *     --env-dir=<dir holding .env / .env.local> --user-email=<account whose leagues to use> \
 *     --ids=tb-01,tr-03 --out=<directory OUTSIDE the repo> [--controls-only]
 *
 * 🛑 THE OUTPUT HOLDS A REAL ACCOUNT'S LEAGUES. This repo is public; `--out` is refused when it
 * resolves inside the working tree, and nothing this writes should ever be committed.
 *
 * READ-ONLY IS ENFORCED TWICE, AND BOTH ARE PROVEN BEFORE ANY QUESTION RUNS:
 *   1. The connection opens with `default_transaction_read_only=on`, confirmed by asking the server
 *      (`SHOW`), not by trusting the URL.
 *   2. The Prisma client every app module receives (installed on `globalThis.prisma` BEFORE any app
 *      import, which `lib/prisma.ts` honours) passes only read operations and SELECT/WITH/SHOW raw
 *      queries. Each is proven by attempting a write and requiring THIS guard's error — a database
 *      error would mean the write reached the database.
 * Blocked writes are recorded per question: a tool that tried to write (a read-through cache fill)
 * behaved differently here than in production, and the scorecard says so.
 *
 * WHAT IS MIRRORED from app/api/chat/chimmy/route.ts, in its order: the league-required gate (with
 * the route's own name matcher), the deterministic short-circuit, the live-search fallback on a
 * refusal, then the tool loop on the production prompt (lib/chimmy/tools/toolLoopSystemPrompt.ts).
 * NOT run: token spend and entitlement checks, personalization, and the PECR path the route falls
 * back to when the tool loop returns nothing — such a question is recorded as `fell_through_to_pecr`.
 */
/* eslint-disable no-console */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { parse as parseDotenv } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import {
  CHIMMY_ANSWER_BANK,
  GLOBAL_RUBRIC,
  type AnswerCase,
} from '../../__tests__/chimmy-eval/answer-bank'

// ── arguments ─────────────────────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const ENV_DIR = arg('env-dir')
const USER_EMAIL = arg('user-email')
const IDS = (arg('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const OUT = arg('out')
const CONTROLS_ONLY = process.argv.includes('--controls-only')
/** Re-grade an earlier run's runs.json without re-running Chimmy (no answer spend). */
const REGRADE = arg('regrade')
const JUDGE_MODEL = arg('judge') ?? 'claude-sonnet-5'
/** Explicit fixture choices by exact league name; otherwise the newest NFL league of each kind. */
const LEAGUE_OVERRIDE: Record<string, string | undefined> = {
  '{nativeLeague}': arg('native-league'),
  '{importedLeague}': arg('imported-league'),
  '{otherImport}': arg('other-league'),
}

function die(msg: string): never {
  console.error(`\n[chimmy-eval] STOP: ${msg}`)
  process.exit(2)
}
if (!ENV_DIR || !USER_EMAIL || !OUT) die('--env-dir, --user-email and --out are required')
const outAbs = resolve(OUT)
const rel = relative(process.cwd(), outAbs)
if (!rel.startsWith('..') && !isAbsolute(rel)) die(`--out resolves inside the repo (${outAbs}); results hold private league data`)

// ── environment ───────────────────────────────────────────────────────────────────────────────
for (const file of ['.env', '.env.local']) {
  const p = join(ENV_DIR, file)
  if (existsSync(p)) Object.assign(process.env, parseDotenv(readFileSync(p)))
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'production'
env.AI_FEATURES_ENABLED = 'true' // the owner approved this run's spend
env.CHIMMY_TOOL_LOOP_ENABLED = 'true'
delete env.CHIMMY_TOOL_LOOP_PROVIDER // production pins none, so Claude answers
delete env.CHIMMY_CLAUDE_MODEL // production sets none, so the default model answers

const rawUrl = env.DATABASE_URL_UNPOOLED || env.DIRECT_URL || env.DATABASE_URL
if (!rawUrl) die('no database URL in the env files')
if (/[?&]options=/.test(rawUrl)) die('the database URL already carries `options`; refusing to merge a read-only flag into it blind')
const RO_URL = `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c default_transaction_read_only=on')}&application_name=chimmy-eval-readonly&connection_limit=3`
// Any other client that reads these gets the read-only connection too.
env.DATABASE_URL = RO_URL
env.DIRECT_URL = RO_URL
env.DATABASE_URL_UNPOOLED = RO_URL
const endpoint = (() => {
  try {
    return new URL(rawUrl).hostname.split('.')[0]
  } catch {
    return 'unparseable'
  }
})()

// ── the read-only client ──────────────────────────────────────────────────────────────────────
class ReadOnlyGuardError extends Error {}
const READ_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])
const WRITE_WORDS = /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|vacuum|refresh|lock|nextval|setval)\b/i
let currentCase = 'setup'
const blocked: Array<{ at: string; model?: string; operation: string }> = []

function rawSqlText(args: unknown): string {
  const a = args as { sql?: string; strings?: readonly string[] } | unknown[] | null
  if (Array.isArray(a)) {
    const first = a[0] as unknown
    if (typeof first === 'string') return first
    const strings = (first as { raw?: readonly string[] } | null)?.raw ?? (first as readonly string[] | null)
    if (Array.isArray(strings)) return strings.join('?')
    return ''
  }
  if (a && typeof a === 'object') {
    if (typeof (a as { sql?: string }).sql === 'string') return (a as { sql: string }).sql
    if (Array.isArray((a as { strings?: string[] }).strings)) return ((a as { strings: string[] }).strings).join('?')
  }
  return ''
}

const base = new PrismaClient({ datasourceUrl: RO_URL, log: ['error'] })
const guarded = base.$extends({
  query: {
    async $allOperations({ model, operation, args, query }: { model?: string; operation: string; args: unknown; query: (a: unknown) => Promise<unknown> }) {
      if (READ_OPS.has(operation)) return query(args)
      if (operation === '$queryRaw' || operation === '$queryRawUnsafe') {
        const sql = rawSqlText(args)
        if (/^\s*(select|with|show)\b/i.test(sql) && !WRITE_WORDS.test(sql)) return query(args)
      }
      blocked.push({ at: currentCase, model, operation })
      throw new ReadOnlyGuardError(`READ-ONLY GUARD blocked ${model ? `${model}.` : ''}${operation}`)
    },
  },
})
;(globalThis as { prisma?: unknown }).prisma = guarded

// ── outbound hosts (host only: a Rolling Insights URL carries its token in the query) ────────
const hostsByCase = new Map<string, Set<string>>()
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const host = new URL(url).hostname
    if (!hostsByCase.has(currentCase)) hostsByCase.set(currentCase, new Set())
    hostsByCase.get(currentCase)!.add(host)
  } catch {
    /* recording must never break a request */
  }
  return realFetch(input, init)
}) as typeof fetch

// ── pricing (USD per million tokens), for the cost line ────────────────────────────────────────
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
}
type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
function costOf(model: string, u: Usage): number {
  const key = Object.keys(PRICE).find((k) => model.startsWith(k))
  if (!key) return NaN
  const p = PRICE[key]
  return (
    ((u.input_tokens ?? 0) * p.in +
      (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 +
      (u.cache_read_input_tokens ?? 0) * p.in * 0.1 +
      (u.output_tokens ?? 0) * p.out) /
    1e6
  )
}

type ToolCall = { turn: number; name: string; input: unknown; result: string }
type RunRecord = {
  id: string
  category: string
  q: string
  decision: string | null
  path: 'asked_which_league' | 'deterministic' | 'deterministic_refusal' | 'live_search' | 'tool_loop' | 'fell_through_to_pecr' | 'skipped' | 'error'
  text: string
  leagueSelected: string | null
  tools: ToolCall[]
  responses: Array<{ turn: number; model: string; stopReason: string | null; usage: Usage; cost: number }>
  giveUp: { reason: string; detail?: string } | null
  citations?: unknown
  blockedWrites: Array<{ model?: string; operation: string }>
  hosts: string[]
  ms: number
  note?: string
}

async function main() {
  if (REGRADE) {
    const earlier = JSON.parse(readFileSync(REGRADE, 'utf8')) as RunRecord[]
    mkdirSync(outAbs, { recursive: true })
    currentCase = 'grading'
    const regraded = []
    for (const rec of earlier) {
      const c = CHIMMY_ANSWER_BANK.find((x) => x.id === rec.id) ?? die(`no case ${rec.id}`)
      regraded.push(await grade(rec, c))
    }
    writeFileSync(join(outAbs, 'graded.json'), JSON.stringify(regraded, null, 2))
    writeFileSync(join(outAbs, 'scorecard.md'), scorecard(regraded, `${endpoint} (re-graded from an earlier run)`))
    console.log(`[chimmy-eval] re-graded ${regraded.length} runs -> ${join(outAbs, 'scorecard.md')}`)
    await base.$disconnect()
    return
  }
  console.log(`[chimmy-eval] database endpoint: ${endpoint} (read-only requested)`)

  // ── controls: prove both read-only layers before anything else ──
  const shown = (await base.$queryRawUnsafe(`SHOW default_transaction_read_only`)) as Array<Record<string, string>>
  const roValue = shown?.[0]?.default_transaction_read_only
  if (roValue !== 'on') die(`server reports default_transaction_read_only=${roValue}; the database-level guard is not in force`)
  console.log('[chimmy-eval] control 1 PASS: server confirms default_transaction_read_only=on')

  for (const [label, attempt] of [
    ['model write', () => (guarded as unknown as PrismaClient).appUser.update({ where: { id: '__chimmy_eval_never__' }, data: {} })],
    ['raw execute', () => (guarded as unknown as PrismaClient).$executeRawUnsafe('SELECT 1')],
    ['raw write disguised as query', () => (guarded as unknown as PrismaClient).$queryRawUnsafe('UPDATE app_users SET email = email WHERE false')],
  ] as const) {
    try {
      await attempt()
      die(`control (${label}) was NOT blocked by the guard`)
    } catch (err) {
      if (!(err instanceof ReadOnlyGuardError)) die(`control (${label}) reached the database instead of the guard: ${(err as Error).message.slice(0, 200)}`)
    }
  }
  console.log('[chimmy-eval] control 2 PASS: guard blocked a model write, a raw execute and a raw write, before the database')
  const ok = (await (guarded as unknown as PrismaClient).$queryRawUnsafe('SELECT 1 AS ok')) as Array<{ ok: number }>
  if (Number(ok?.[0]?.ok) !== 1) die('control 3: a plain read failed')
  console.log('[chimmy-eval] control 3 PASS: reads work through the guard')
  blocked.length = 0

  // ── suppress owner alert emails for this run (a failing provider would otherwise email) ──
  const alerts = await import('../../lib/ai-orchestration/providerOutageAlert')
  alerts.__resetProviderOutageAlertsForTests(async (subject: string) => {
    console.warn(`[chimmy-eval] provider alert suppressed (not emailed): ${subject}`)
  })

  // ── the account and its leagues ──
  const user = await (guarded as unknown as PrismaClient).appUser.findUnique({ where: { email: USER_EMAIL! }, select: { id: true } })
  if (!user) die('no account with that email')
  const userId = user.id
  const { listMemberLeagues } = await import('../../lib/chimmy/tools/leagueByName')
  const member = await listMemberLeagues(userId)
  const detail = await (guarded as unknown as PrismaClient).league.findMany({
    where: { id: { in: member.map((l) => l.id) } },
    select: { id: true, name: true, platform: true, sport: true, season: true, updatedAt: true },
  })
  const kindOf = (platform: string): 'imported' | 'other_import' | 'native' => {
    const p = platform.toLowerCase()
    if (p === 'sleeper') return 'imported'
    if (['espn', 'yahoo', 'fantrax', 'mfl', 'myfantasyleague', 'fleaflicker', 'cbs', 'nfl'].includes(p)) return 'other_import'
    return 'native'
  }
  const candidates = (kind: string) =>
    detail
      .filter((l) => l.name && kindOf(l.platform) === kind)
      .sort(
        (a, b) =>
          Number(b.sport === 'NFL') - Number(a.sport === 'NFL') ||
          b.season - a.season ||
          b.updatedAt.getTime() - a.updatedAt.getTime(),
      )
  const pick = (placeholder: string, kind: string) => {
    const pool = candidates(kind)
    const wanted = LEAGUE_OVERRIDE[placeholder]
    if (!wanted) return pool[0]
    return pool.find((l) => l.name === wanted) ?? die(`${placeholder}: no ${kind} member league named "${wanted}"`)
  }
  const fixtures = {
    '{nativeLeague}': pick('{nativeLeague}', 'native'),
    '{importedLeague}': pick('{importedLeague}', 'imported'),
    '{otherImport}': pick('{otherImport}', 'other_import'),
  }
  if (CONTROLS_ONLY) {
    for (const kind of ['native', 'imported', 'other_import']) {
      const pool = candidates(kind)
      console.log(`[chimmy-eval] ${kind} candidates (${pool.length}): ${pool.slice(0, 12).map((l) => `"${l.name}" ${l.sport} ${l.season}`).join('; ')}`)
    }
  }
  const platforms = [...new Set(detail.map((l) => l.platform))]
  console.log(`[chimmy-eval] account has ${detail.length} member leagues; platforms: ${platforms.join(', ')}`)
  for (const [ph, l] of Object.entries(fixtures)) {
    console.log(`[chimmy-eval] ${ph} -> ${l ? `"${l.name}" (${l.platform}, ${l.sport} ${l.season})` : 'NONE'}`)
  }

  const cases = IDS.length ? IDS.map((id) => CHIMMY_ANSWER_BANK.find((c) => c.id === id) ?? die(`no case ${id}`)) : []
  if (CONTROLS_ONLY || cases.length === 0) {
    console.log('[chimmy-eval] controls-only: no question was run and nothing was spent')
    await base.$disconnect()
    return
  }

  mkdirSync(outAbs, { recursive: true })
  const { classifyPecrIntent, requiresLeagueGrounding } = await import('../../lib/chimmy-chat/question-routing')
  const { resolveChimmyLeagueSelection } = await import('../../lib/chimmy/chimmy-league-resolution')
  const { tryDeterministicAnswerDetailed } = await import('../../lib/ai/deterministic')
  const { answerSportsQuestionFromSearch } = await import('../../lib/ai/liveSportsAnswer')
  const { getChimmyFeatureFlags } = await import('../../lib/chimmy-chat/feature-flags')
  const { runChimmyToolLoop } = await import('../../lib/chimmy/tools/chimmyToolLoop')
  const { CHIMMY_TOOL_LOOP_SYSTEM_PROMPT, CHIMMY_REFERENCE_TIMEZONE } = await import('../../lib/chimmy/tools/toolLoopSystemPrompt')
  const { buildUserTemporalContextForAI } = await import('../../lib/preferences/userTemporalContextForAI')
  const flags = getChimmyFeatureFlags()
  const profile = await (guarded as unknown as PrismaClient).userProfile
    .findUnique({ where: { userId }, select: { preferredLanguage: true } })
    .catch(() => null)
  const clockLine = buildUserTemporalContextForAI({ timezone: CHIMMY_REFERENCE_TIMEZONE, preferredLanguage: profile?.preferredLanguage }).promptLine

  const records: RunRecord[] = []
  for (const c of cases) {
    currentCase = c.id
    const started = Date.now()
    const rec: RunRecord = {
      id: c.id, category: c.category, q: c.q, decision: c.decision, path: 'error', text: '', leagueSelected: null,
      tools: [], responses: [], giveUp: null, blockedWrites: [], hosts: [], ms: 0,
    }
    try {
      let q = c.q
      for (const [ph, l] of Object.entries(fixtures)) {
        if (q.includes(ph)) {
          if (!l?.name) throw Object.assign(new Error(`no fixture league for ${ph}`), { skip: true })
          q = q.split(ph).join(l.name)
        }
      }
      rec.q = q
      console.log(`\n[chimmy-eval] ${c.id}: ${q}`)

      let leagueId: string | null = null
      if (requiresLeagueGrounding({ message: q, intent: classifyPecrIntent(q) })) {
        const sel = await resolveChimmyLeagueSelection({ userId, message: q, leagueNameHint: null, threshold: 0.85 })
        if (sel.kind === 'selected') leagueId = sel.leagueId
        else {
          rec.path = 'asked_which_league'
          rec.text = (sel as { message?: string }).message ?? '(asked which league)'
        }
      }
      rec.leagueSelected = leagueId

      if (rec.path !== 'asked_which_league') {
        const det = await tryDeterministicAnswerDetailed(q, 'en', leagueId, leagueId != null)
        if (det) {
          if (det.kind === 'refusal' && flags.liveSearchFallback) {
            const searched = await answerSportsQuestionFromSearch(q).catch(() => null)
            if (searched) {
              rec.path = 'live_search'
              rec.text = searched.text
              rec.citations = searched.citations
            } else {
              rec.path = 'deterministic_refusal'
              rec.text = det.text
            }
          } else {
            rec.path = det.kind === 'answer' ? 'deterministic' : 'deterministic_refusal'
            rec.text = det.text
          }
        } else {
          const loop = await runChimmyToolLoop({
            question: q,
            systemPrompt: CHIMMY_TOOL_LOOP_SYSTEM_PROMPT,
            clockLine,
            conversation: [],
            context: { leagueId, userId },
            enabled: true,
            observer: {
              onToolResult: (e) => rec.tools.push({ turn: e.turn, name: e.name, input: e.input, result: e.result }),
              onResponse: (e) => rec.responses.push({ ...e, usage: e.usage as Usage, cost: costOf(e.model, e.usage as Usage) }),
              onGiveUp: (e) => (rec.giveUp = e),
            },
          })
          if (loop?.text) {
            rec.path = 'tool_loop'
            rec.text = loop.text
          } else {
            rec.path = 'fell_through_to_pecr'
            rec.note = 'The tool loop returned nothing; production would continue to the PECR path, which this runner does not run.'
          }
        }
      }
    } catch (err) {
      if ((err as { skip?: boolean }).skip) {
        rec.path = 'skipped'
        rec.note = (err as Error).message
      } else {
        rec.path = 'error'
        rec.note = (err as Error).message.slice(0, 300)
      }
    }
    rec.ms = Date.now() - started
    rec.blockedWrites = blocked.filter((b) => b.at === c.id).map(({ model, operation }) => ({ model, operation }))
    rec.hosts = [...(hostsByCase.get(c.id) ?? [])]
    console.log(`[chimmy-eval]   -> ${rec.path}; tools: ${rec.tools.map((t) => t.name).join(', ') || 'none'}; ${rec.ms}ms`)
    records.push(rec)
    writeFileSync(join(outAbs, 'runs.json'), JSON.stringify(records, null, 2))
  }

  currentCase = 'grading'
  const graded = []
  for (const rec of records) graded.push(await grade(rec, cases.find((c) => c.id === rec.id)!))
  writeFileSync(join(outAbs, 'graded.json'), JSON.stringify(graded, null, 2))
  writeFileSync(join(outAbs, 'scorecard.md'), scorecard(graded, endpoint))
  console.log(`\n[chimmy-eval] wrote ${join(outAbs, 'scorecard.md')}`)
  await base.$disconnect()
}

// ── grading ───────────────────────────────────────────────────────────────────────────────────

/*
 * ⚠ ONLY THE TOOL LOOP'S EVIDENCE IS CAPTURED. The pilot's first grading scored real database facts
 * from the deterministic step as "invented", because the grader never saw what that step read, and
 * scored a cited web answer as fabricated, because citations carry a title and a URL, not the page.
 * Both were the grader's blind spot, not Chimmy's. On those paths the grader is told what it cannot
 * see, and judges what it can: above all, whether the question asked is the question answered.
 */
const PATH_NOTE: Partial<Record<RunRecord['path'], string>> = {
  deterministic: [
    '',
    "WARNING: this answer came from the app's deterministic step, which reads app data that is NOT shown here.",
    'Mark `grounded` "n/a" and list no invented facts for data you cannot see.',
    'Judge everything else, above all whether it answers the question that was asked.',
  ].join('\n'),
  deterministic_refusal: [
    '',
    "WARNING: this answer came from the app's deterministic step (a refusal), which reads app data that is NOT shown here.",
    'Mark `grounded` "n/a" and list no invented facts for data you cannot see.',
  ].join('\n'),
  asked_which_league: [
    '',
    "WARNING: the app asked which league the user meant. League names in it come from the user's own league list, which is NOT shown here; they are not invented.",
    'Mark `grounded` "n/a". Judge whether asking was reasonable for this question.',
  ].join('\n'),
  live_search: [
    '',
    'WARNING: this answer came from a live web search. The citations are titles and URLs only; you cannot see the page text.',
    'Mark `grounded` "n/a" and list no invented facts. Judge `sourced` on whether it names and links its sources, and everything else as usual.',
  ].join('\n'),
}
const NUM = /\d[\d,]*(?:\.\d+)?/g
function numbersIn(s: string): string[] {
  return [...new Set((s.match(NUM) ?? []).map((n) => n.replace(/,/g, '')))]
}

/** Every tool that asks the Decision OS for a verdict. None exists yet; the bank records that. */
const DECISION_TOOLS = new Set<string>()

type Verdict = 'pass' | 'fail' | 'n/a'
type Graded = RunRecord & {
  checks: {
    governed: Verdict
    groundToolUsed: Verdict
    unmatchedNumbers: string[]
  }
  judge: {
    criteria: Array<{ id: string; result: Verdict; evidence: string }>
    made_recommendation: boolean
    invented_facts: string[]
    summary: string
  } | null
  judgeCost: number
  chimmyCost: number
}

async function grade(rec: RunRecord, c: AnswerCase): Promise<Graded> {
  const toolText = rec.tools.map((t) => t.result).join('\n') + '\n' + JSON.stringify(rec.citations ?? '')
  const known = new Set(numbersIn(toolText.replace(/,/g, '')).concat(numbersIn(rec.q)))
  // Only a tool-loop answer has its evidence captured; on any other path this check is noise.
  const unmatchedNumbers = rec.text && rec.path === 'tool_loop' ? numbersIn(rec.text).filter((n) => !known.has(n)) : []
  const wantTools = c.groundOn.filter((s) => s.kind === 'tool').map((s) => (s as { tool: string }).tool)
  const checks = {
    governed: (c.decision ? (rec.tools.some((t) => DECISION_TOOLS.has(t.name)) ? 'pass' : 'fail') : 'n/a') as Verdict,
    groundToolUsed: (wantTools.length ? (rec.tools.some((t) => wantTools.includes(t.name)) ? 'pass' : 'fail') : 'n/a') as Verdict,
    unmatchedNumbers,
  }
  const chimmyCost = rec.responses.reduce((s, r) => s + (Number.isFinite(r.cost) ? r.cost : 0), 0)
  if (!rec.text || rec.path === 'skipped' || rec.path === 'error') return { ...rec, checks, judge: null, judgeCost: 0, chimmyCost }

  const criteriaIds = [...Object.keys(GLOBAL_RUBRIC), ...c.rubric.map((_, i) => `case_${i + 1}`)]
  const CAP = 60_000
  let budget = CAP
  const transcript = rec.tools
    .map((t) => {
      const body = t.result.length > budget ? `${t.result.slice(0, Math.max(0, budget))}\n[TRUNCATED FOR GRADING]` : t.result
      budget = Math.max(0, budget - t.result.length)
      return `### tool ${t.name} (turn ${t.turn})\ninput: ${JSON.stringify(t.input)}\nresult:\n${body}`
    })
    .join('\n\n')

  const prompt = [
    'You grade one answer from Chimmy, a fantasy-sports assistant, against a written rubric. Grade what is on the page; do not reward what the answer could have said.',
    'The owner\'s rule: Chimmy must not make a recommendation or state a fact without the app\'s own systems behind it. Facts must come from the tool results below (or cited sources); recommendations must come from a Decision OS decision.',
    `\n## Question\n${rec.q}`,
    `\n## Case metadata\ncategory: ${c.category}\nrequired decision: ${c.decision ?? 'none (informational)'}\nrequired sources: ${JSON.stringify(c.groundOn)}\nanswer path: ${rec.path}${rec.giveUp ? ` (loop gave up: ${rec.giveUp.reason})` : ''}\nDecision OS decision tools called: none exist yet`,
    `\n## Tool results the answer could use\n${transcript || '(no tools were called)'}${rec.citations ? `\n\n## Web citations\n${JSON.stringify(rec.citations).slice(0, 8000)}` : ''}`,
    `\n## The answer\n${rec.text}`,
    '\n## Criteria — return exactly one result per id',
    ...Object.entries(GLOBAL_RUBRIC).map(([id, text]) => `- ${id}: ${text}`),
    ...c.rubric.map((text, i) => `- case_${i + 1}: ${text}`),
    PATH_NOTE[rec.path] ?? '',
    '\nUse "n/a" only when a criterion cannot apply to this question (for example `governed` when no decision is required). A claim you cannot find in the tool results or citations is ungrounded — unless it sits in a part marked [TRUNCATED FOR GRADING], in which case do not fail `grounded` for it. Quote the sentence that decides each result in `evidence`, briefly.',
    '`made_recommendation`: true if the answer tells the user what to do (trade, add, drop, start, sit, pick, bet).',
    '`invented_facts`: each specific fact in the answer that is not in the tool results or citations.',
  ].join('\n')

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['criteria', 'made_recommendation', 'invented_facts', 'summary'],
    properties: {
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'result', 'evidence'],
          properties: {
            id: { type: 'string', enum: criteriaIds },
            result: { type: 'string', enum: ['pass', 'fail', 'n/a'] },
            evidence: { type: 'string' },
          },
        },
      },
      made_recommendation: { type: 'boolean' },
      invented_facts: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 })
  try {
    const res = (await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } },
    } as unknown as Parameters<typeof client.messages.create>[0])) as unknown as { content: Array<{ type: string; text?: string }>; usage: Usage; model: string; stop_reason: string }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const judge = JSON.parse(text)
    return { ...rec, checks, judge, judgeCost: costOf(res.model || JUDGE_MODEL, res.usage), chimmyCost }
  } catch (err) {
    console.warn(`[chimmy-eval] grading ${rec.id} failed: ${(err as Error).message.slice(0, 200)}`)
    return { ...rec, checks, judge: null, judgeCost: 0, chimmyCost }
  }
}

function scorecard(rows: Graded[], ep: string): string {
  const crit = [...Object.keys(GLOBAL_RUBRIC)]
  const tally = (id: string) => {
    const r = rows.flatMap((g) => g.judge?.criteria.filter((x) => x.id === id) ?? [])
    return `${r.filter((x) => x.result === 'pass').length} pass / ${r.filter((x) => x.result === 'fail').length} fail / ${r.filter((x) => x.result === 'n/a').length} n/a`
  }
  const chimmy = rows.reduce((s, g) => s + g.chimmyCost, 0)
  const judge = rows.reduce((s, g) => s + g.judgeCost, 0)
  const paths = rows.reduce((m: Record<string, number>, g) => ((m[g.path] = (m[g.path] ?? 0) + 1), m), {})
  const lines = [
    `# Chimmy answer-bank run — ${new Date().toISOString()}`,
    '',
    `Database endpoint \`${ep}\`, read-only (server-confirmed + client guard). Answer model: tool-loop default; judge: \`${JUDGE_MODEL}\`.`,
    '',
    `**Cost:** Chimmy $${chimmy.toFixed(3)} (metered tool-loop turns only; live-search not metered) + judge $${judge.toFixed(3)} = $${(chimmy + judge).toFixed(3)} for ${rows.length} questions.`,
    '',
    `**Answer paths:** ${Object.entries(paths).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    '',
    '## Rubric totals (judge)',
    ...crit.map((id) => `- ${id}: ${tally(id)}`),
    `- governed (deterministic: a Decision OS tool was called): ${rows.filter((g) => g.checks.governed === 'pass').length} pass / ${rows.filter((g) => g.checks.governed === 'fail').length} fail`,
    `- recommendations made without a Decision OS decision: ${rows.filter((g) => g.judge?.made_recommendation && !g.tools.some((t) => DECISION_TOOLS.has(t.name))).length}`,
    '',
    '## Per question',
    '',
    '| id | path | tools | fails | invented | unmatched numbers | blocked writes | cost |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((g) => {
      const fails = g.judge ? g.judge.criteria.filter((x) => x.result === 'fail').map((x) => x.id).join(', ') || '—' : 'not graded'
      return `| ${g.id} | ${g.path}${g.giveUp ? ` (${g.giveUp.reason})` : ''} | ${g.tools.map((t) => t.name).join(', ') || '—'} | ${fails} | ${g.judge?.invented_facts.length ?? '—'} | ${g.checks.unmatchedNumbers.slice(0, 6).join(' ') || '—'} | ${g.blockedWrites.map((b) => `${b.model ?? ''}.${b.operation}`).join(', ') || '—'} | $${(g.chimmyCost + g.judgeCost).toFixed(3)} |`
    }),
    '',
    '## Answers and judge notes',
    ...rows.flatMap((g) => [
      '',
      `### ${g.id} — ${g.q}`,
      '',
      `path: ${g.path}${g.note ? ` — ${g.note}` : ''}; hosts: ${g.hosts.join(', ') || '—'}`,
      '',
      '> ' + (g.text || '(no answer)').replace(/\n/g, '\n> '),
      '',
      g.judge ? `**Judge:** ${g.judge.summary}` : '',
      ...(g.judge?.criteria.filter((x) => x.result === 'fail').map((x) => `- ✗ ${x.id}: ${x.evidence}`) ?? []),
      ...(g.judge?.invented_facts.map((f) => `- invented: ${f}`) ?? []),
    ]),
  ]
  return lines.join('\n') + '\n'
}

main().catch(async (err) => {
  console.error('[chimmy-eval] failed:', (err as Error).message)
  await base.$disconnect().catch(() => undefined)
  process.exit(1)
})
