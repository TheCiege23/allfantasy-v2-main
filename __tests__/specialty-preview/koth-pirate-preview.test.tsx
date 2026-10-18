// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { SpecialtyFormatPreview } from '@/components/specialty-preview/SpecialtyFormatPreview'
import { SPECIALTY_THEMES } from '@/components/league/specialty/theme'
import { SPECIALTY_PREVIEW_FORMATS, getSpecialtyPreview } from '@/lib/specialty-preview/formats'

const ROOT = resolve(__dirname, '../..')
const formats = Object.values(SPECIALTY_PREVIEW_FORMATS)

describe('King of the Hill + Pirate previews (no engine: assets, tokens, static page only)', () => {
  it('resolves exactly the two slugs and nothing else', () => {
    expect(getSpecialtyPreview('king-of-the-hill')?.name).toBe('King of the Hill')
    expect(getSpecialtyPreview('pirate')?.name).toBe('Pirate')
    expect(getSpecialtyPreview('zombie')).toBeNull()
    expect(getSpecialtyPreview(undefined)).toBeNull()
  })

  it('uses the shared shell theme, which carries the handoff tokens and display font', () => {
    expect(SPECIALTY_THEMES[SPECIALTY_PREVIEW_FORMATS['king-of-the-hill'].shellFormat]).toMatchObject({ acc: '#8b5cf6', acc2: '#f2c94c', disp: 'Cinzel', displayTitle: true })
    expect(SPECIALTY_THEMES[SPECIALTY_PREVIEW_FORMATS.pirate.shellFormat]).toMatchObject({ acc: '#d4a017', acc2: '#ffe08a', accInk: '#1a1204', disp: 'Pirata One', displayTitle: true })
    const { container } = render(<SpecialtyFormatPreview format={SPECIALTY_PREVIEW_FORMATS['king-of-the-hill']} />)
    const root = container.querySelector<HTMLElement>('[data-specialty="koth"]')!
    expect(root.style.getPropertyValue('--acc')).toBe('#8b5cf6')
    expect(root.style.getPropertyValue('--disp')).toBe("'Cinzel'")
  })

  it('every referenced asset is shipped under public/specialty/', () => {
    for (const f of formats) {
      const paths = [f.art.banner, f.art.emblem, ...f.points.flatMap((p) => (p.icon ? [p.icon] : []))]
      for (const p of paths) {
        expect(p.startsWith(`/specialty/`), p).toBe(true)
        expect(existsSync(resolve(ROOT, 'public', p.slice(1))), p).toBe(true)
      }
    }
  })

  it('Pirate uses the newer full art set (2026-10 package), not the replaced icon-* drafts', () => {
    const p = SPECIALTY_PREVIEW_FORMATS.pirate
    expect(p.points.map((x) => x.icon)).toEqual(['/specialty/pirate/plunder-chest.svg', '/specialty/pirate/anchor.svg'])
    for (const old of ['icon-plunder', 'icon-plank', 'icon-doubloon']) {
      expect(existsSync(resolve(ROOT, 'public/specialty/pirate', `${old}.svg`)), old).toBe(false)
    }
    expect(readFileSync(resolve(ROOT, 'public/specialty/pirate/emblem.svg'), 'utf8')).toContain('viewBox="0 0 300 300"')
  })

  it('🛑 states no rule that only ONE of the two disagreeing rule sets holds', () => {
    // Handoff-only (proposed) and kingOfTheHill.ts/pirate.ts-only house rules. None may be shown as fact.
    const forbidden = [/\+10/, /three scorers/i, /top scorer/i, /ties go/i, /most weeks/i, /5 doubloons/i, /plank/i, /bounty/i, /thursday/i, /anchor/i, /parley/i, /ransom/i, /pirate king/i, /kraken/i]
    for (const f of formats) {
      const { container } = render(<SpecialtyFormatPreview format={f} />)
      const text = container.textContent ?? ''
      for (const re of forbidden) expect(text, `${f.slug} ${re}`).not.toMatch(re)
      expect(text).toContain('Coming soon')
      expect(text).toContain('Rules not final')
      expect(container.querySelector('ol')).toBeNull() // no numbered rules list
    }
  })

  it('renders the hero with the format art and real links', () => {
    const { getByTestId, getByRole } = render(<SpecialtyFormatPreview format={SPECIALTY_PREVIEW_FORMATS.pirate} />)
    const root = getByTestId('specialty-format-preview')
    expect(root.getAttribute('data-format')).toBe('pirate')
    expect(root.querySelector('[data-specialty="pirate"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="specialty-hero"] img')?.getAttribute('src')).toBe('/specialty/pirate/banner.svg')
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Pirate')
    expect(getByRole('link', { name: 'My leagues' }).getAttribute('href')).toBe('/leagues')
  })

  it('loads Cinzel and Pirata One from the shared Google Fonts link', () => {
    const layout = readFileSync(resolve(ROOT, 'app/layout.tsx'), 'utf8')
    const href = layout.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/)?.[0] ?? ''
    expect(href).toContain('family=Cinzel')
    expect(href).toContain('family=Pirata+One')
  })

  it('is reachable where each format is listed', () => {
    expect(readFileSync(resolve(ROOT, 'components/league/LeagueTypeConfirm.tsx'), 'utf8')).toContain('href="/formats/pirate"')
    const success = readFileSync(resolve(ROOT, 'app/success/page.tsx'), 'utf8')
    expect(success).toContain('href="/formats/king-of-the-hill"')
    expect(success).toContain('href="/formats/pirate"')
  })
})
