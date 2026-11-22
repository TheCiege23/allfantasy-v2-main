import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { waiversMessages } from '@/lib/core-app/messages/waivers'

/**
 * Three small visual fixes, each pinned where jsdom cannot measure layout.
 */

const css = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8')
/** Strip comments so a rule described in prose is not mistaken for the rule itself. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the last card on a /core screen clears the chat bubble', () => {
  it('every .af-core .af-content padding shorthand reserves the bubble at the bottom', () => {
    /*
     * A later "polish" block set `padding: … 32px` (desktop) and `… calc(92px + env())` (phone).
     * Both overrode the clearance documented earlier in the file, so the last card ended under
     * the bubble with nothing left to scroll. Any shorthand that sets the bottom must carry it.
     */
    const src = code(css('components/core-app/af-core-shell.css'))
    const shorthands = [...src.matchAll(/\.af-core \.af-content\s*\{\s*padding:\s*([^;]+);/g)].map((m) => m[1])
    expect(shorthands.length).toBeGreaterThanOrEqual(2)
    for (const value of shorthands) expect(value).toContain('var(--af-fab-bottom')
    expect(src).not.toMatch(/\.af-core \.af-content\s*\{\s*padding:[^;]*\b92px/)
  })
})

describe('"Games started" stays readable', () => {
  it('the locked lock strip does not fade its whole text with opacity', () => {
    const src = code(css('components/core-app/af-my-team.css'))
    const locked = [...src.matchAll(/\.af-mt-lock\[data-locked='true'\]\s*\{([^}]*)\}/g)].map((m) => m[1])
    for (const body of locked) expect(body).not.toMatch(/opacity/)
  })
})

describe('Waivers "Players held" wraps between parts, not inside one', () => {
  it('keeps each count with its word', () => {
    for (const lang of ['en', 'es'] as const) {
      const line = waiversMessages[lang].rosterLoad(9, 5, 1)
      // Only the " · " separators may break; every part is held together with a no-break space.
      for (const part of line.split(' · ')) expect(part).not.toContain(' ')
      expect(line.split(' · ')).toHaveLength(3)
    }
    expect(waiversMessages.en.rosterLoad(9, 5, 1)).toBe('9 starting · 5 bench · 1 IR/taxi')
  })
})
