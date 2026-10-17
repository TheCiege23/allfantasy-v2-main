import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * 🛑 THE TRADE-PREFERENCES QUIZ HAD NO UI, BUT STILL READ THE DATABASE (removed 2026-09-30).
 *
 * Opening /af-legacy's Trade Finder tab ran `checkQuizStatus`, a GET of `/api/legacy/trade/preferences`
 * (a `TradePreferences` read plus the quiz's question set). The quiz UI that consumed it lived in the
 * `{false && …}` finder block removed with league-analyze (1b2e29ca4), so nothing rendered the answer;
 * `submitQuiz` / `handleQuizAnswer` had no caller. The fetch, the quiz state and functions, the
 * preferences route and `lib/trade-quiz-data.ts` (its only importer was that route) are gone.
 *
 * `/api/legacy/trade/feedback` lost its only caller (`submitTradeFeedback`) in the same removal and is
 * deleted with its dispatcher entry. Nothing writes `TradeFeedback` now; its readers are unchanged.
 * The `TradePreferences` / `TradeFeedback` tables are untouched — no migration.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, {
    get() {
      throw new Error('no database access may happen in this test')
    },
  }),
}))

/** Source with comments stripped, so a comment recording the removal is not read as code. */
const code = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const PREFERENCES_URL = /legacy\/trade\/preferences/
const FEEDBACK_URL = /legacy\/trade\/feedback/
const QUIZ_CODE = /\b(checkQuizStatus|submitQuiz|handleQuizAnswer|setQuiz\w+|quiz(Trades|Responses|CurrentIndex|Completed|Loading|Checked))\b/

describe('the trade-preferences quiz — no fetch, no state', () => {
  const page = code('app/af-legacy/page.tsx')

  it('opening the finder tab fetches nothing from the preferences route', () => {
    expect(page).not.toMatch(PREFERENCES_URL)
  })

  it('the quiz state and functions are gone', () => {
    expect(page).not.toMatch(QUIZ_CODE)
  })

  it('nothing on the page calls trade feedback', () => {
    expect(page).not.toMatch(FEEDBACK_URL)
  })

  it('positive controls: the shapes match the code they replaced', () => {
    expect(PREFERENCES_URL.test("      const res = await fetch(`/api/legacy/trade/preferences?sleeper_username=${encodeURIComponent(username)}`)")).toBe(true)
    expect(QUIZ_CODE.test("    if (activeTab === 'finder' && username && !quizChecked) {")).toBe(true)
    expect(QUIZ_CODE.test('      checkQuizStatus()')).toBe(true)
    expect(FEEDBACK_URL.test("      const res = await fetch('/api/legacy/trade/feedback', {")).toBe(true)
  })
})

describe('the dead routes are removed', () => {
  it('neither route module, nor the quiz data only the preferences route read, exists', () => {
    for (const rel of [
      'server/api-route-modules/legacy/trade/preferences/route.ts',
      'server/api-route-modules/legacy/trade/feedback/route.ts',
      'lib/trade-quiz-data.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), rel)), rel).toBe(false)
    }
  })

  it('the legacy dispatcher no longer routes them', () => {
    const dispatcher = code('app/api/legacy/[...path]/route.ts')
    expect(dispatcher).not.toMatch(/\["trade","preferences"\]/)
    expect(dispatcher).not.toMatch(/\["trade","feedback"\]/)
  })

  const call = async (method: 'GET' | 'POST' | 'PUT', path: string[], body?: unknown) => {
    const mod = await import('@/app/api/legacy/[...path]/route')
    const handler = mod[method] as (req: NextRequest, ctx: { params: { path: string[] } }) => Promise<Response>
    return handler(
      new NextRequest(`http://localhost/api/legacy/${path.join('/')}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { params: { path } },
    )
  }

  it('GET /api/legacy/trade/preferences is a 404 — no handler loaded, no database read', async () => {
    const res = await call('GET', ['trade', 'preferences'])
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Route not found', path: 'trade/preferences' })
  })

  it('POST /api/legacy/trade/feedback is a 404 — no handler loaded, no database write', async () => {
    const res = await call('POST', ['trade', 'feedback'], { sleeper_username: 'someone', rating: 5 })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Route not found', path: 'trade/feedback' })
  })

  it('positive control: the dispatcher still matches a live trade/* route (PUT on a GET-only one is a 405)', async () => {
    const res = await call('PUT', ['trade', 'roster'])
    expect(res.status).toBe(405)
  })
})
