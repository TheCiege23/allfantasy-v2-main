import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

/*
 * Wording and visual defects found by walking allfantasy.ai on 2026-09-25, each pinned so it
 * cannot come back quietly.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { WaiverIntel } from '@/components/decide/WaiverIntel'
import DraftHq from '@/components/core-app/screens/DraftHq'
import { AFProPlanSpotlight } from '@/components/monetization/AFProPlanSpotlight'
import { PLAN_FAMILY_INCLUDES } from '@/lib/monetization/planIncludes'
import { describeTiebreakRule } from '@/lib/core-app/waiverRuleLabels'
import type { DraftHqData } from '@/lib/core-app/draftHq'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('🛑 Waiver intelligence on /core is styled', () => {
  /*
   * Every rule in broadcast-deck.css is scoped `.bdx …`, which only the Decide deck provides. On
   * /core the panel had no `.bdx` ancestor and rendered as raw HTML — browser fonts, broken
   * avatars, "Median winning bid$3".
   */
  const intel = {
    supported: true,
    intel: {
      budget: 100,
      myRemaining: 80,
      targets: [],
      history: { claims: 0, medianBid: null, p75Bid: null, topBid: null, recent: [] },
      formulaNotes: ['note'],
      missing: [],
    },
  }

  it('on /core the panel carries the deck scope and the /core palette', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(intel))))
    render(<WaiverIntel leagueId="lg-1" surface="core" />)
    const root = screen.getByTestId('waiver-intel')
    expect(root.className.split(' ')).toEqual(expect.arrayContaining(['bdx', 'bdx-embed', 'bdx-embed-core']))
    await waitFor(() => expect(screen.getByText(/\$100 budget/)).toBeTruthy())
  })

  it('inside the deck it adds nothing — the deck already provides the scope', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(intel))))
    render(<WaiverIntel leagueId="lg-1" />)
    expect(screen.getByTestId('waiver-intel').className).toBe('')
  })

  it('the Waivers screen mounts it as core, and the stylesheet maps the palette onto /core tokens', () => {
    expect(src('components/core-app/screens/Waivers.tsx')).toContain('<WaiverIntel leagueId={data.league.id} surface="core" />')
    const css = src('components/decide/broadcast-deck.css')
    expect(css).toMatch(/\.bdx\.bdx-embed-core\s*\{[^}]*--bdx-panel:\s*var\(--surface/)
    expect(css).toMatch(/\.bdx\.bdx-embed\s*\{[^}]*background:\s*none/)
  })

  it('its notes are written for a manager, not a developer', () => {
    const service = src('lib/waiver-intel/waiverIntelService.ts')
    const notes = service.slice(service.indexOf('formulaNotes: ['), service.indexOf('formulaNotes: [') + 900)
    expect(notes).not.toMatch(/AF heuristic|\(X\/B\)|History = |exposed by the platform API/)
  })
})

describe('Waivers wording', () => {
  it('🛑 the tiebreak is never shown as a code', () => {
    expect(describeTiebreakRule('faab_highest')).toBe('Highest FAAB bid')
    expect(describeTiebreakRule('FAAB_HIGHEST')).toBe('Highest FAAB bid')
    expect(describeTiebreakRule('earliest_claim')).toBe('Earliest claim')
    expect(describeTiebreakRule('earliest_claim')).not.toMatch(/_/)
  })

  it('names the platform properly, and a league AllFantasy runs is not "only read"', () => {
    const screenSrc = src('components/core-app/screens/Waivers.tsx')
    expect(screenSrc).toContain('platformLabel(data.league.platform)')
    expect(screenSrc).toContain('Claims for this league are made here, on AllFantasy.')
  })

  it('the board states ownership as its own sentence', () => {
    const board = src('lib/core-app/waiversBoard.ts')
    expect(board).toContain('Rostered in ${Math.round(add.ownPct * 100)}% of the leagues we can see.')
    expect(board).not.toContain("bits.push(`rostered in")
  })
})

describe('Draft HQ wording', () => {
  const missing = { available: false as const, reason: 'no upcoming draft is scheduled in AllFantasy' }
  const grades = (over: Record<string, unknown>) =>
    ({
      league: { id: 'lg', name: 'L', platform: 'sleeper', format: null },
      session: missing,
      pickSlots: missing,
      madePicks: { available: false, reason: 'x' },
      board: { available: false, reason: 'x' },
      lottery: { available: false, reason: 'x' },
      queue: { available: false, reason: 'x' },
      keepers: { available: false, reason: 'x' },
      grades: {
        available: true,
        data: {
          season: 2026,
          partial: false,
          gradedPicks: 96,
          totalPicks: 96,
          scale: 'scale',
          scoringNote: null,
          teams: [{ ownerId: 'o1', name: 'Krakens', teamName: 'The Krakens', picks: 1, currentGrade: 'D', initialGrade: 'D', trend: 'steady' }],
          ...over,
        },
      },
    }) as unknown as DraftHqData

  it('🛑 an unfinished season says so — not "some picks could not be graded" beside 96/96', () => {
    render(<DraftHq data={grades({ partial: true })} />)
    const body = document.body.textContent ?? ''
    expect(body).toContain('The 2026 season is still being played')
    expect(body).not.toContain('Some picks could not be graded')
    expect(body).not.toMatch(/could not be graded/)
  })

  it('says how many picks could not be graded only when some could not', () => {
    render(<DraftHq data={grades({ gradedPicks: 90, totalPicks: 96 })} />)
    expect(document.body.textContent).toContain('6 of 96 picks could not be graded')
  })

  it('one pick is "1 pick"', () => {
    render(<DraftHq data={grades({})} />)
    expect(document.body.textContent).toContain('1 pick')
    expect(document.body.textContent).not.toContain('1 picks')
  })

  it('does not print the same "no draft" sentence twice, one card under the other', () => {
    render(<DraftHq data={grades({})} />)
    const body = document.body.textContent ?? ''
    expect(body.split('no upcoming draft is scheduled in AllFantasy').length - 1).toBe(1)
  })

  it('the /core page shows the live-draft board only when AllFantasy is running a draft', () => {
    expect(src('app/core/[[...screen]]/page.tsx')).toContain('{draftBoard?.session.available ? <DraftBoard data={draftBoard} /> : null}')
  })
})

describe('Plan copy says what the plans actually do', () => {
  it('🛑 the AF Pro spotlight lists the gates the plan card lists, and does not sell AF Legacy', () => {
    render(<AFProPlanSpotlight />)
    const items = screen.getAllByTestId('af-pro-feature-item').map((el) => el.textContent)
    expect(items).toEqual([...PLAN_FAMILY_INCLUDES.af_pro])
    expect(screen.queryByTestId('af-plan-diff-af-legacy')).toBeNull()
    expect(screen.getByTestId('af-plan-diff-af-supreme')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/where policy allows/)
  })

  it('🛑 no page promises subscribers a token discount — every plan’s discount is 0', () => {
    expect(src('components/monetization/MonetizationPurchaseSurface.tsx')).not.toMatch(/discounts on eligible rules/)
    expect(src('lib/tokens/subscription-policy.ts')).not.toMatch(/discountedTokenSpendPct:\s*[1-9]/)
  })
})
