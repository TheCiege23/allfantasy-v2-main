import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isNflRedraftCoreDashboardLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('NFL redraft league shell gating', () => {
  it('accepts standard NFL redraft', () => {
    expect(
      isNflRedraftCoreDashboardLeague({
        sport: 'NFL',
        leagueType: 'redraft',
        isDynasty: false,
        leagueVariant: null,
        bestBallMode: false,
        guillotineMode: false,
        keeperPhaseActive: false,
      }),
    ).toBe(true)
  })

  it('accepts standard NCAAF redraft for the same core redraft setup shell', () => {
    expect(
      isNflRedraftCoreDashboardLeague({
        sport: 'NCAAF',
        leagueType: 'redraft',
        isDynasty: false,
        leagueVariant: null,
        bestBallMode: false,
        guillotineMode: false,
        keeperPhaseActive: false,
      }),
    ).toBe(true)
  })

  it('rejects dynasty', () => {
    expect(
      isNflRedraftCoreDashboardLeague({
        sport: 'NFL',
        leagueType: 'dynasty',
        isDynasty: true,
        leagueVariant: null,
        bestBallMode: false,
        guillotineMode: false,
        keeperPhaseActive: false,
      }),
    ).toBe(false)
  })

  it('rejects survivor variant', () => {
    expect(
      isNflRedraftCoreDashboardLeague({
        sport: 'NFL',
        leagueType: 'redraft',
        isDynasty: false,
        leagueVariant: 'survivor',
        bestBallMode: false,
        guillotineMode: false,
        keeperPhaseActive: false,
      }),
    ).toBe(false)
  })

  it('rejects guillotine mode even for NCAAF redraft', () => {
    expect(
      isNflRedraftCoreDashboardLeague({
        sport: 'NCAAF',
        leagueType: 'redraft',
        isDynasty: false,
        leagueVariant: null,
        bestBallMode: false,
        guillotineMode: true,
        keeperPhaseActive: false,
      }),
    ).toBe(false)
  })

  it('rejects NFL leagues without an explicit league type', () => {
    expect(
      isNflRedraftCoreDashboardLeague({
        sport: 'NFL',
        leagueType: null,
        isDynasty: false,
        leagueVariant: null,
        bestBallMode: false,
        guillotineMode: false,
        keeperPhaseActive: false,
      }),
    ).toBe(false)
  })
})

describe('openChimmyWithPrompt', () => {
  it('dispatches focus and prefill events', () => {
    const seen: string[] = []
    const a = (n: string, fn: (e: Event) => void) => {
      window.addEventListener(n, fn)
      return () => window.removeEventListener(n, fn)
    }
    const offA = a('af-dashboard-focus-left-chimmy', () => seen.push('focus'))
    const offB = a('af-chimmy-prefill', (e) => {
      const d = (e as CustomEvent<{ prompt?: string }>).detail?.prompt
      seen.push(`prefill:${d ?? ''}`)
    })
    try {
      openChimmyWithPrompt({
        leagueId: 'l1',
        source: 'roster',
        prompt: 'Hello Chimmy',
      })
      expect(seen).toEqual(['focus', 'prefill:Hello Chimmy'])
    } finally {
      offA()
      offB()
    }
  })
})

describe('NFL redraft pre-draft Home regression lock', () => {
  const draftTabSrc = read('app/league/[leagueId]/tabs/DraftTab.tsx')
  const leagueDraftResolverSrc = read('app/league/[leagueId]/draft/page.tsx')

  it('enters the draft room through the safe league draft resolver instead of /draft/live', () => {
    expect(draftTabSrc).toMatch(/const enterDraftRoomHref = `\/league\/\$\{league\.id\}\/draft`/)
    expect(draftTabSrc).not.toMatch(/\/draft\/live\//)
    // The canonical full-screen draft room moved to /drafts/[draftId]
    // (commit 50b53831c). The resolver upserts the session then redirects there.
    expect(leagueDraftResolverSrc).toMatch(/redirect\(`\/drafts\/\$\{[\s\S]*?\}`\)/)
  })

  it('keeps Enter Draft Room explicitly user-driven and gated on draft-room states', () => {
    expect(draftTabSrc).toMatch(/const canEnterDraftRoom = \(preDraft \|\| liveDraft \|\| draftCompleted\) && Boolean\(league\.id\)/)
    expect(draftTabSrc).toMatch(/disabled=\{!canEnterDraftRoom\}/)
    expect(draftTabSrc).toContain('The live draft room only opens when you click Enter Draft Room.')
  })

  it('renders the required pre-draft Home setup copy and summary fields', () => {
    expect(draftTabSrc).toContain('League fill')
    expect(draftTabSrc).toContain('Draft type')
    expect(draftTabSrc).toContain('Draft date')
    expect(draftTabSrc).toContain('Pick timer')
    expect(draftTabSrc).toContain('nfl-redraft-predraft-summary')
  })

  it('keeps the draft order block and its required empty state copy', () => {
    expect(draftTabSrc).toContain('data-testid="nfl-redraft-draft-order"')
    expect(draftTabSrc).toContain('Draft order has not been generated yet.')
  })

  it('keeps commissioner-only draft controls and wires draft-order generation to the existing endpoint', () => {
    expect(draftTabSrc).toContain('data-testid="nfl-redraft-generate-draft-order"')
    expect(draftTabSrc).toContain('data-testid="nfl-redraft-edit-draft-settings"')
    expect(draftTabSrc).toMatch(/fetch\('\/api\/league\/settings\/randomize-order'/)
  })
})
