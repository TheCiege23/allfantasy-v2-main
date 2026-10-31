/**
 * The free-agent row badges a Fantrax prospect "Prospect" and labels a clubless one "Unsigned" —
 * the draft board's keys, so the two screens say the same thing. A normal row is unchanged.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WaiverPlayerRow from '@/components/waiver-wire/WaiverPlayerRow'

const base = { name: 'Cameron Hillis', position: 'C', team: null }

describe('WaiverPlayerRow prospect badge', () => {
  it('a clubless prospect shows the Prospect badge and Unsigned instead of FA', () => {
    const html = renderToStaticMarkup(<WaiverPlayerRow player={{ id: 'fantrax:04qyf', ...base }} sport="NHL" prospect onAddClick={() => {}} />)
    expect(html).toContain('data-testid="waiver-player-prospect-badge-fantrax:04qyf"')
    expect(html).toContain('>Prospect<')
    expect(html).toContain('data-testid="waiver-player-prospect-unsigned-fantrax:04qyf"')
    expect(html).toContain('>Unsigned<')
  })

  it('a prospect with an NHL org shows the org, not Unsigned', () => {
    const html = renderToStaticMarkup(<WaiverPlayerRow player={{ id: 'fantrax:04qyh', name: 'Tyler Madden', position: 'RW', team: 'MIN' }} sport="NHL" prospect onAddClick={() => {}} />)
    expect(html).toContain('>Prospect<')
    expect(html).not.toContain('Unsigned')
    expect(html).toContain('>MIN<')
  })

  it('an ordinary teamless row is unchanged: FA, no badge', () => {
    const html = renderToStaticMarkup(<WaiverPlayerRow player={{ id: '7001', ...base }} sport="NHL" onAddClick={() => {}} />)
    expect(html).not.toContain('Prospect')
    expect(html).not.toContain('Unsigned')
    expect(html).toContain('>FA<')
  })
})
