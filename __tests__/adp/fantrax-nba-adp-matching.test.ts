import { describe, expect, it, vi } from 'vitest'

/**
 * Fantrax NBA ADP → our NBA identities.
 *
 * 🛑 NBA had no ADP at all, so every NBA board and autopick sorted alphabetically. These pin the
 * matching that turns Fantrax's board into rows the draft pool can use — in particular that rows
 * carry OUR position (Fantrax's disagreed with ours on 70% of matched players, 2026-10-13), and that
 * an unsure match is skipped rather than guessed.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { fantraxDisplayName, matchFantraxNbaAdp, nbaAdpNameKey } from '@/lib/adp/fantraxNbaAdp'

/** The first rows of the real `getAdp?sport=NBA` response captured 2026-10-13, in the parsed shape. */
const FANTRAX = [
  { fantraxId: '04ilz', name: 'Jokic, Nikola', position: 'C', adp: 1.39 },
  { fantraxId: '06jrj', name: 'Wembanyama, Victor', position: 'C', adp: 1.76 },
  { fantraxId: '05aua', name: 'Gilgeous-Alexander, Shai', position: 'PG', adp: 3.49 },
  { fantraxId: '04x3b', name: 'Doncic, Luka', position: 'PG', adp: 3.54 },
  { fantraxId: '04jky', name: 'Gordon, Aaron', position: 'PF', adp: 132.4 },
  { fantraxId: '05h4m', name: 'Jackson Jr., Jaren', position: 'C', adp: 40.2 },
]

const identity = (id: string, canonicalName: string, position: string | null, currentTeam: string | null) => ({
  id,
  canonicalName,
  position,
  currentTeam,
})

describe('nbaAdpNameKey', () => {
  it('folds accents instead of dropping the letter', () => {
    // `normalizePlayerName` alone turns "Jokić" into "joki", which would never meet Fantrax's "Jokic".
    expect(nbaAdpNameKey('Nikola Jokić')).toBe(nbaAdpNameKey('Nikola Jokic'))
    expect(nbaAdpNameKey('Luka Dončić')).toBe('luka doncic')
  })

  it('drops generational suffixes on either side', () => {
    expect(nbaAdpNameKey('Jaren Jackson Jr.')).toBe(nbaAdpNameKey('Jaren Jackson'))
  })
})

describe('fantraxDisplayName', () => {
  it('turns "Last, First" around', () => {
    expect(fantraxDisplayName('Gilgeous-Alexander, Shai')).toBe('Shai Gilgeous-Alexander')
    expect(fantraxDisplayName('Jackson Jr., Jaren')).toBe('Jaren Jackson Jr.')
  })

  it('leaves a name with no comma alone', () => {
    expect(fantraxDisplayName('Nene')).toBe('Nene')
  })
})

describe('matchFantraxNbaAdp', () => {
  const identities = [
    identity('id-jokic', 'Nikola Jokić', 'C', 'DEN'),
    identity('id-wemby', 'Victor Wembanyama', 'C', 'SAS'),
    identity('id-sga', 'Shai Gilgeous-Alexander', 'PG', 'OKC'),
    identity('id-luka', 'Luka Dončić', 'PG', 'LAL'),
    identity('id-gordon', 'Aaron Gordon', 'C', 'DEN'),
    identity('id-jjj', 'Jaren Jackson Jr.', 'PF', 'MEM'),
  ]

  it('matches every player and carries OUR name, position and team', () => {
    const r = matchFantraxNbaAdp(FANTRAX, identities)
    expect(r.unmatched).toEqual([])
    expect(r.ambiguous).toEqual([])
    expect(r.matched.map((m) => m.identityId)).toEqual(['id-jokic', 'id-wemby', 'id-sga', 'id-luka', 'id-jjj', 'id-gordon'])
    expect(r.matched[0]).toEqual({ identityId: 'id-jokic', playerName: 'Nikola Jokić', position: 'C', team: 'DEN', adp: 1.39 })
  })

  it('never takes Fantrax position over ours — the 70% case', () => {
    const gordon = matchFantraxNbaAdp(FANTRAX, identities).matched.find((m) => m.identityId === 'id-gordon')
    // Fantrax lists Gordon at PF; we list him at C. The row must say C, or the pool's key misses him.
    expect(gordon?.position).toBe('C')
    const jjj = matchFantraxNbaAdp(FANTRAX, identities).matched.find((m) => m.identityId === 'id-jjj')
    expect(jjj?.position).toBe('PF')
  })

  it('keeps basketball C as C, not the football OL that the generic normalizer folds it into', () => {
    const jokic = matchFantraxNbaAdp(FANTRAX, identities).matched[0]
    expect(jokic.position).toBe('C')
  })

  it('counts a name with no identity as unmatched and writes nothing for it', () => {
    const r = matchFantraxNbaAdp(FANTRAX, identities.filter((i) => i.id !== 'id-wemby'))
    expect(r.unmatched).toEqual(['Victor Wembanyama'])
    expect(r.matched.some((m) => m.playerName.includes('Wembanyama'))).toBe(false)
  })

  it('uses Fantrax position only to split two identities sharing a name', () => {
    const twins = [identity('jw-okc', 'Jaylin Williams', 'PF', 'OKC'), identity('jw-other', 'Jaylin Williams', 'SG', 'XXX')]
    const r = matchFantraxNbaAdp([{ fantraxId: 'x', name: 'Williams, Jaylin', position: 'PF', adp: 200 }], twins)
    expect(r.matched).toEqual([{ identityId: 'jw-okc', playerName: 'Jaylin Williams', position: 'PF', team: 'OKC', adp: 200 }])
  })

  it('skips — never guesses — two same-name identities that position cannot split', () => {
    const twins = [identity('a', 'Dyson Daniels', 'SG', 'ATL'), identity('b', 'Dyson Daniels', 'SG', 'ATL')]
    const r = matchFantraxNbaAdp([{ fantraxId: 'x', name: 'Daniels, Dyson', position: 'SG', adp: 60 }], twins)
    expect(r.matched).toEqual([])
    expect(r.ambiguous).toEqual(['Dyson Daniels'])
  })

  it('prices an identity once, at its earliest ADP', () => {
    const r = matchFantraxNbaAdp(
      [
        { fantraxId: 'late', name: 'Jokic, Nikola', position: 'C', adp: 9 },
        { fantraxId: 'early', name: 'Jokic, Nikola', position: 'C', adp: 1.39 },
      ],
      identities,
    )
    expect(r.matched).toHaveLength(1)
    expect(r.matched[0].adp).toBe(1.39)
    expect(r.duplicates).toBe(1)
  })

  it('ignores a row with no usable ADP', () => {
    const r = matchFantraxNbaAdp([{ fantraxId: 'z', name: 'Jokic, Nikola', position: 'C', adp: 0 }], identities)
    expect(r.matched).toEqual([])
  })
})
