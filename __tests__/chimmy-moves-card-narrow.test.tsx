import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChimmyMovesCard } from '@/components/core-app/ChimmyMovesCard'

/**
 * Chimmy's moves on a narrow card, 2026-10-03 — measured on the live KBFL page at 375px: a move
 * 112px → 88px, the card 294px → 246px, the lock countdown 48px higher. At 768px (a 649px card)
 * byte-identical. See the block's header in af-core-shell.css.
 */
const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-core-shell.css'), 'utf8')
const NARROW = 'af-cmv (max-width: 480px)'

function inQuery(selector: string, params: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    const p = rule.parent
    const at = p && p.type === 'atrule' ? `${(p as AtRule).name} ${(p as AtRule).params}` : null
    if (params === null ? at !== null : at !== `container ${params}`) return
    rule.walkDecls((d) => {
      out[d.prop] = d.value
    })
  })
  return out
}

describe('the moves card measures itself', () => {
  it('is an inline-size container — it sits on screens whose width the viewport does not predict', () => {
    expect(inQuery('.af-core .af-cmv', null).container).toBe('af-cmv / inline-size')
  })

  it('gives the title the whole first line and puts the buttons beside the detail', () => {
    expect(inQuery('.af-core .af-cmv-row', NARROW)).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'minmax(0, 1fr) auto',
      'grid-template-areas': "'move move' 'detail actions'",
    })
    expect(inQuery('.af-core .af-cmv-move', NARROW)['grid-area']).toBe('move')
    expect(inQuery('.af-core .af-cmv-detail', NARROW)['grid-area']).toBe('detail')
    expect(inQuery('.af-core .af-cmv-actions', NARROW)['grid-area']).toBe('actions')
    expect(inQuery('.af-core .af-cmv-text', NARROW).display).toBe('contents')
  })

  it('leaves the wide card alone — the flex row and its 180px text floor still govern there', () => {
    expect(inQuery('.af-core .af-cmv-row', null).display).toBe('flex')
    expect(inQuery('.af-core .af-cmv-text', null).flex).toBe('1 1 180px')
  })
})

describe('the DOM the grid depends on', () => {
  it('keeps title and detail in a plain div, and the two taps outside it', () => {
    const data = {
      leagueId: 'l1',
      startersRead: 9,
      checkAsk: 'check',
      moves: [
        { key: 'a', tone: 'bad', title: 'Bench Jayden Daniels', detail: 'Out — QB · WAS — locks in 21h 55m', href: '/core/my-team?league=l1#lineup-player-1', actionLabel: 'Fix lineup', ask: 'why' },
      ],
    }
    const { container } = render(<ChimmyMovesCard data={data as never} leagueName="KBFL" />)
    const row = container.querySelector('.af-cmv-row')!
    const text = row.querySelector(':scope > .af-cmv-text')!
    expect(text.tagName).toBe('DIV')
    expect([...text.children].map((c) => c.className)).toEqual(['af-cmv-move', 'af-cmv-detail'])
    const actions = row.querySelector(':scope > .af-cmv-actions')!
    expect(actions.querySelector('a')?.textContent).toBe('Fix lineup')
    expect(actions.querySelector('button')?.getAttribute('aria-label')).toBe('Ask Chimmy about Jayden Daniels')
  })
})
