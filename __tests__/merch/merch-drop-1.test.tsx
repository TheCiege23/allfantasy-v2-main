// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, within } from '@testing-library/react'
import MerchDrop1 from '@/components/merch/MerchDrop1'
import LegacyShopTab from '@/app/af-legacy/components/tabs/LegacyShopTab'
import { ETSY_SHOP_URL, MERCH_DROP_1 } from '@/lib/merch/drop1'

const ROOT = resolve(__dirname, '../..')

describe('Merch Drop 1', () => {
  it('lists the six designs', () => {
    expect(MERCH_DROP_1.map((d) => d.title)).toEqual([
      'King of the Tuddys',
      'Waiver Wire Warrior',
      'Sleeper Pick',
      'The Commish',
      "Bench Points Don't Count",
      'Trade Rejected',
    ])
  })

  it('renders every design with its preview, descriptive alt text and a link to the real Etsy shop', () => {
    const { getByTestId } = render(<MerchDrop1 />)
    const section = getByTestId('merch-drop-1')
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Drop 1')
    const links = within(section).getAllByRole('link')
    expect(links).toHaveLength(6)
    MERCH_DROP_1.forEach((d, i) => {
      const a = links[i]!
      // No per-product listing exists, so each card goes to the storefront that is already in the codebase.
      expect(a.getAttribute('href')).toBe(ETSY_SHOP_URL)
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
      expect(a.getAttribute('aria-label')).toContain(d.title)
      const img = a.querySelector('img')!
      expect(img.getAttribute('src')).toBe(d.image)
      expect(img.getAttribute('alt')!.length).toBeGreaterThan(40)
      expect(img.getAttribute('alt')).toContain(d.title.replace("'", '\''))
    })
  })

  it('never shows a price or an invented product URL', () => {
    const { container } = render(<MerchDrop1 />)
    expect(container.textContent).not.toMatch(/\$\d/)
    for (const d of MERCH_DROP_1) expect(d.url).toBeUndefined()
    expect(ETSY_SHOP_URL).toBe('https://artbyciege.etsy.com')
    expect(readFileSync(resolve(ROOT, 'components/EtsyShop.tsx'), 'utf8')).toContain('href={ETSY_SHOP_URL}')
  })

  it('ships small web previews only, never the 4500×5400 print masters', () => {
    for (const d of MERCH_DROP_1) {
      const p = resolve(ROOT, 'public', d.image.slice(1))
      expect(existsSync(p), d.image).toBe(true)
      expect(d.image.endsWith('.webp')).toBe(true)
      expect(statSync(p).size, d.image).toBeLessThan(150_000)
    }
  })

  it('appears in the shop tab above the existing Etsy grid', () => {
    const { getByTestId, getByText } = render(<LegacyShopTab />)
    const drop = getByTestId('merch-drop-1')
    const etsy = getByText('Visit Full Etsy Shop')
    expect(drop.compareDocumentPosition(etsy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps tap targets ≥44px and text ≥11px', () => {
    const src = readFileSync(resolve(ROOT, 'components/merch/MerchDrop1.tsx'), 'utf8')
    expect(src).toContain('min-h-[44px]')
    const px = [...src.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]))
    expect(px.filter((n) => n < 11)).toEqual([])
  })
})
