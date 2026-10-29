import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import catalog from '@/lib/survivor/tribeCatalog.json'
import {
  TRIBE_KITS, buildTribeCrest, buildTribeMark, parseMascotLayers, pyFixed, pyFloat, tribePalette, type TribeSport,
} from '@/lib/survivor/tribeEmblemComposer'
import { renderTribeEmblemRequest } from '@/lib/survivor/tribeEmblemRoute'
import {
  canonicalTribeSlots, resolveTribeEmblem, tribeCatalogIdFor, tribeCrestAlt, tribeCrestUrl, tribeMarkUrl, validateTribeSlots,
} from '@/lib/survivor/survivorTribeIdentity'
import markDigests from './fixtures/survivor-tribe-mark-digests.json'

const SPORTS: TribeSport[] = ['nfl', 'ncaaf', 'nba', 'ncaab', 'mlb', 'nhl', 'soccer']
/** The repo copies of the pre-built crests had trailing whitespace stripped; compare modulo that. */
const norm = (s: string) => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trimEnd()
const crab = catalog.find(t => t.id === 'crab')!
const params = (q: Record<string, string>) => new URLSearchParams(q)

describe('tribe emblem composer: equivalence with the handoff compose.py output', () => {
  it('reproduces all 350 pre-built crests byte-for-byte (50 tribes x 7 sports)', () => {
    const mismatches: string[] = []
    for (const sport of SPORTS) for (const tribe of catalog) {
      const expected = norm(readFileSync(`public/survivor/tribes/crests/${sport}/${tribe.id}.svg`, 'utf8'))
      if (norm(buildTribeCrest({ tribe, sport })) !== expected) mismatches.push(`${sport}/${tribe.id}`)
    }
    expect(mismatches).toEqual([])
  })

  it('reproduces all 250 handoff marks (50 tribes x 5 kits), checked against their sha256 digests', () => {
    expect(Object.keys(markDigests)).toHaveLength(250)
    const mismatches: string[] = []
    for (const tribe of catalog) for (const kit of TRIBE_KITS) {
      const digest = createHash('sha256').update(norm(buildTribeMark({ tribe, kit }))).digest('hex')
      if (digest !== (markDigests as Record<string, string>)[`${tribe.id}-${kit}`]) mismatches.push(`${tribe.id}-${kit}`)
    }
    expect(mismatches).toEqual([])
  })

  it('formats numbers exactly as Python prints them', () => {
    expect(pyFloat(-52)).toBe('-52.0')
    expect(pyFloat(52)).toBe('52.0')
    expect(pyFloat(-0)).toBe('-0.0')
    expect(pyFloat(-2.8000000000000003)).toBe('-2.8000000000000003')
    expect(pyFloat(0.00001)).toBe('1e-05')
    expect(pyFixed(0.125, 2)).toBe('0.12') // ties to even, unlike toFixed
    expect(pyFixed(0.375, 2)).toBe('0.38')
    expect(pyFixed(-0.125, 2)).toBe('-0.12')
    expect(pyFixed(85.4, 2)).toBe('85.40')
  })

  it('derives the palette like compose.py palette()', () => {
    const P = tribePalette('#e2563b', '#f2b33d')
    expect(P.pl).toBe('#eb8c79')
    expect(P.sl).toBe('#f6cd80')
    expect(P.field).toBe('#401811')
    expect(P.field2).toBe('#552016')
  })

  it('every mascot source parses into body + front kit layers with no executable content', () => {
    const files = readdirSync('lib/survivor/tribe-art/mascots').filter(f => f.endsWith('.svg'))
    expect(files).toHaveLength(50)
    const missingBack: string[] = []
    for (const file of files) {
      const src = readFileSync(`lib/survivor/tribe-art/mascots/${file}`, 'utf8')
      expect(src, file).not.toMatch(/<script|<foreignObject|<use\b|\bhref=|\bon\w+\s*=/i)
      const layers = parseMascotLayers(src)
      for (const kit of TRIBE_KITS) expect(layers, `${file} front-${kit}`).toHaveProperty(`front-${kit}`)
      for (const kit of TRIBE_KITS) if (!(`back-${kit}` in layers)) missingBack.push(`${file}:back-${kit}`)
      expect(layers.body?.length, file).toBeGreaterThan(100)
    }
    // The handoff's reference crab omits its (empty) back-soccer layer; compose.py treats a missing back layer as empty.
    expect(missingBack).toEqual(['crab.svg:back-soccer'])
  })
})

describe('commissioner overrides', () => {
  it('a renamed tribe shows its current name in the banner and title', () => {
    const base = buildTribeCrest({ tribe: crab, sport: 'nfl' })
    const renamed = buildTribeCrest({ tribe: crab, sport: 'nfl', name: 'Tidebreakers' })
    expect(renamed).toContain('<title>Tidebreakers — Crab (NFL)</title>')
    const banner = (svg: string) => svg.match(/<g fill="[^"]+"><path transform="translate\([^)]*\)" d="[^"]*"\/><\/g>\n<\/svg>$/)?.[0]
    expect(banner(renamed)).toBeTruthy()
    expect(banner(renamed)).not.toBe(banner(base))
    // Long names auto-shrink: the banner never exceeds the 168px box (centred on 150).
    const long = buildTribeCrest({ tribe: crab, sport: 'nfl', name: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM' })
    const x = Number(long.match(/<path transform="translate\(([\d.]+),283\.00\)/)?.[1])
    expect(x).toBeGreaterThanOrEqual(150 - 84 - 0.01)
  })

  it('colour overrides recolour the crest and invalid colours fall back to the catalogue', () => {
    const red = buildTribeCrest({ tribe: crab, sport: 'nba', colors: { primary: '#112233', secondary: '#AABBCC' } })
    expect(red).toContain('fill="#aabbcc" stroke="#0b0d14" stroke-width="12"')
    expect(red).toContain('stroke="#112233" stroke-width="2.5"')
    const bad = buildTribeCrest({ tribe: crab, sport: 'nba', colors: { primary: 'red" onload="x', secondary: 'url(#a)' } })
    expect(bad).toBe(buildTribeCrest({ tribe: crab, sport: 'nba' }))
  })
})

describe('SVG injection', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '"><svg onload=alert(1)>',
    '</title><foreignObject><iframe src=javascript:alert(1)>',
    ']]><!ENTITY x SYSTEM "file:///etc/passwd">&x;',
    "Koa' onmouseover='x",
    '\u0000\u2028Koa\u001b[31m',
  ]
  it.each(hostile)('name %j only reaches the SVG as outlined paths and escaped title text', name => {
    const svg = buildTribeCrest({ tribe: crab, sport: 'mlb', name })
    expect(svg).not.toMatch(/<script|<foreignObject|<iframe|<!ENTITY|javascript:/i)
    // No event-handler attribute on any element (the escaped title text may mention one harmlessly).
    expect(svg).not.toMatch(/<[^>]*\son\w+\s*=/i)
    const title = svg.match(/<title>([\s\S]*?)<\/title>/)![1]
    expect(title).not.toMatch(/[<>"']/)
    // Exactly one <title>, and the only text content in the document is inside it.
    expect(svg.match(/<title>/g)).toHaveLength(1)
    const withoutTitle = svg.replace(/<title>[\s\S]*?<\/title>/, '')
    expect(withoutTitle.replace(/<[^>]*>/g, '').trim()).toBe('')
    expect(svg).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u2028]/)
  })

  it('route rejects malformed input instead of coercing it', () => {
    const bad: Array<[string, Record<string, string>, number]> = [
      ['crest', { tribe: '../../etc/passwd', sport: 'nfl' }, 404],
      ['crest', { tribe: 'CRAB', sport: 'nfl' }, 404],
      ['crest', { tribe: 'constructor', sport: 'nfl' }, 404],
      ['crest', { tribe: 'crab', sport: '../nfl' }, 400],
      ['crest', { tribe: 'crab', sport: 'cricket' }, 400],
      ['crest', { tribe: 'crab', sport: 'nfl', p: 'zzzzzz' }, 400],
      ['crest', { tribe: 'crab', sport: 'nfl', p: '#ff0000' }, 400],
      ['crest', { tribe: 'crab', sport: 'nfl', s: 'fff' }, 400],
      ['crest', { tribe: 'crab', sport: 'nfl', s: 'ff0000" onload="x' }, 400],
      ['crest', { tribe: 'crab', sport: 'nfl', name: 'x'.repeat(129) }, 400],
      ['crest', { tribe: 'crab', sport: 'nfl', href: 'javascript:alert(1)' }, 400],
      ['mark', { tribe: 'crab', kit: 'curling' }, 400],
      ['script', { tribe: 'crab', sport: 'nfl' }, 404],
    ]
    for (const [kind, q, status] of bad) {
      const r = renderTribeEmblemRequest(kind, params(q))
      expect(r.ok, JSON.stringify(q)).toBe(false)
      expect(r.status, JSON.stringify(q)).toBe(status)
    }
    const repeated = new URLSearchParams('tribe=crab&sport=nfl&p=111111&p=222222')
    expect(renderTribeEmblemRequest('crest', repeated).status).toBe(400)
  })
})

describe('emblem route', () => {
  it('serves image/svg+xml with immutable caching keyed by every input', () => {
    const r = renderTribeEmblemRequest('crest', params({ tribe: 'crab', sport: 'NFL', p: 'E2563B', name: 'Kaniva', v: '1' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe(200)
    expect(r.headers['Content-Type']).toBe('image/svg+xml; charset=utf-8')
    expect(r.headers['Cache-Control']).toContain('immutable')
    expect(r.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(norm(r.svg)).toBe(norm(readFileSync('public/survivor/tribes/crests/nfl/crab.svg', 'utf8')))
    const again = renderTribeEmblemRequest('crest', params({ tribe: 'crab', sport: 'nfl' }), r.headers.ETag)
    expect(again.status).toBe(304)
    const renamed = renderTribeEmblemRequest('crest', params({ tribe: 'crab', sport: 'nfl', name: 'Reefborn' }))
    expect(renamed.ok && renamed.headers.ETag).not.toBe(r.headers.ETag)
    const mark = renderTribeEmblemRequest('mark', params({ tribe: 'orca', kit: 'hockey' }))
    expect(mark.ok && mark.svg).toContain('<title>')
  })

  it('every URL the client builds is accepted by the route', () => {
    for (const sport of ['NFL', 'ncaab', 'SOCCER']) for (const tribe of catalog.slice(0, 10)) {
      const urls = [
        tribeCrestUrl(tribe.id, sport, { name: `${tribe.name} & Co <3`, primaryColor: '#123456', secondaryColor: '#ABCDEF' })!,
        tribeMarkUrl(tribe.id, sport, { primaryColor: '#123456' })!,
      ]
      for (const url of urls) {
        const u = new URL(url, 'https://allfantasy.test')
        expect(u.pathname).toMatch(/^\/api\/survivor\/tribe-emblem\/(crest|mark)$/)
        const r = renderTribeEmblemRequest(u.pathname.split('/').pop()!, u.searchParams)
        expect(r.status, url).toBe(200)
      }
    }
  })
})

describe('tribe identity helpers', () => {
  it('resolves catalogue tribes with their current name and colours, legacy rows included', () => {
    expect(tribeCatalogIdFor({ logoUrl: '/survivor/tribes/crests/nhl/orca.svg' })).toBe('orca')
    expect(tribeCatalogIdFor({ logoUrl: '/survivor/tribes/crests/nhl/../../x.svg' })).toBeNull()
    expect(tribeCatalogIdFor({ catalogId: 'nope', logoUrl: 'https://cdn/x.png' })).toBeNull()
    const legacy = resolveTribeEmblem({ name: 'Ice Wolves', logoUrl: '/survivor/tribes/crests/nhl/orca.svg' }, 'NHL')
    expect(legacy.crestUrl).toContain('name=Ice+Wolves')
    expect(legacy.crestUrl).toContain('sport=nhl')
    expect(legacy.markUrl).toContain('kit=hockey')
    expect(legacy.mascot).toBe('Orca')
    const custom = resolveTribeEmblem({ name: 'Custom', logoUrl: 'https://cdn.example/logo.png' }, 'NFL')
    expect(custom.crestUrl).toBe('https://cdn.example/logo.png')
    const coloured = resolveTribeEmblem({ name: 'Kaniva', catalogId: 'crab', primaryColor: '#123456', secondaryColor: null }, 'MLB')
    expect(coloured.crestUrl).toContain('p=123456')
    expect(coloured.crestUrl).not.toContain('name=')
    expect(tribeCrestAlt('Kaniva', 'Crab')).toBe('Kaniva tribe crest, Crab')
  })

  it('validates and canonicalises colour overrides on tribe slots', () => {
    const slots = [{ catalogId: 'crab', managerCount: 10, primaryColor: '#AA0000' }, { catalogId: 'shark', managerCount: 10 }]
    expect(validateTribeSlots(slots, 20, 2)).toBeNull()
    expect(validateTribeSlots([{ ...slots[0], primaryColor: 'red' }, slots[1]], 20, 2)).toContain('hex')
    expect(canonicalTribeSlots([{ ...slots[0], extra: '<x>' } as never, slots[1]])).toEqual([
      { catalogId: 'crab', managerCount: 10, primaryColor: '#aa0000' }, { catalogId: 'shark', managerCount: 10 },
    ])
  })
})
