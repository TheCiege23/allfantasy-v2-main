import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  BLACK_GOLD_PRESET_ID, CREST_GEOMETRY, PRESETS, clearedIdentity, crestFor, divisionMark, imageFor, leagueBanner,
  leagueDisplayName, libraryImages, libraryPath, markPath, parseIdentity, presetIdentity, resizeConferences,
} from '@/lib/tournament/divisions/identity'

const pub = (p: string) => path.join(process.cwd(), 'public', p)

describe('division identity presets', () => {
  it('ships 20 pairs and 50 library images, every file on disk', () => {
    expect(PRESETS).toHaveLength(20)
    expect(libraryImages).toHaveLength(50)
    for (const id of libraryImages) expect(existsSync(pub(libraryPath(id)))).toBe(true)
  })

  it('a preset fills both divisions with the side name, palette and default emblem', () => {
    const id = presetIdentity('angelic-demonic', 10)
    expect(id.divisions).toEqual([
      { name: 'Angelic', sideId: 'angelic', emblem: 'angel' },
      { name: 'Demonic', sideId: 'demonic', emblem: 'demon' },
    ])
    expect(id.conferences.map(c => c.name)).toEqual(['Beast', 'Goat', 'Grizz', 'Kings', 'Rebels', 'Smoke', 'Stealth', 'Swamp', 'Thunder', 'Warrior'])
    expect(parseIdentity(id).ok).toBe(true)
  })

  it('league names read "{Conference} {Division}"', () => {
    expect(leagueDisplayName('Smoke', 'Angelic')).toBe('Smoke Angelic')
    expect(leagueDisplayName(' Riptide ', 'Sharks')).toBe('Riptide Sharks')
  })
})

describe('naming rules', () => {
  const base = presetIdentity('rookie-vet', 4)

  it('division names up to 16, conference names up to 14', () => {
    const long = { ...base, divisions: [{ ...base.divisions[0], name: 'A'.repeat(17) }, base.divisions[1]] }
    expect(parseIdentity(long)).toMatchObject({ ok: false })
    const conf = { ...base, conferences: base.conferences.map((c, i) => i ? c : { ...c, name: 'B'.repeat(15) }) }
    expect(parseIdentity(conf)).toMatchObject({ ok: false })
    const ok = { ...base, divisions: [{ ...base.divisions[0], name: 'A'.repeat(16) }, base.divisions[1]] }
    expect(parseIdentity(ok).ok).toBe(true)
  })

  it('names must be unique across divisions and conferences, ignoring case', () => {
    const dup = { ...base, conferences: base.conferences.map((c, i) => i ? c : { ...c, name: 'rookie' }) }
    const r = parseIdentity(dup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/different/)
  })

  it('runs names through the team-name content filter', () => {
    const bad = { ...base, divisions: [{ ...base.divisions[0], name: 'Shitkickers' }, base.divisions[1]] }
    const r = parseIdentity(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/content filter/)
  })

  it('accepts only 2, 4, 6, 8 or 10 conferences and library images', () => {
    expect(parseIdentity(resizeConferences(base, 3))).toMatchObject({ ok: false })
    expect(parseIdentity(resizeConferences(base, 6)).ok).toBe(true)
    const img = { ...base, conferences: base.conferences.map((c, i) => i ? c : { ...c, image: '../../etc/passwd' }) }
    expect(parseIdentity(img)).toMatchObject({ ok: false })
  })

  it('clearing keeps colours and images but empties names', () => {
    const c = clearedIdentity(base)
    expect(c.presetId).toBeNull()
    expect(c.divisions.map(d => d.name)).toEqual(['', ''])
    expect(c.divisions.map(d => d.sideId)).toEqual(['rookie', 'vet'])
    expect(parseIdentity(c).ok).toBe(false)
  })
})

describe('Black & Gold pack', () => {
  it('imageFor(conference, division) is crests/<conf>-<div>.svg and exists', () => {
    expect(imageFor('Smoke', 'Black')).toBe('/artwork/tournaments/black-gold/crests/smoke-black.svg')
    expect(existsSync(pub(imageFor('Warrior', 'gold')!))).toBe(true)
    expect(imageFor('Riptide', 'Black')).toBeNull()
    expect(imageFor('Smoke', 'Angelic')).toBeNull()
  })

  it('the Black vs Gold preset uses the pack crests, banners and buffalo marks', () => {
    const id = presetIdentity(BLACK_GOLD_PRESET_ID, 10)
    expect(crestFor(id.divisions[0], id.conferences[5]!)).toEqual({ kind: 'pack', src: '/artwork/tournaments/black-gold/crests/smoke-black.svg' })
    expect(leagueBanner(id.divisions[1], id.conferences[0]!)).toBe('/artwork/tournaments/black-gold/banners/beast-gold.svg')
    expect(divisionMark(id.divisions[0])).toEqual({ kind: 'mark', src: markPath('black-buffalo') })
    expect(existsSync(pub(markPath('championship')))).toBe(true)
  })

  it('a renamed division or conference falls back to a composed crest, so baked text never contradicts the name', () => {
    const id = presetIdentity(BLACK_GOLD_PRESET_ID, 10)
    const renamed = crestFor({ ...id.divisions[0], name: 'Midnight' }, id.conferences[5]!)
    expect(renamed).toMatchObject({ kind: 'composed', tab: 'Midnight', ribbon: 'Smoke', frame: '/artwork/tournaments/identity/frames/black.svg' })
    expect(crestFor(id.divisions[0], { name: 'Fog', image: 'smoke' })).toMatchObject({ kind: 'composed', ribbon: 'Fog' })
  })

  it('non-pack sides compose frame + emblem with the README geometry', () => {
    const id = presetIdentity('angelic-demonic', 10)
    expect(crestFor(id.divisions[1], id.conferences[8]!)).toMatchObject({ kind: 'composed', emblem: '/artwork/tournaments/identity/library/thunder.svg', ink: '#ffffff' })
    expect(CREST_GEOMETRY.emblem).toEqual({ left: 19.3, top: 18.2, width: 61.3 })
    expect(CREST_GEOMETRY.tab.top).toBe(5.6)
    expect(CREST_GEOMETRY.ribbon).toMatchObject({ top: 79, height: 10.4 })
  })
})
