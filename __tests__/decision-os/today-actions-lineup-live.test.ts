import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Stage 1 source-contract tests for the Lineup LIVE kill switch's second consumer:
 * lib/today-actions-engine/runTodayActions.ts, which backs /api/dashboard/today-actions — the
 * route the real, live dashboard (DashboardOverview.tsx) actually calls.
 *
 * The flag-gate function itself (shouldRunLineupLive) is already unit tested in
 * decision-os/lineup-live.test.ts; this file only covers the second wiring site, mirroring that
 * file's structure so the two stay easy to compare.
 */
const engineSrc = readFileSync(
  resolve(process.cwd(), 'lib/today-actions-engine/runTodayActions.ts'),
  'utf8',
)
const typesSrc = readFileSync(resolve(process.cwd(), 'lib/today-actions-engine/types.ts'), 'utf8')

describe('runTodayActions Stage 1 lineup wiring', () => {
  it('imports shouldRunLineupLive and runLineupShadowForSummary from the shadow module', () => {
    expect(engineSrc).toContain('shouldRunLineupLive')
    expect(engineSrc).toContain('runLineupShadowForSummary')
    expect(engineSrc).toContain("from '@/lib/decision-os/lineup/shadow'")
  })

  it('imports toTodayLineupCard for card rendering', () => {
    expect(engineSrc).toContain('toTodayLineupCard')
    expect(engineSrc).toContain("from '@/lib/decision-os/lineup/todayCardAdapter'")
  })

  it('gates the LIVE path with shouldRunLineupLive(process.env)', () => {
    expect(engineSrc).toMatch(/shouldRunLineupLive\(process\.env\)/)
  })

  it('uses the pre-Chimmy raw summary (lineupRaw), not the AI-enriched one, as the recommender', () => {
    // Matches app/api/today/lineup-actions/route.ts's own pattern: the shadow/live decision is fed
    // the deterministic summary, never the Chimmy-advice-attached one — AI must never be upstream
    // of a Decision OS input, only downstream (explanation-only).
    expect(engineSrc).toContain('runLineupShadowForSummary(userId, lineupRaw')
  })

  it('LIVE path builds decisionOs from all four required fields', () => {
    const liveIdx = engineSrc.indexOf('if (shouldRunLineupLive(process.env)) {')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = engineSrc.slice(liveIdx, liveIdx + 900)
    expect(liveBlock).toContain('decisionId: decision.decision_id')
    expect(liveBlock).toContain('toTodayLineupCard(decision)')
    expect(liveBlock).toContain('confidence: decision.confidence')
    expect(liveBlock).toContain('leagueId: first.leagueId')
  })

  it('LIVE path is isolated in try/catch so a Decision OS failure never breaks the today-actions engine', () => {
    const liveIdx = engineSrc.indexOf('if (shouldRunLineupLive(process.env)) {')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = engineSrc.slice(liveIdx, liveIdx + 1400)
    expect(liveBlock).toMatch(/try\s*\{/)
    expect(liveBlock).toMatch(/\}\s*catch\s*\{/)
  })

  it('decisionOs is only built when the shadow ran and has a result', () => {
    expect(engineSrc).toContain('first?.ran && first.result')
  })

  it('decisionOs defaults to null and is always present as a field on the returned object', () => {
    // Unlike the route (which spreads it in conditionally), the engine always includes the key —
    // callers (DashboardOverview.tsx) read data.decisionOs directly and handle null themselves.
    expect(engineSrc).toMatch(/let decisionOs: TodayActionsEngineResponse\['decisionOs'\] = null/)
    const returnIdx = engineSrc.lastIndexOf('return {')
    expect(returnIdx).toBeGreaterThan(-1)
    expect(engineSrc.slice(returnIdx)).toContain('decisionOs,')
  })

  it('all existing legacy fields remain in the returned object (lineup, waivers, trades, counts)', () => {
    const returnIdx = engineSrc.lastIndexOf('return {')
    const returnBlock = engineSrc.slice(returnIdx)
    expect(returnBlock).toContain('lineup,')
    expect(returnBlock).toContain('waivers,')
    expect(returnBlock).toContain('trades,')
    expect(returnBlock).toContain('counts:')
    expect(returnBlock).toContain('signalHealth:')
  })

  it('TodayActionsEngineResponse type declares decisionOs as optional/nullable, matching the route field shape', () => {
    expect(typesSrc).toContain("import type { LineupTodayCard } from '@/lib/decision-os/lineup/todayCardAdapter'")
    expect(typesSrc).toMatch(/decisionOs\?:\s*\{[\s\S]*?\}\s*\|\s*null/)
  })
})

describe('DashboardOverview.tsx consumes decisionOs from both today-actions call sites', () => {
  const dashboardSrc = readFileSync(
    resolve(process.cwd(), 'app/dashboard/components/DashboardOverview.tsx'),
    'utf8',
  )

  it('declares lineupDecisionOs state', () => {
    expect(dashboardSrc).toContain('const [lineupDecisionOs, setLineupDecisionOs]')
  })

  it('sets lineupDecisionOs from both the initial fetch effect and refreshTodayActionsBundle', () => {
    const occurrences = dashboardSrc.match(/setLineupDecisionOs\(data\.decisionOs \?\? null\)/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('resets lineupDecisionOs to null on empty-data and error paths (no stale enrichment across leagues)', () => {
    const occurrences = dashboardSrc.match(/setLineupDecisionOs\(null\)/g) ?? []
    expect(occurrences.length).toBe(2) // the `data` falsy branch + the `.catch` branch
  })

  it('passes decisionOsLineup through to ActionCenter', () => {
    expect(dashboardSrc).toContain('decisionOsLineup={lineupDecisionOs}')
  })
})

describe('ActionCenter renders the Decision OS confirmation badge without exposing the internal codename', () => {
  const actionCenterSrc = readFileSync(
    resolve(process.cwd(), 'app/dashboard/components/warroom/ActionCenter.tsx'),
    'utf8',
  )

  it('accepts an optional decisionOsLineup confidence prop', () => {
    expect(actionCenterSrc).toContain('decisionOsLineup?:')
  })

  it('reuses the existing, already-translated confidence key rather than inventing new customer-facing copy', () => {
    expect(actionCenterSrc).toContain("tInterpolate('dashboard.warroom.recs.confidence'")
  })

  it('never renders the literal string "Decision OS" as customer-facing text (a prior hotfix removed exactly this leak on Commissioner Hub)', () => {
    // Comments are fine (developer-facing); only check actual JSX text content by scanning the
    // render return block, not the whole file (which legitimately has "Decision OS" in comments).
    // Anchored on <WarRoomCard alone (not a literal 'return (\n<WarRoomCard') since the file has
    // CRLF line endings and readFileSync('utf8') preserves \r\n literally — a bare \n in the anchor
    // silently never matches.
    const returnIdx = actionCenterSrc.indexOf('<WarRoomCard')
    expect(returnIdx).toBeGreaterThan(-1)
    const renderBlock = actionCenterSrc.slice(returnIdx)
    expect(renderBlock).not.toMatch(/>Decision OS</)
    expect(renderBlock).not.toContain("'Decision OS'")
    expect(renderBlock).not.toContain('"Decision OS"')
  })
})
