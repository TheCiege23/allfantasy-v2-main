/**
 * Where prospects sit on the free-agent screens, the copy that explains it (EN + ES, and the Spanish
 * never says «waiver»), and what Chimmy is told about them.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: vi.fn() }))

import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'
import { tInterpolate } from '@/lib/i18n/tInterpolate'
import {
  isNhlProspectWireRow,
  mergeProspectSearchRows,
  parseNhlProspectListMeta,
  placeProspectsAfterPlayers,
  shouldSearchNhlProspects,
} from '@/lib/waiver-wire/prospectFreeAgentDisplay'
import { buildOtherSportAvailableContext } from '@/lib/chimmy/tools/availablePlayersOtherSports'

const pro = (id: string) => ({ id })
const prospect = (id: string) => ({ id, prospectSource: 'fantrax' as const })

describe('placeProspectsAfterPlayers', () => {
  const list = [prospect('p1'), pro('a'), prospect('p2'), pro('b')]

  it.each(['projection', 'adp', 'rank', 'ownership', 'recent', 'trend', '', undefined])('puts prospects last under %s, order kept', (sort) => {
    expect(placeProspectsAfterPlayers(list, sort).map((p) => p.id)).toEqual(['a', 'b', 'p1', 'p2'])
  })

  it.each(['name', 'position', 'team'])('mixes them in under a %s sort', (sort) => {
    expect(placeProspectsAfterPlayers(list, sort).map((p) => p.id)).toEqual(['p1', 'a', 'p2', 'b'])
  })

  it('a list with no prospects comes back in the same order', () => {
    expect(placeProspectsAfterPlayers([pro('b'), pro('a')], 'projection').map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('search merge and when to search', () => {
  it('adds only prospect rows the list does not already hold', () => {
    const merged = mergeProspectSearchRows([pro('a'), prospect('p1')], [prospect('p1'), prospect('p9'), pro('x')])
    expect(merged.map((p) => p.id)).toEqual(['a', 'p1', 'p9'])
    expect(isNhlProspectWireRow(merged[2])).toBe(true)
  })

  it('searches only when more prospects exist than are listed, and for a name of two letters or more', () => {
    expect(shouldSearchNhlProspects({ total: 900, listed: 750 }, 'ma')).toBe(true)
    expect(shouldSearchNhlProspects({ total: 900, listed: 750 }, 'm')).toBe(false)
    expect(shouldSearchNhlProspects({ total: 20, listed: 20 }, 'madden')).toBe(false)
    expect(shouldSearchNhlProspects(null, 'madden')).toBe(false)
    expect(parseNhlProspectListMeta(undefined)).toBeNull()
    expect(parseNhlProspectListMeta({ total: 3, listed: 2 })).toEqual({ total: 3, listed: 2 })
  })
})

describe('copy, English and Spanish', () => {
  const KEYS = ['waiverWire.prospects.sortNote', 'waiverWire.prospects.searchHint', 'draftRoom.pool.prospectBadge', 'draftRoom.pool.prospectUnsigned', 'draftRoom.pool.prospectTooltip']
  const es = (k: string) => translations.es?.[k] ?? translationsEsParity[k]

  it.each(KEYS)('%s exists in English and in Spanish, and the Spanish differs', (key) => {
    expect(translations.en[key]).toBeTruthy()
    expect(es(key)).toBeTruthy()
    expect(es(key)).not.toBe(translations.en[key])
  })

  it.each(KEYS)('the Spanish for %s never says «waiver»', (key) => {
    expect(es(key)).not.toMatch(/waiver/i)
  })

  it('the search hint interpolates its numbers in both languages', () => {
    const en = tInterpolate((k) => translations.en[k] ?? k, 'waiverWire.prospects.searchHint', { listed: '750', total: '900' })
    const sp = tInterpolate((k) => es(k) ?? k, 'waiverWire.prospects.searchHint', { listed: '750', total: '900' })
    expect(en).toBe('Showing 750 of 900 prospects. Search by name to find the rest.')
    expect(sp).toBe('Se muestran 750 de 900 prospectos. Busca por nombre para encontrar el resto.')
  })
})

describe('Chimmy: prospects are named as prospects and never ranked', () => {
  const pool = [{ player_id: 'x', full_name: 'Connor McDavid', position: 'C', team_abbreviation: 'EDM', external_source_id: '7001', sleeper_id: null, injury_status: null }] as never
  const baseIndex = { sport: 'NHL', season: 2026, byName: new Map([['connor mcdavid', { name: 'Connor McDavid', position: 'C', perGame: 3.1 }]]) }
  const deps = (count: number | Error) => ({
    pool: vi.fn(async () => pool),
    baseline: vi.fn(async () => baseIndex as never),
    prospectCount: vi.fn(async () => {
      if (count instanceof Error) throw count
      return count
    }),
  })
  const args = { leagueName: 'Ice', sport: 'NHL', leagueId: 'L1', rostered: new Set(['1']) }

  it('NHL dynasty: adds a labelled count and forbids projection advice', async () => {
    const d = deps(42)
    const out = await buildOtherSportAvailableContext({ ...args, dynasty: true }, d)
    expect(out).toMatch(/42 NHL prospects from Fantrax/)
    expect(out).toMatch(/NOT ranked/)
    expect(out).toMatch(/no projection-based advice/)
    expect(out).toMatch(/Connor McDavid/)
  })

  it('NHL redraft and other sports: no prospect line and no prospect read', async () => {
    const d = deps(42)
    const redraft = await buildOtherSportAvailableContext(args, d)
    expect(redraft).not.toMatch(/prospect/i)
    const mlb = await buildOtherSportAvailableContext({ ...args, sport: 'MLB', dynasty: true }, d)
    expect(mlb).not.toMatch(/prospect/i)
    expect(d.prospectCount).not.toHaveBeenCalled()
  })

  it('a failed prospect read leaves the answer as it was', async () => {
    const withFail = await buildOtherSportAvailableContext({ ...args, dynasty: true }, deps(new Error('db down')))
    const without = await buildOtherSportAvailableContext(args, deps(0))
    expect(withFail).toBe(without)
  })
})
