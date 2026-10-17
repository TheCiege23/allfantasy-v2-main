import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * 🛑 THE LEAGUE TRADE FINDER RAN UNSEEN (removed 2026-09-30, owner's decision).
 *
 * Selecting a league in the /af-legacy Trade Hub fired `/api/legacy/trade/league-analyze` (or
 * `/api/ai/trade/league-analyze`, which delegated to it) — a GPT-4o call, every select. Its results
 * rendered nowhere: the finder list sat inside a `{false && …}` block, so the graded letters reached
 * only a feedback log and the legacy-chat `league_analyze` snapshot. The call, the dead UI and both
 * routes are gone; the census found no other caller.
 */

vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: vi.fn(() => {
    throw new Error('no LLM client may be built by this test')
  }),
}))

/** Source with comments stripped, so a comment recording the removal is not read as a caller. */
const code = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const LEAGUE_ANALYZE_URL = /(?:legacy|ai)\/trade\/league-analyze/
/** The Trade Hub's league-select handler, from `renderLeagueDropdown('tradeHub', …` to its close. */
const tradeHubSelectHandler = (page: string) => {
  const start = page.indexOf("renderLeagueDropdown('tradeHub'")
  return start < 0 ? '' : page.slice(start, page.indexOf('})}', start))
}

describe('league-analyze — no unseen LLM call on league select', () => {
  const page = code('app/af-legacy/page.tsx')

  it('the Trade Hub league select loads the managers and the report card, and runs no trade finder', () => {
    const handler = tradeHubSelectHandler(page)
    expect(handler).toMatch(/loadTradeHubManagers\(leagueId\)/)
    expect(handler).toMatch(/loadTradeHistoryReportCard\(leagueId, 'all'\)/)
    expect(handler).not.toMatch(/runTradeFinderAnalysis|LeagueAnalyze|league-analyze/)
  })

  it('nothing on the page calls league-analyze, and the finder that did is gone', () => {
    expect(page).not.toMatch(LEAGUE_ANALYZE_URL)
    expect(page).not.toMatch(/runTradeFinderAnalysis/)
  })

  it('the dead `{false && …}` finder list is gone with it', () => {
    expect(page).not.toMatch(/LEGACY_FINDER_REMOVED_MARKER/)
    expect(page).not.toMatch(/\btradeSuggestions\b/)
  })

  it('positive controls: the shapes match the code they replaced', () => {
    const old = [
      "{renderLeagueDropdown('tradeHub', leagues, reportCardLeague, (leagueId) => {",
      '  loadTradeHubManagers(leagueId)',
      '  runTradeFinderAnalysis(leagueId)',
      '})}',
    ].join('\n')
    expect(/runTradeFinderAnalysis|LeagueAnalyze|league-analyze/.test(tradeHubSelectHandler(old))).toBe(true)
    expect(LEAGUE_ANALYZE_URL.test("          : '/api/legacy/trade/league-analyze'")).toBe(true)
    expect(LEAGUE_ANALYZE_URL.test("          ? '/api/ai/trade/league-analyze'")).toBe(true)
  })
})

describe('league-analyze — both routes are removed', () => {
  it('neither route module exists', () => {
    expect(existsSync(resolve(process.cwd(), 'server/api-route-modules/legacy/trade/league-analyze/route.ts'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'app/api/ai/trade/league-analyze/route.ts'))).toBe(false)
  })

  it('the legacy dispatcher no longer routes it', () => {
    expect(code('app/api/legacy/[...path]/route.ts')).not.toMatch(/"league-analyze"/)
  })

  it('POST /api/legacy/trade/league-analyze is a 404 — no handler is loaded, no model is asked', async () => {
    const { POST } = await import('@/app/api/legacy/[...path]/route')
    const res = await POST(
      new NextRequest('http://localhost/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ league_id: '1', sleeper_username: 'someone', sport: 'nfl' }),
      }),
      { params: { path: ['trade', 'league-analyze'] } },
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Route not found', path: 'trade/league-analyze' })
  })
})
