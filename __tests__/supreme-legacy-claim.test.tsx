import React from 'react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * 🛑 AF SUPREME IS AF PRO + AF COMMISSIONER + AF LEGACY (owner's decision 2026-11-27).
 * From 2026-10-25 to 2026-11-27 SUPREME_INCLUDED_PLAN_IDS was [pro, commissioner] and this file guarded
 * the opposite claim. It is inverted now: no customer-facing file may say Legacy is sold separately or
 * not included in Supreme — the five places that said so (/upgrade's "Why Subscribe", the Supreme
 * spotlight, /all-access, the Survivor command center, the World Cup card) now list all three plans.
 * It still reads every .tsx under app/ and components/, for the reason it always did.
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

const SUPREME_EXCLUDES_LEGACY = [
  /AF Legacy is sold separately/i,
  /Legacy is not included/i,
  /AF Legacy is sold on its own/i,
  /does not include (AF )?Legacy/i,
]

describe('no customer-facing file says Supreme leaves out AF Legacy', () => {
  it('the precondition this guard depends on still holds', () => {
    expect(SUPREME_INCLUDED_PLAN_IDS).toContain('war_room')
  })

  const files = [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'components'))]

  it('scans a real file set (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(200)
    // The positive control: the pattern set matches the claim as it used to read.
    // The positive control: the pattern set matches the claim as it read until 2026-11-27.
    expect(SUPREME_EXCLUDES_LEGACY.some((re) => re.test('AF Pro and AF Commissioner in one subscription. AF Legacy is sold separately.'))).toBe(true)
    expect(SUPREME_EXCLUDES_LEGACY.some((re) => re.test('AF Legacy is not included — it is sold on its own.'))).toBe(true)
  })

  it('finds no such claim', () => {
    const hits: string[] = []
    for (const file of files) {
      const src = withoutComments(readFileSync(file, 'utf8'))
      for (const re of SUPREME_EXCLUDES_LEGACY) {
        const m = src.match(re)
        if (m) hits.push(`${relative(ROOT, file)}: "${m[0]}"`)
      }
    }
    expect(hits).toEqual([])
  })
})

describe('the Supreme surfaces say what Supreme is', () => {
  it('the /upgrade?plan=supreme spotlight lists Pro, Commissioner and Legacy, at the catalog prices', () => {
    render(<AFSupremeBundleSpotlight />)
    expect(screen.getByTestId('af-supreme-includes-af-legacy')).toBeTruthy()
    expect(screen.getByTestId('af-supreme-includes-af-pro')).toBeTruthy()
    expect(screen.getByTestId('af-supreme-includes-af-commissioner')).toBeTruthy()
    expect(screen.getByTestId('af-supreme-switch-from-war-room')).toBeTruthy()
    const monthly = getMonetizationCatalogItemBySku('af_supreme_monthly')!.amountUsd.toFixed(2)
    const yearly = getMonetizationCatalogItemBySku('af_supreme_yearly')!.amountUsd.toFixed(2)
    expect(screen.getByTestId('af-supreme-price-monthly').textContent).toBe(`$${monthly} monthly`)
    expect(screen.getByTestId('af-supreme-price-yearly').textContent).toBe(`$${yearly} yearly`)
  })

  it('"Why Subscribe" says AF Supreme includes AF Legacy', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    render(<MonetizationPurchaseSurface pagePath="/pricing" title="t" subtitle="s" conversionHero />)
    const line = screen.getByText(/AF Pro, AF Commissioner and AF Legacy in one subscription/)
    expect(line.textContent).not.toMatch(/sold separately/)
  })

  it('/pricing metadata names only the plans the page sells', () => {
    const description = String(pricingMetadata.description ?? '')
    expect(description).toMatch(/AF Pro/)
    expect(description).not.toMatch(/Legacy/)
  })
})
