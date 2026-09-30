import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * 🛑 THE /af-legacy "INLINE TRADE EVALUATOR" COULD NEVER GRADE A TRADE (removed 2026-09-30).
 *
 * `analyzeInlineTrade` graded two comma-separated text boxes (`inlineSideA` / `inlineSideB`). Two
 * independent reasons it never worked:
 *
 *   1. Nothing rendered the text boxes. `setInlineSideA` / `setInlineSideB` had no caller in any
 *      version of the page in this repo, so both sides were always '' and the function stopped at
 *      "Please enter players for both sides".
 *   2. Its request could not pass `/api/legacy/trade/analyze` anyway: it sent `sideA` / `sideB`
 *      (the route reads `assetsA` / `assetsB`), no `sport`, no Sleeper usernames — and typed names
 *      carry no player id, which the route requires. Pinned below against the REAL route.
 *
 * Its one caller was the Retry button under the Trade Hub's error — so a Trade Hub failure's Retry
 * replaced the real error with "Please enter players for both sides". Every error shown there comes
 * from `generateTradeHubReport`, so Retry now re-runs that.
 */

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))

import { POST } from '@/server/api-route-modules/legacy/trade/analyze/route'

/** Source with comments stripped, so a comment recording the removal is not read as a caller. */
const code = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

function post(body: unknown) {
  return (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    }),
  )
}

// Exactly what `analyzeInlineTrade` sent for "Josh Allen" vs "Puka Nacua" (dynasty, 12 teams).
const INLINE_BODY = {
  sideA: [{ type: 'player', player: { name: 'Josh Allen', pos: 'UNKNOWN' } }],
  sideB: [{ type: 'player', player: { name: 'Puka Nacua', pos: 'UNKNOWN' } }],
  format: 'dynasty',
  username: 'someone',
  numTeams: 12,
}

describe('the removed inline evaluator — its request never passed the real analyze route', () => {
  it('as sent: 400 "Invalid request format" — no sport, no Sleeper usernames', async () => {
    const res = await post(INLINE_BODY)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid request format')
    const paths = (data.details as Array<{ path: string[] }>).map((d) => d.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['sport', 'sleeper_username_a', 'sleeper_username_b']))
  })

  it('with those fields added: its `sideA`/`sideB` are not read, so both sides are empty', async () => {
    const res = await post({ ...INLINE_BODY, sport: 'NFL', sleeper_username_a: 'someone', sleeper_username_b: 'other' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Both sides must have at least one asset.')
  })

  it('renamed to assetsA/assetsB: a typed name has no player id, which the route requires', async () => {
    const res = await post({
      sport: 'NFL', format: 'dynasty', sleeper_username_a: 'someone', sleeper_username_b: 'other',
      assetsA: INLINE_BODY.sideA, assetsB: INLINE_BODY.sideB,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Side A: Every player must have a stable identifier (id).')
  })
})

/** `generateTradeHubReport`'s body, from its declaration to its closing brace at component depth. */
const tradeHubReport = (page: string) => {
  const start = page.indexOf('const generateTradeHubReport = async () => {')
  return start < 0 ? '' : page.slice(start, page.indexOf('\n  }\n', start) + 4)
}
/** The Retry button under the Trade Hub's error. */
const RETRY = /onClick=\{\(\) => \{ setInlineTradeError\(''\); (\w+)\(\); \}\}[\s\S]{0,400}?Retry\s*<\/button>/

describe('the Trade Hub error’s Retry re-runs the Trade Hub report', () => {
  const page = code('app/af-legacy/page.tsx')

  it('the inline evaluator is gone', () => {
    expect(page).not.toMatch(/\banalyzeInlineTrade\b/)
  })

  it('Retry calls generateTradeHubReport', () => {
    expect(page.match(RETRY)?.[1]).toBe('generateTradeHubReport')
  })

  it('every error Retry can be shown under is set by generateTradeHubReport', () => {
    const body = tradeHubReport(page)
    expect(body.length).toBeGreaterThan(1000)
    const all = page.match(/setInlineTradeError\((?!'')/g) ?? []
    const inReport = body.match(/setInlineTradeError\((?!'')/g) ?? []
    expect(all.length).toBeGreaterThan(0)
    expect(inReport.length).toBe(all.length)
  })

  it('positive controls: the shapes match the code they replaced', () => {
    const old = [
      "                              onClick={() => { setInlineTradeError(''); analyzeInlineTrade(); }}",
      '                              disabled={inlineTradeLoading}',
      '                            >',
      '                              Retry',
      '                            </button>',
    ].join('\n')
    expect(old.match(RETRY)?.[1]).toBe('analyzeInlineTrade')
    const withInline = [
      '  const generateTradeHubReport = async () => {',
      "    setInlineTradeError('Please select both teams')",
      '  }',
      '  const analyzeInlineTrade = async () => {',
      "    setInlineTradeError('Please enter players for both sides')",
      '  }',
      '',
    ].join('\n')
    expect(tradeHubReport(withInline).match(/setInlineTradeError\((?!'')/g)?.length).toBe(1)
    expect(withInline.match(/setInlineTradeError\((?!'')/g)?.length).toBe(2)
  })
})
