// @vitest-environment node
/**
 * Per-format sample demos (/demo/formats/*).
 *
 * These pages must work with NO database: prisma is mocked to throw, which proves no format
 * page reaches it. They must also be deterministic (same sample every visit), cover every
 * format the create-league wizard offers, and link "Create a league like this" to a format
 * the wizard accepts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Every access is RECORDED as well as thrown: some demo code catches errors (the source-config
// read returns null on failure), so a throw alone could be swallowed and the test still pass.
const dbTouches = vi.hoisted(() => [] as string[])
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, {
    get: (_t, prop) => {
      dbTouches.push(String(prop))
      throw new Error('format demos must not touch the database')
    },
  }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}))
let pathname = '/demo/formats'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const CATALOG_IDS = ['redraft', 'pirate', 'dynasty', 'keeper', 'best_ball', 'idp', 'salary_cap', 'devy', 'c2c', 'guillotine', 'survivor_guillotine', 'zombie', 'survivor', 'big_brother']

describe('format demos', () => {
  it('cover every create-league concept, each with a wizard type the wizard accepts', async () => {
    const { FORMAT_DEMO_META } = await import('@/lib/demo-league/formats/registry')
    const { parseRequestedFormat } = await import('@/lib/create-league-v2/requestedFormat')
    expect(FORMAT_DEMO_META.map((f) => f.wizardType).sort()).toEqual([...CATALOG_IDS].sort())
    for (const f of FORMAT_DEMO_META) {
      expect(parseRequestedFormat(f.wizardType), f.id).toBe(f.wizardType)
      expect(fs.existsSync(path.join(process.cwd(), 'public', f.poster)), `${f.id} poster ${f.poster}`).toBe(true)
    }
    // Drift guard: a concept added to the create-league catalog needs a demo here.
    const catalog = fs.readFileSync(path.join(process.cwd(), 'lib/league-creation/options-catalog-seed-data.ts'), 'utf8')
    const conceptBlock = catalog.slice(catalog.indexOf('concepts: ['), catalog.indexOf('sports: ALL_SPORTS'))
    const catalogIds = [...conceptBlock.matchAll(/id: '([a-z0-9_]+)'/g)].map((m) => m[1]).filter((id) => id !== 'tournament')
    expect([...new Set(catalogIds)].sort()).toEqual([...CATALOG_IDS].sort())
  })

  it('are deterministic: the same sample on every build', async () => {
    const { FORMAT_DEMO_META } = await import('@/lib/demo-league/formats/registry')
    const { buildSampleBase } = await import('@/lib/demo-league/formats/sample')
    for (const f of FORMAT_DEMO_META) {
      const a = buildSampleBase({ seed: f.id })
      const b = buildSampleBase({ seed: f.id })
      expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view))
    }
  })

  it('render the gallery and every format page without a database, labelled as example data', async () => {
    const Layout = (await import('@/app/demo/layout')).default
    const Gallery = (await import('@/app/demo/formats/page')).default
    const FormatPage = (await import('@/app/demo/formats/[format]/page')).default
    const { FORMAT_DEMO_META } = await import('@/lib/demo-league/formats/registry')

    pathname = '/demo/formats'
    const gallery = renderToStaticMarkup(React.createElement(Layout, null, Gallery()))
    expect(gallery).toContain('Demo league — example data')
    expect(gallery).not.toContain('live sample data')
    for (const f of FORMAT_DEMO_META) expect(gallery).toContain(`/demo/formats/${f.id}`)

    for (const f of FORMAT_DEMO_META) {
      pathname = `/demo/formats/${f.id}`
      const html = renderToStaticMarkup(React.createElement(Layout, null, await FormatPage({ params: Promise.resolve({ format: f.id }) })))
      expect(html, f.id).toContain('Demo league — example data')
      expect(html, f.id).toContain(`/create-league?type=${f.wizardType}`)
      // Sample team names come from the alias pool, never the generator's internal labels.
      expect(html, f.id).not.toMatch(/sample (owner|team) \d/i)
      // A sample has no team pages behind it.
      expect(html, f.id).not.toContain('/demo/teams/')
    }
    expect(dbTouches, 'prisma accessed while rendering format demos').toEqual([])
  })

  it('404s an unknown format', async () => {
    const FormatPage = (await import('@/app/demo/formats/[format]/page')).default
    await expect(FormatPage({ params: Promise.resolve({ format: 'not-a-format' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('elimination formats rank by season points, not a made-up W-L record', async () => {
    const { getFormatDemo } = await import('@/lib/demo-league/formats/registry')
    for (const id of ['guillotine', 'survivor', 'survivor-guilly']) expect(getFormatDemo(id)!.standingsMode, id).toBe('points')
  })
})

describe('?type= on create-league', () => {
  it('parses only real formats', async () => {
    const { parseRequestedFormat } = await import('@/lib/create-league-v2/requestedFormat')
    expect(parseRequestedFormat('Guillotine')).toBe('guillotine')
    expect(parseRequestedFormat('tournament')).toBeNull()
    expect(parseRequestedFormat('<script>')).toBeNull()
    expect(parseRequestedFormat(undefined)).toBeNull()
  })

  it('applies the format with the same transition a tile tap runs, keeping the rest of a draft', async () => {
    const { applyRequestedFormat } = await import('@/lib/create-league-v2/requestedFormat')
    const { DEFAULT_V2_STATE } = await import('@/lib/create-league-v2/state')
    const { freshCreateLeagueState } = await import('@/components/create-league-v2/CreateLeagueWizard')
    const start = { ...freshCreateLeagueState(DEFAULT_V2_STATE), name: 'My half-filled draft' }
    const formats = ['redraft', 'keeper', 'dynasty', 'best_ball', 'guillotine', 'zombie', 'big_brother', 'pirate', 'salary_cap', 'devy', 'c2c', 'survivor', 'survivor_guillotine'] as const
    for (const f of formats) {
      const next = applyRequestedFormat(start, f)
      expect(next.leagueType, f).toBe(f)
      expect(next.name, f).toBe('My half-filled draft')
      expect(next.scoringPresetId, f).toBeTruthy()
    }
    const idp = applyRequestedFormat(start, 'idp')
    expect(idp.leagueType).toBe('redraft')
    expect(idp.idpSelected).toBe(true)
  })
})
