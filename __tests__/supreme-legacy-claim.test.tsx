import React from 'react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * 🛑 AF SUPREME IS AF PRO + AF COMMISSIONER. IT DOES NOT INCLUDE AF LEGACY.
 * SUPREME_INCLUDED_PLAN_IDS has been [pro, commissioner] since Legacy was split out, and
 * lib/monetization/__tests__/planCopyHasNoTokenClaims.test.ts guards the catalog and planIncludes.
 * The claim survived anyway in five other places customers read — /upgrade's "Why Subscribe", the
 * Supreme spotlight, /all-access, the Survivor command center — because each guard read only the
 * files its author had just fixed. This one reads every .tsx under app/ and components/.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/upgrade',
  redirect: vi.fn(),
}))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: vi.fn() }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))

import { AFSupremeBundleSpotlight } from '@/components/monetization/AFSupremeBundleSpotlight'
import MonetizationPurchaseSurface from '@/components/monetization/MonetizationPurchaseSurface'
import { metadata as pricingMetadata } from '@/app/pricing/page'
import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { SUPREME_INCLUDED_PLAN_IDS } from '@/lib/subscription/feature-access'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ROOT = process.cwd()

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) tsxFiles(full, out)
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/*
 * Comments are stripped first: several files now EXPLAIN the retired claim in a comment ("NOT
 * 'Pro + Commissioner + AF Legacy'"), and a source guard that matches its own explanation fails the
 * fix for describing the bug it removed.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1')
}

const SUPREME_INCLUDES_LEGACY = [
  /Pro\s*\+\s*(AF\s+)?Commissioner\s*\+\s*(AF\s+)?Legacy/i,
  /Pro,\s*(AF\s+)?Commissioner,?\s*(and|&)\s*(AF\s+)?Legacy/i,
  /Legacy\s+(class\s+access|stack)/i,
  /all premium plan families/i,
]

describe('no customer-facing file says Supreme includes AF Legacy', () => {
  it('the precondition this guard depends on still holds', () => {
    expect(SUPREME_INCLUDED_PLAN_IDS).not.toContain('war_room')
  })

  const files = [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'components'))]

  it('scans a real file set (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(200)
    // The positive control: the pattern set matches the claim as it used to read.
    expect(SUPREME_INCLUDES_LEGACY.some((re) => re.test('the full Pro + Commissioner + AF Legacy stack'))).toBe(true)
    expect(SUPREME_INCLUDES_LEGACY.some((re) => re.test('(Pro + Commissioner + Legacy\n class access)'))).toBe(true)
  })

  it('finds no such claim', () => {
    const hits: string[] = []
    for (const file of files) {
      const src = withoutComments(readFileSync(file, 'utf8'))
      for (const re of SUPREME_INCLUDES_LEGACY) {
        const m = src.match(re)
        if (m) hits.push(`${relative(ROOT, file)}: "${m[0]}"`)
      }
    }
    expect(hits).toEqual([])
  })
})

describe('the Supreme surfaces say what Supreme is', () => {
  it('the /upgrade?plan=supreme spotlight lists Pro and Commissioner only, at the catalog prices', () => {
    render(<AFSupremeBundleSpotlight />)
    expect(screen.queryByTestId('af-supreme-includes-af-legacy')).toBeNull()
    expect(screen.getByTestId('af-supreme-includes-af-pro')).toBeTruthy()
    expect(screen.getByTestId('af-supreme-includes-af-commissioner')).toBeTruthy()
    expect(screen.queryByTestId('af-supreme-switch-from-war-room')).toBeNull()
    const monthly = getMonetizationCatalogItemBySku('af_supreme_monthly')!.amountUsd.toFixed(2)
    const yearly = getMonetizationCatalogItemBySku('af_supreme_yearly')!.amountUsd.toFixed(2)
    expect(screen.getByTestId('af-supreme-price-monthly').textContent).toBe(`$${monthly} monthly`)
    expect(screen.getByTestId('af-supreme-price-yearly').textContent).toBe(`$${yearly} yearly`)
  })

  it('"Why Subscribe" says AF Legacy is sold separately', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    render(<MonetizationPurchaseSurface pagePath="/pricing" title="t" subtitle="s" conversionHero />)
    const line = screen.getByText(/AF Pro and AF Commissioner in one subscription/)
    expect(line.textContent).toMatch(/AF Legacy is sold separately/)
  })

  it('/pricing metadata names only the plans the page sells', () => {
    const description = String(pricingMetadata.description ?? '')
    expect(description).toMatch(/AF Pro/)
    expect(description).not.toMatch(/Legacy/)
  })
})
