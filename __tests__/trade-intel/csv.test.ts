import { describe, expect, it } from 'vitest'

import { parseCsv, parseCsvLine } from '@/lib/trade-intel/csv'

describe('parseCsvLine', () => {
  it('splits plain rows', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps commas that live inside quotes', () => {
    // A real name like "Smith, Jr." must not become two columns.
    expect(parseCsvLine('"Smith, Jr.",WR,CIN')).toEqual(['Smith, Jr.', 'WR', 'CIN'])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x'])
  })

  it('preserves empty trailing cells', () => {
    expect(parseCsvLine('a,,c,')).toEqual(['a', '', 'c', ''])
  })
})

describe('parseCsv', () => {
  const csv = ['"player","pos","value_2qb"', '"Ja\'Marr Chase","WR",9076', '"Brenton Strange","TE",563'].join('\n')

  it('keys cells by header name', () => {
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ player: "Ja'Marr Chase", pos: 'WR', value_2qb: '9076' })
  })

  it('handles CRLF files', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }])
  })

  it('returns nothing for a header-only or empty file', () => {
    expect(parseCsv('a,b')).toEqual([])
    expect(parseCsv('')).toEqual([])
  })

  it('skips short rows instead of padding them', () => {
    // Padding would turn a parse failure into confident wrong data.
    const rows = parseCsv('a,b,c\n1,2,3\n4,5')
    expect(rows).toEqual([{ a: '1', b: '2', c: '3' }])
  })
})
